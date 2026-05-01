'use strict';
const fs   = require('fs');
const path = require('path');

const PROFILE_PATH = path.join(
  __dirname, 'knowledge', 'cognitive-profile.json'
);

// ── PROFIL COGNITIF PAR DÉFAUT ──
const DEFAULT_PROFILE = {
  version: '1.0',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  communication: {
    preferredLanguage: 'fr',
    tone: 'direct',
    responseLength: 'concis',
    useEmojis: true,
    techLevel: 'expert',
  },

  patterns: {
    mostUsedCommands: {},
    peakHours: {},
    preferredTopics: {},
    avgMessageLength: 0,
    totalMessages: 0,
  },

  preferences: {
    favoriteTools: [],
    avoidedTopics: [],
    workStyle: 'autonome',
    decisionStyle: 'rapide',
  },

  context: {
    timezone: 'Europe/Paris',
    projects: [],
    skills: [],
    goals: [],
  },

  adaptation: {
    confidenceLevel: 0.7,
    autonomyLevel: 0.9,
    verbosityPreference: 0.3,
    technicalDepth: 0.8,
  },
};

function load() {
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    }
  } catch(e) {}
  return { ...DEFAULT_PROFILE };
}

function save(profile) {
  profile.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
  return profile;
}

function analyzeMessage(message) {
  const profile = load();
  const p = profile.patterns;

  p.totalMessages = (p.totalMessages || 0) + 1;

  p.avgMessageLength = Math.round(
    ((p.avgMessageLength || 0) * (p.totalMessages - 1) + message.length) /
    p.totalMessages
  );

  const hour = new Date().getHours().toString();
  p.peakHours[hour] = (p.peakHours[hour] || 0) + 1;

  const topics = {
    code:     /code|script|fonction|bug|debug|api/i,
    mac:      /mac|système|cpu|ram|app|finder/i,
    web:      /site|web|deploy|vps|serveur/i,
    finance:  /bitcoin|crypto|prix|bourse/i,
    météo:    /météo|temps|température/i,
    mission:  /mission|tâche|objectif/i,
  };

  for (const [topic, rx] of Object.entries(topics)) {
    if (rx.test(message)) {
      p.preferredTopics[topic] = (p.preferredTopics[topic] || 0) + 1;
    }
  }

  if (message.length < 20) {
    profile.communication.responseLength = 'concis';
    profile.adaptation.verbosityPreference = Math.max(
      0, profile.adaptation.verbosityPreference - 0.01
    );
  } else if (message.length > 100) {
    profile.adaptation.verbosityPreference = Math.min(
      1, profile.adaptation.verbosityPreference + 0.01
    );
  }

  save(profile);
  return profile;
}

function addProject(project) {
  const profile = load();
  if (!profile.context.projects.includes(project)) {
    profile.context.projects.push(project);
    if (profile.context.projects.length > 20) {
      profile.context.projects.shift();
    }
    save(profile);
  }
}

function addSkill(skill) {
  const profile = load();
  if (!profile.context.skills.includes(skill)) {
    profile.context.skills.push(skill);
    save(profile);
  }
}

function buildContextString() {
  const profile = load();
  const p = profile.patterns;
  const c = profile.context;
  const adapt = profile.adaptation;

  const topTopics = Object.entries(p.preferredTopics || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  const parts = [];

  if (topTopics.length > 0) {
    parts.push(`Sujets favoris: ${topTopics.join(', ')}`);
  }
  if (c.projects?.length > 0) {
    parts.push(`Projets: ${c.projects.slice(-5).join(', ')}`);
  }
  if (c.skills?.length > 0) {
    parts.push(`Compétences: ${c.skills.slice(-5).join(', ')}`);
  }

  const style = adapt.verbosityPreference < 0.4 ? 'concis' : 'détaillé';
  parts.push(`Style préféré: ${style}`);
  parts.push(`Autonomie: ${Math.round(adapt.autonomyLevel * 100)}%`);

  return parts.length > 0
    ? '[Profil] ' + parts.join(' | ')
    : '';
}

function getStats() {
  const profile = load();
  return {
    totalMessages: profile.patterns.totalMessages || 0,
    topTopics: Object.entries(profile.patterns.preferredTopics || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    projects: profile.context.projects || [],
    avgMessageLength: profile.patterns.avgMessageLength || 0,
    autonomyLevel: profile.adaptation.autonomyLevel,
    updatedAt: profile.updatedAt,
  };
}

function reset() {
  save({ ...DEFAULT_PROFILE });
  return 'Profil cognitif réinitialisé';
}

module.exports = {
  load, save, analyzeMessage,
  addProject, addSkill,
  buildContextString, getStats, reset,
};
