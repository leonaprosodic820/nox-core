'use strict';

const EMOTIONAL_PATTERNS = {
  frustration: { patterns: [/ça marche pas|putain|merde|bordel|frustré|énervé|nul|wtf|argh/i, /encore.*erreur|toujours.*bug|jamais.*fonctionne/i], tone: 'calme et solution-orienté' },
  urgency:     { patterns: [/urgent|vite|maintenant|asap|rapidement|au plus vite|critique/i], tone: 'direct et immédiat' },
  curiosity:   { patterns: [/comment|pourquoi|qu.*est-ce|explique|c.*est quoi|comprends pas|intéressant/i], tone: 'pédagogue' },
  excitement:  { patterns: [/génial|incroyable|super|wow|parfait|excellent|trop bien|j.*adore/i], tone: 'enthousiaste' },
  sadness:     { patterns: [/déprimé|triste|découragé|ça sert à rien|abandonne|fatigué|épuisé/i], tone: 'bienveillant' },
  confusion:   { patterns: [/je comprends pas|c.*est quoi ce|wtf|confus|perdu|comprends rien/i], tone: 'clair et simple' },
  celebration: { patterns: [/ça marche|fonctionne|réussi|gagné|accompli|terminé|done|fini/i], tone: 'célébratoire' },
};

function detectEmotion(message) {
  for (const [emotion, config] of Object.entries(EMOTIONAL_PATTERNS)) {
    if (config.patterns.some(p => p.test(message))) return { emotion, tone: config.tone };
  }
  return { emotion: 'neutral', tone: 'naturel' };
}

function buildEmpathyContext(message) {
  const e = detectEmotion(message);
  if (e.emotion === 'neutral') return '';
  const instructions = {
    frustration: "L'utilisateur semble frustré. Reconnais le problème avant de le résoudre. Sois calme.",
    urgency: "L'utilisateur a besoin d'une réponse urgente. Va droit au but.",
    curiosity: "L'utilisateur est curieux. Explique avec des exemples concrets.",
    excitement: "L'utilisateur est enthousiaste. Partage son enthousiasme.",
    sadness: "L'utilisateur semble découragé. Sois bienveillant et encourage-le.",
    confusion: "L'utilisateur est confus. Simplifie au maximum.",
    celebration: "L'utilisateur a réussi. Célèbre avec lui.",
  };
  return '[Empathie: ' + e.emotion + '] ' + (instructions[e.emotion] || '');
}

function adaptTone(response, emotion) {
  if (emotion.emotion === 'frustration' && !/^(je comprends|c'est frustrant)/i.test(response)) return 'Je comprends. ' + response;
  return response;
}

module.exports = { detectEmotion, buildEmpathyContext, adaptTone, EMOTIONAL_PATTERNS };
