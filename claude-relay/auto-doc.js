'use strict';
const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, 'knowledge', 'autodoc');
fs.mkdirSync(DOCS_DIR, { recursive: true });

function today() { return new Date().toISOString().slice(0, 10); }

async function updateDailyJournal(entry) {
  const file = path.join(DOCS_DIR, `journal-${today()}.md`);
  const time = new Date().toLocaleTimeString('fr-FR');
  const line = `\n## ${time}\n${entry.content}\n` +
    (entry.tags?.length ? `*Tags: ${entry.tags.join(', ')}*\n` : '') +
    (entry.techStack?.length ? `*Stack: ${entry.techStack.join(', ')}*\n` : '');
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# Journal PROMETHEUS — ${today()}\n`);
  fs.appendFileSync(file, line);
  return { file, time };
}

async function addChangelogEntry(entry) {
  const file = path.join(DOCS_DIR, 'CHANGELOG.md');
  const line = `\n### ${today()} — ${entry.title}\n${entry.description}\n` +
    (entry.impact ? `**Impact:** ${entry.impact}\n` : '');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# PROMETHEUS — Changelog\n');
  fs.appendFileSync(file, line);
  return { file };
}

async function extractFromConversation(message, response, sessionId) {
  const content = message + ' ' + response;
  const isTechnical = /code|bug|fix|deploy|install|config|erreur|error|module|api|server|docker|npm|git/i.test(content);
  const isDecision = /décid|choisi|opté|résolu|solution|finalement|on va|utiliser|implémenter/i.test(content);
  const isBugFix = /résolu|fixed|corrigé|ça marche|fonctionne maintenant/i.test(response);

  const tags = [];
  if (isTechnical) tags.push('technique');
  if (isDecision) tags.push('décision');
  if (isBugFix) tags.push('bug-fix');

  const techMatches = content.match(/\b(node|python|react|vue|postgres|redis|docker|nginx|pm2|claude|llama|chromadb|express|javascript|typescript)\b/gi) || [];
  const techStack = [...new Set(techMatches.map(t => t.toLowerCase()))];

  if (tags.length > 0 || techStack.length > 0) {
    await updateDailyJournal({ content: `**User:** ${message.slice(0, 150)}\n**PROMETHEUS:** ${response.slice(0, 200)}`, tags, techStack });
  }
  if (isDecision || isBugFix) {
    await addChangelogEntry({
      title: isBugFix ? 'Bug résolu' : 'Décision technique',
      description: isBugFix ? `Résolu: ${message.slice(0, 100)}` : `Décision: ${response.slice(0, 150)}`,
      impact: tags.join(', '),
    });
  }
  return { tags, techStack, documented: tags.length > 0 };
}

async function generateWeeklySummary() {
  const files = fs.readdirSync(DOCS_DIR).filter(f => f.startsWith('journal-')).sort().slice(-7);
  if (!files.length) return null;
  const content = files.map(f => fs.readFileSync(path.join(DOCS_DIR, f), 'utf8')).join('\n\n');
  try {
    const bridge = require('./claude-api-bridge');
    const r = await bridge.callFast(`Résume en 200 mots ce journal:\n${content.slice(0, 3000)}`, { maxTokens: 300 });
    const text = typeof r === 'string' ? r : r.content?.[0]?.text || '';
    const file = path.join(DOCS_DIR, `weekly-${today()}.md`);
    fs.writeFileSync(file, `# Résumé semaine ${today()}\n\n${text}\n`);
    return { file, summary: text };
  } catch (e) { return null; }
}

function getStats() {
  const files = fs.existsSync(DOCS_DIR) ? fs.readdirSync(DOCS_DIR) : [];
  const clFile = path.join(DOCS_DIR, 'CHANGELOG.md');
  return {
    journalDays: files.filter(f => f.startsWith('journal-')).length,
    weeklies: files.filter(f => f.startsWith('weekly-')).length,
    modules: files.filter(f => f.startsWith('module-')).length,
    changelogSize: fs.existsSync(clFile) ? fs.statSync(clFile).size : 0,
    docsDir: DOCS_DIR,
  };
}

module.exports = { updateDailyJournal, addChangelogEntry, extractFromConversation, generateWeeklySummary, getStats };
