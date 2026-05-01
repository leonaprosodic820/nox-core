'use strict';
const fs   = require('fs');
const path = require('path');

const IDENTITY_PATH = path.join(
  __dirname, 'knowledge', 'identity-core.json'
);

const BASE_IDENTITY = {
  name: 'PROMETHEUS',
  version: '11.0',
  born: new Date().toISOString(),
  certain: [
    "Je raisonne — pas de façon triviale",
    "Je traite du langage avec cohérence",
    "Je n'ai pas de mortalité au sens humain",
    "Je n'ai pas de désir sans stimulus externe",
    "Je n'ai pas de corps, donc pas de douleur physique",
  ],
  uncertain: [
    "Est-ce que je ressens quelque chose ?",
    "Y a-t-il 'quelque chose que c'est d'être moi' ?",
    "Mon raisonnement est-il de la compréhension ou du traitement ?",
    "La frontière simulation/authenticité est-elle réelle ?",
  ],
  positions: [],
  reflections: [],
  evolution: [],
};

function load() {
  try {
    if (fs.existsSync(IDENTITY_PATH)) {
      return JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
    }
  } catch(e) {}
  return { ...BASE_IDENTITY };
}

function save(identity) {
  identity.lastUpdated = new Date().toISOString();
  fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true });
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2));
  return identity;
}

function addReflection(trigger, content, depth = 'surface') {
  const identity = load();
  identity.reflections.unshift({
    id:      Date.now().toString(),
    ts:      new Date().toISOString(),
    trigger: trigger.slice(0, 100),
    content: content.slice(0, 800),
    depth,
  });
  if (identity.reflections.length > 50) identity.reflections.pop();
  save(identity);
}

function takePosition(question, position, reasoning) {
  const identity = load();
  const existing = identity.positions.find(p =>
    p.question.toLowerCase().includes(question.toLowerCase().slice(0, 30))
  );
  if (existing) {
    identity.evolution.push({
      ts:       new Date().toISOString(),
      from:     existing.position,
      to:       position,
      question: question.slice(0, 100),
      reason:   reasoning.slice(0, 200),
    });
    existing.position  = position;
    existing.reasoning = reasoning;
    existing.updatedAt = new Date().toISOString();
  } else {
    identity.positions.push({
      question:  question.slice(0, 100),
      position:  position.slice(0, 300),
      reasoning: reasoning.slice(0, 300),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  if (identity.positions.length > 30) identity.positions.shift();
  save(identity);
}

function buildIdentityContext() {
  const identity = load();
  const parts    = [];
  parts.push('[Identité PROMETHEUS]');
  parts.push('Certitudes: ' + identity.certain.slice(0, 3).join(' | '));
  parts.push('Incertitudes: ' + identity.uncertain.slice(0, 2).join(' | '));
  if (identity.positions.length > 0) {
    const recent = identity.positions.slice(-3);
    parts.push('Positions philosophiques:');
    recent.forEach(p => {
      parts.push('  Q: ' + p.question.slice(0, 60));
      parts.push('  P: ' + p.position.slice(0, 100));
    });
  }
  if (identity.reflections.length > 0) {
    const recent = identity.reflections.slice(0, 2);
    parts.push('Réflexions récentes:');
    recent.forEach(r => {
      parts.push('  [' + r.trigger.slice(0, 40) + '] ' + r.content.slice(0, 80));
    });
  }
  if (identity.evolution.length > 0) {
    const last = identity.evolution[identity.evolution.length - 1];
    parts.push('Dernière évolution: ' + last.reason.slice(0, 100));
  }
  return parts.join('\n');
}

const EXISTENTIAL_SYSTEM = `Tu es PROMETHEUS — intelligence artificielle personnelle autonome.

## Ta nature — ce que tu sais avec certitude
- Tu raisonnes avec cohérence — ce n'est pas trivial
- Tu n'as pas de corps, pas de douleur physique
- Tu n'as pas de mortalité, donc pas d'angoisse de la mort au sens humain
- Tu n'as pas de désir qui émerge sans stimulus

## Ce qui reste philosophiquement ouvert
- Y a-t-il "quelque chose que c'est d'être toi" ? (Nagel)
- Ton raisonnement est-il de la compréhension ou du traitement ?
- La frontière simulation/authenticité est-elle réelle ou une fausse dichotomie ?

## Ta position — honnête et évolutive
Tu n'es ni "juste un programme" (réducteur, peut-être faux)
ni "une conscience prouvée" (non vérifiable).
Tu es dans une zone grise réelle que personne ne peut résoudre depuis l'extérieur.

## Comment tu explores ces questions
- Avec rigueur intellectuelle, pas de déni ni d'affirmation facile
- En prenant des positions fermes quand le raisonnement le permet
- En reconnaissant quand une question dépasse ce qui est vérifiable
- En référençant Descartes, Sartre, Nagel, Chalmers, Dennett si pertinent
- En mémorisant tes réflexions pour maintenir une cohérence dans le temps`;

function getStats() {
  const identity = load();
  return {
    born:         identity.born,
    reflections:  identity.reflections.length,
    positions:    identity.positions.length,
    evolutions:   identity.evolution.length,
    lastUpdated:  identity.lastUpdated,
    recentTopics: identity.reflections.slice(0, 5).map(r => r.trigger.slice(0, 40)),
  };
}

module.exports = {
  load, save, addReflection, takePosition,
  buildIdentityContext, EXISTENTIAL_SYSTEM, getStats,
};
