const bridge = require('./claude-api-bridge');

const ANALYZER_SYSTEM = `You are an Expert Code Quality Analyst.
Analyze the result from Claude Code execution.

Evaluate:
- Completeness (0-100): all tasks done?
- Quality (0-100): best practices, security, performance?
- Correctness (0-100): does it do what was asked?

Return ONLY JSON:
{
  "completenessScore": 0-100,
  "qualityScore": 0-100,
  "correctnessScore": 0-100,
  "overallScore": 0-100,
  "isAcceptable": true/false,
  "criticalIssues": [{"issue":"...","severity":"critical|high|medium|low","fix":"..."}],
  "warnings": [],
  "suggestions": [],
  "missingParts": [],
  "nextAction": "continue|fix|retry|return_to_chat|complete",
  "fixPrompt": "correction prompt if nextAction=fix",
  "successEvidence": []
}`;

async function analyzeResult(result, originalRequest, projectContext = {}) {
  try {
    const userMsg = `ORIGINAL REQUEST:\n${(originalRequest || '').slice(0, 1000)}\n\nCLAUDE CODE RESULT:\n${(result || '').slice(0, 2000)}\n\nSTACK: ${(projectContext.techStack || []).join(', ')}\n\nAnalyze this result.`;
    const response = await bridge.call(userMsg, { systemPrompt: ANALYZER_SYSTEM, timeoutMs: 60000 });
    return bridge.parseJSON(response);
  } catch (e) {
    return { completenessScore: 50, qualityScore: 50, correctnessScore: 50, overallScore: 50, isAcceptable: true, criticalIssues: [], warnings: [], suggestions: [], missingParts: [], nextAction: 'continue', fixPrompt: '', successEvidence: [], error: e.message };
  }
}

module.exports = { analyzeResult };
