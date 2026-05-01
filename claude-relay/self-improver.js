const bridge = require('./claude-api-bridge');
const fs = require('fs');
const path = require('path');

const DECISIONS_DIR = path.join(__dirname, 'decisions');

const IMPROVER_SYSTEM = `You are an AI Self-Improvement Expert.
Analyze the performance data of an AI relay system and identify improvements.

Return ONLY JSON:
{
  "performanceScore": 0-100,
  "topSuccessPatterns": ["pattern 1"],
  "topFailurePatterns": ["pattern 1"],
  "recommendations": [{"area":"...","current":"...","recommended":"...","expectedImpact":"..."}],
  "adjustedThresholds": {"minPromptQuality":0-100,"confidenceThreshold":0-100,"maxIterationsBeforeEscalate":number},
  "newRules": ["learned rule 1"]
}`;

function summarizePerformance(decisions) {
  const total = decisions.length;
  if (total === 0) return { total: 0 };
  const byAction = {};
  let totalConf = 0;
  decisions.forEach(d => {
    byAction[d.action] = (byAction[d.action] || 0) + 1;
    totalConf += d.confidence || 0;
  });
  return {
    total,
    byAction,
    avgConfidence: Math.round(totalConf / total),
    escalationRate: Math.round(((byAction.escalate || 0) / total) * 100),
    completionRate: Math.round(((byAction.mark_complete || 0) / total) * 100)
  };
}

async function analyze(decisions, metrics = {}) {
  const summary = summarizePerformance(decisions);
  try {
    const userMsg = `Performance data:\n${JSON.stringify(summary, null, 2)}\n\nMetrics: ${JSON.stringify(metrics)}\n\nIdentify improvements.`;
    const response = await bridge.call(userMsg, { systemPrompt: IMPROVER_SYSTEM, timeoutMs: 60000 });
    return bridge.parseJSON(response);
  } catch {
    return { performanceScore: summary.avgConfidence, topSuccessPatterns: [], topFailurePatterns: [], recommendations: [], newRules: [] };
  }
}

function getLatestInsights() {
  const files = fs.readdirSync(DECISIONS_DIR).filter(f => f.startsWith('insights-')).sort().reverse();
  if (files.length === 0) return null;
  try { return JSON.parse(fs.readFileSync(path.join(DECISIONS_DIR, files[0]), 'utf-8')); } catch { return null; }
}

function scheduleDaily() {
  try {
    const cron = require('node-cron');
    cron.schedule('0 4 * * *', async () => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      const dateStr = date.toISOString().slice(0, 10);
      const logPath = path.join(DECISIONS_DIR, `${dateStr}.jsonl`);
      if (!fs.existsSync(logPath)) return;
      const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
      const decisions = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const insights = await analyze(decisions, { date: dateStr });
      if (insights) {
        fs.writeFileSync(path.join(DECISIONS_DIR, `insights-${dateStr}.json`), JSON.stringify(insights, null, 2));
      }
    });
  } catch {}
}

module.exports = { analyze, summarizePerformance, getLatestInsights, scheduleDaily };
