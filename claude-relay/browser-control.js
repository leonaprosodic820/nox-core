'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function run(cmd, timeout = 15000) {
  try { return { success: true, output: execSync(cmd, { encoding: 'utf8', timeout, stdio: ['pipe','pipe','pipe'] }).trim() }; }
  catch(e) { return { success: false, error: e.message }; }
}

function apple(script, timeout = 15000) {
  const tmp = path.join(os.tmpdir(), 'prom_as_' + Date.now() + '.applescript');
  fs.writeFileSync(tmp, script);
  const r = run('osascript "' + tmp + '"', timeout);
  try { fs.unlinkSync(tmp); } catch {}
  return r;
}

const Safari = {
  open(url) { return apple('tell application "Safari"\nactivate\nif (count of windows) = 0 then make new document\nset URL of current tab of front window to "' + url + '"\nend tell'); },
  getCurrentURL() { return apple('tell application "Safari"\nreturn URL of current tab of front window\nend tell'); },
  getPageTitle() { return apple('tell application "Safari"\nreturn name of current tab of front window\nend tell'); },
  getPageText() { return apple('tell application "Safari"\nset pageText to do JavaScript "document.body.innerText" in current tab of front window\nreturn pageText\nend tell', 20000); },
  executeJS(js) { const escaped = js.replace(/"/g, '\\"').replace(/\n/g, ' '); return apple('tell application "Safari"\nset result to do JavaScript "' + escaped + '" in current tab of front window\nreturn result as string\nend tell', 15000); },
  newTab(url) { return apple('tell application "Safari"\nactivate\ntell front window\nset newTab to make new tab with properties {URL:"' + url + '"}\nset current tab to newTab\nend tell\nend tell'); },
  closeTab() { return apple('tell application "Safari"\nclose current tab of front window\nend tell'); },
  goBack() { return apple('tell application "Safari"\ndo JavaScript "history.back()" in current tab of front window\nend tell'); },
  search(query) { return this.open('https://www.google.com/search?q=' + encodeURIComponent(query)); },
};

const Chrome = {
  open(url) { return apple('tell application "Google Chrome"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to "' + url + '"\nend tell'); },
  getCurrentURL() { return apple('tell application "Google Chrome"\nreturn URL of active tab of front window\nend tell'); },
  getPageText() { return apple('tell application "Google Chrome"\nexecute active tab of front window javascript "document.body.innerText"\nend tell', 20000); },
  executeJS(js) { const escaped = js.replace(/"/g, '\\"').replace(/\n/g, ' '); return apple('tell application "Google Chrome"\nexecute active tab of front window javascript "' + escaped + '"\nend tell', 15000); },
  newTab(url) { return apple('tell application "Google Chrome"\nactivate\ntell front window\nmake new tab with properties {URL:"' + url + '"}\nend tell\nend tell'); },
  search(query) { return this.open('https://www.google.com/search?q=' + encodeURIComponent(query)); },
};

const Firefox = {
  open(url) { run('open -a Firefox "' + url + '"'); return { success: true }; },
  search(query) { return this.open('https://www.google.com/search?q=' + encodeURIComponent(query)); },
};

async function fetchPage(url, opts = {}) {
  const client = url.startsWith('https') ? require('https') : require('http');
  return new Promise(resolve => {
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'text/html,*/*', 'Accept-Language': 'fr-FR,fr;q=0.9' },
      timeout: opts.timeout || 10000,
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const text = data.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
        resolve({ success: true, text, url });
      });
    });
    req.on('error', e => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
  });
}

async function webSearch(query) {
  try {
    const ddgUrl = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1';
    const page = await fetchPage(ddgUrl, { timeout: 8000 });
    if (page.success) {
      try {
        const data = JSON.parse(page.text);
        if (data.AbstractText || data.Answer) return { success: true, source: 'DuckDuckGo', answer: data.Answer || data.AbstractText, url: data.AbstractURL };
      } catch {}
    }
  } catch {}

  try {
    const googleUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query) + '&hl=fr';
    const page = await fetchPage(googleUrl, { timeout: 10000 });
    if (page.success && page.text.length > 100) {
      const bridge = require('./claude-api-bridge');
      const resp = await bridge.callFast('Extrait les informations cles de ces resultats Google.\nQuery: "' + query + '"\nContenu: ' + page.text.slice(0, 3000) + '\n\nReponse directe et concise en francais.', { maxTokens: 400 });
      const answer = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
      return { success: true, source: 'Google', answer };
    }
  } catch {}

  return { success: false, error: 'Recherche echouee' };
}

function getDefaultBrowser() {
  const r = run('defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null | grep -A1 "http" | tail -1');
  if (r.output?.includes('chrome')) return 'chrome';
  if (r.output?.includes('firefox')) return 'firefox';
  return 'safari';
}

async function browse(url, browser) { const b = browser || getDefaultBrowser(); const h = { safari: Safari, chrome: Chrome, firefox: Firefox }; return (h[b] || Safari).open(url); }
async function search(query, browser) { const b = browser || getDefaultBrowser(); const h = { safari: Safari, chrome: Chrome, firefox: Firefox }; return (h[b] || Safari).search(query); }
async function getPageContent(browser) { const h = { safari: Safari, chrome: Chrome }; return (h[browser || 'safari'] || Safari).getPageText(); }

async function analyzeCurrentPage(browser) {
  const content = await getPageContent(browser);
  if (!content.success) return content;
  const bridge = require('./claude-api-bridge');
  const resp = await bridge.callFast('Analyse cette page web et resume les points cles:\n' + (content.output || '').slice(0, 3000) + '\n\nResume concis en francais:', { maxTokens: 400 });
  const summary = typeof resp === 'string' ? resp : resp.content?.[0]?.text || '';
  return { success: true, summary, raw: content.output?.slice(0, 500) };
}

module.exports = { Safari, Chrome, Firefox, browse, search, fetchPage, webSearch, getPageContent, analyzeCurrentPage, getDefaultBrowser };
