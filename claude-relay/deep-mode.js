'use strict';

const MAX_TOKENS_DEEP = 32000;
const TIMEOUT_DEEP = 600000;
const MAX_TOKENS_NORMAL = 4000;
const TIMEOUT_NORMAL = 90000;

const DEEP_KEYWORDS = [
  /construis.*complet/i, /projet.*entier/i, /application.*complète/i,
  /système.*complet/i, /de.*a.*z/i, /tout.*le.*code/i,
  /implémente.*complètement/i, /architecture.*complète/i,
  /analyse.*approfondie/i, /rapport.*détaillé/i,
  /documentation.*complète/i, /refactor.*entier/i,
];

function needsDeepMode(message, type) {
  var deepTypes = ['mission', 'orchestrator', 'creation', 'code', 'devops'];
  return DEEP_KEYWORDS.some(function(rx) { return rx.test(message); }) ||
    (deepTypes.indexOf(type) !== -1 && message.length > 100);
}

async function callDeep(message, systemPrompt, opts) {
  opts = opts || {};
  var bridge = require('./claude-api-bridge');
  var isDeep = opts.force || needsDeepMode(message, opts.type);
  var maxTokens = isDeep ? MAX_TOKENS_DEEP : (opts.maxTokens || MAX_TOKENS_NORMAL);
  var timeout = isDeep ? TIMEOUT_DEEP : TIMEOUT_NORMAL;

  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error('Timeout ' + (timeout/1000) + 's')); }, timeout);
    bridge.call(message, { systemPrompt: systemPrompt, maxTokens: maxTokens, useCache: false })
      .then(function(resp) {
        clearTimeout(timer);
        var text = typeof resp === 'string' ? resp : (resp.content && resp.content[0] ? resp.content[0].text : '');
        resolve({ text: text, isDeep: isDeep, maxTokens: maxTokens, routedTo: resp.routedTo });
      })
      .catch(function(e) { clearTimeout(timer); reject(e); });
  });
}

module.exports = { callDeep: callDeep, needsDeepMode: needsDeepMode, MAX_TOKENS_DEEP: MAX_TOKENS_DEEP, MAX_TOKENS_NORMAL: MAX_TOKENS_NORMAL, TIMEOUT_DEEP: TIMEOUT_DEEP };
