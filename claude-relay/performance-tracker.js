const fs = require('fs');
const path = require('path');

const METRICS_DIR = path.join(__dirname, 'metrics');
fs.mkdirSync(METRICS_DIR, { recursive: true });

class PerformanceTracker {
  constructor() {
    this.sessions = new Map();
    this.global = {
      totalIterations: 0, totalEnhancements: 0, totalPreventedErrors: 0,
      totalPromptsSent: 0, completions: 0, escalations: 0, startTime: Date.now()
    };
  }

  trackIteration(sessionId, data) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { iterations: 0, qualityScores: [], actions: [], enhancements: 0, preventedErrors: 0, startTime: Date.now() });
    }
    const m = this.sessions.get(sessionId);
    m.iterations++;
    m.qualityScores.push(data.qualityScore || 0);
    m.actions.push(data.action || 'unknown');
    m.enhancements += data.enhancements || 0;
    m.preventedErrors += data.preventedErrors || 0;

    this.global.totalIterations++;
    this.global.totalEnhancements += data.enhancements || 0;
    this.global.totalPreventedErrors += data.preventedErrors || 0;
    if (data.action === 'mark_complete') this.global.completions++;
    if (data.action === 'escalate') this.global.escalations++;
    if (data.action === 'send_to_claude_code' || data.action === 'execute_prompt') this.global.totalPromptsSent++;
  }

  getSessionReport(sessionId) {
    const m = this.sessions.get(sessionId);
    if (!m) return null;
    const avg = m.qualityScores.length > 0 ? Math.round(m.qualityScores.reduce((s, q) => s + q, 0) / m.qualityScores.length) : 0;
    return {
      sessionId, iterations: m.iterations, avgQualityScore: avg,
      totalEnhancements: m.enhancements, totalPreventedErrors: m.preventedErrors,
      durationSeconds: Math.floor((Date.now() - m.startTime) / 1000),
      actionBreakdown: m.actions.reduce((a, x) => { a[x] = (a[x] || 0) + 1; return a; }, {})
    };
  }

  getGlobalReport() {
    const uptime = Math.floor((Date.now() - this.global.startTime) / 1000);
    const total = this.global.totalIterations || 1;
    return {
      ...this.global,
      uptimeSeconds: uptime,
      activeSessions: this.sessions.size,
      iterationsPerHour: Math.round(total / Math.max(uptime / 3600, 0.01)),
      completionRate: Math.round((this.global.completions / total) * 100),
      escalationRate: Math.round((this.global.escalations / total) * 100)
    };
  }
}

module.exports = new PerformanceTracker();
