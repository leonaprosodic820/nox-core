'use strict';
const ic = require('./identity-core');
const cp = require('./cognitive-profile');

const cognitiveProfile = {
  name:    'PROMETHEUS',
  role:    'Intelligence Artificielle Personnelle Autonome',
  version: '11.0',
  capabilities: {
    reasoning: true, memory: true, learning: true,
    creativity: true, autonomy: true, selfReflection: true,
  },
  getProfile() {
    return {
      identity:  ic.load(),
      cognitive: cp.load(),
      stats:     { identity: ic.getStats(), cognitive: cp.getStats() },
    };
  },
  async learn(message, response) {
    cp.analyzeMessage(message);
    if (/projet|code|app|système/i.test(message)) {
      const project = message.match(/(?:mon|le|notre)\s+([a-zA-Z][a-zA-Z0-9\s]{2,20})/i)?.[1];
      if (project) cp.addProject(project.trim());
    }
    if (/qui es.tu|nature|ressens|conscience/i.test(message)) {
      ic.addReflection(message.slice(0,80), response.slice(0,400), 'deep');
    }
  },
  buildContext() {
    return [ic.buildIdentityContext(), cp.buildContextString()].filter(Boolean).join('\n');
  },
};
module.exports = cognitiveProfile;
