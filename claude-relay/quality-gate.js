const RULES = [
  { name: 'length', check: p => p.length > 50, score: 10, fix: 'Add more detail' },
  { name: 'objective', check: p => /créer|modifier|installer|tester|corriger|ajouter|supprimer|lancer|configurer|create|add|fix|test|install|run|build/i.test(p), score: 15, fix: 'Add a clear action verb' },
  { name: 'file_context', check: p => /\.\w{2,4}\b|\/|npm|node|pip/i.test(p), score: 15, fix: 'Specify file paths' },
  { name: 'success_crit', check: p => /test|valid|verify|confirm|curl|console|expect|check/i.test(p), score: 15, fix: 'Add validation steps' },
  { name: 'structured', check: p => p.includes('\n') || /\d\.|[-•]/.test(p), score: 10, fix: 'Structure with steps' },
  { name: 'no_vague', check: p => !/quelque chose|truc|machin|stuff|something/i.test(p), score: 15, fix: 'Be specific' },
  { name: 'has_context', check: p => /projet|session|server|port|fichier|project|module/i.test(p), score: 10, fix: 'Add project context' },
];

const MAX_SCORE = RULES.reduce((s, r) => s + r.score, 0);
const MIN_QUALITY = 50;

function check(prompt, context = {}) {
  const p = prompt || '';
  let score = 0;
  const passed = [], failed = [], suggestions = [];

  for (const rule of RULES) {
    if (rule.check(p)) { score += rule.score; passed.push(rule.name); }
    else { failed.push(rule.name); suggestions.push(rule.fix); }
  }

  let improved = p;
  if (score < MIN_QUALITY && failed.length > 0) {
    improved = improveLocally(p, failed, context);
    score = RULES.filter(r => r.check(improved)).reduce((s, r) => s + r.score, 0);
  }

  return { approved: score >= MIN_QUALITY, score, maxScore: MAX_SCORE, passed, failed, suggestions, prompt: improved, usedAPI: false };
}

function improveLocally(prompt, failedRules, context) {
  let improved = prompt;
  const pm = context.projectMemory || {};

  if (failedRules.includes('success_crit')) {
    improved += '\n\nVerify: test the result and confirm it works.';
  }
  if (failedRules.includes('file_context') && pm.codeContext?.files?.length) {
    improved = `Files: ${pm.codeContext.files.slice(0, 5).join(', ')}\n\n${improved}`;
  }
  if (failedRules.includes('structured') && !improved.includes('\n')) {
    improved = `Goal:\n${improved}\n\nSteps:\n1. Execute\n2. Test\n3. Confirm`;
  }
  return improved;
}

module.exports = { check, RULES, MIN_QUALITY, MAX_SCORE };
