'use strict';
const analyze = {
  intent(message) {
    const p = require('./prompt-engine');
    const type = p.detectPromptType(message);
    return {
      type,
      maxTokens: p.PROMPTS[type]?.maxTokens || 800,
      model:     p.PROMPTS[type]?.model || 'claude',
    };
  },
  sentiment(text) {
    const positive = /bien|super|merci|parfait|génial|ok|oui|top/i;
    const negative = /non|problème|erreur|bug|cassé|marche pas|nul/i;
    const urgent   = /urgent|maintenant|vite|important|critique/i;
    return {
      positive: positive.test(text),
      negative: negative.test(text),
      urgent:   urgent.test(text),
      neutral:  !positive.test(text) && !negative.test(text),
    };
  },
  complexity(message) {
    const words = message.trim().split(/\s+/).length;
    const hasCode = /```|function|const|import|class/i.test(message);
    const isMulti = message.includes('\n') || message.includes(' et ');
    return {
      words,
      score: Math.min(1, words / 50 + (hasCode ? 0.3 : 0) + (isMulti ? 0.2 : 0)),
      hasCode, isMulti,
    };
  },
  async image(base64, mediaType, prompt) {
    const bridge = require('./claude-api-bridge');
    return bridge.callWithImage(prompt || 'Analyse cette image en détail en français', base64, mediaType || 'image/jpeg');
  },
  full(message) {
    return {
      intent: this.intent(message),
      sentiment: this.sentiment(message),
      complexity: this.complexity(message),
      timestamp: new Date().toISOString(),
    };
  },
};
module.exports = { analyze };
