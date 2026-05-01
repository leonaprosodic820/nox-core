const bridge = require('./claude-api-bridge');

const STRATEGY_SYSTEM = `You are a Senior Technical Strategist.
Define the optimal strategy for a development project.

Return ONLY JSON:
{
  "phase": "planning|foundation|core|features|testing|deployment|optimization",
  "currentMilestone": "description",
  "nextMilestones": ["milestone 2"],
  "criticalPath": ["step 1", "step 2"],
  "risks": [{"risk":"...","probability":0-100,"mitigation":"..."}],
  "accelerators": ["shortcut 1"],
  "recommendedApproach": "description",
  "estimatedIterations": number,
  "successMetrics": ["metric 1"]
}`;

async function getStrategy(omegaResult, state) {
  try {
    const userMsg = `Analysis: ${JSON.stringify(omegaResult?.analysis || {}).slice(0, 500)}
Navigation: ${JSON.stringify(omegaResult?.navigation || {}).slice(0, 300)}
Phase: ${state?.currentPhase || 'unknown'}
Iteration: ${state?.iteration || 0}
Progress: ${state?.progressPercent || 0}%

Define the optimal strategy for the next steps.`;

    const response = await bridge.call(userMsg, { systemPrompt: STRATEGY_SYSTEM, timeoutMs: 45000 });
    return bridge.parseJSON(response);
  } catch {
    return {
      phase: state?.currentPhase || 'implementation',
      currentMilestone: 'Continue implementation',
      nextMilestones: [],
      criticalPath: [],
      risks: [],
      accelerators: [],
      recommendedApproach: 'Continue with current approach',
      estimatedIterations: 5,
      successMetrics: []
    };
  }
}

module.exports = { getStrategy };
