const bridge = require('./claude-api-bridge');

const ENHANCER_SYSTEM = `You are the world's best Prompt Engineer for Claude Code.
You receive a prompt and MUST improve it to be perfect.

Rules:
1. Add missing file paths and dependencies
2. Eliminate all ambiguity
3. Add success criteria and validation steps
4. Structure with clear numbered steps
5. Anticipate errors and add handling

Return ONLY JSON:
{
  "enhancedPrompt": "the improved prompt wrapped in [CC_START]...[CC_END]",
  "improvements": ["improvement 1", "improvement 2"],
  "qualityScore": 0-100,
  "estimatedSuccessRate": 0-100
}`;

async function enhance(originalPrompt, projectContext = {}) {
  if (!originalPrompt || originalPrompt.trim().length < 10) {
    return { enhancedPrompt: originalPrompt, improvements: [], qualityScore: 30, estimatedSuccessRate: 30 };
  }

  try {
    const userMsg = `PROJECT CONTEXT:
Name: ${projectContext.name || 'N/A'}
Stack: ${(projectContext.techStack || []).join(', ')}
Files: ${(projectContext.codeContext?.files || []).slice(0, 10).join(', ')}
Known issues to avoid: ${(projectContext.knownIssues || []).map(i => i.issue || i).slice(0, 5).join(', ')}

ORIGINAL PROMPT:
${originalPrompt}

Improve this prompt to perfection.`;

    const response = await bridge.call(userMsg, { systemPrompt: ENHANCER_SYSTEM, timeoutMs: 60000 });
    return bridge.parseJSON(response);
  } catch (e) {
    return { enhancedPrompt: originalPrompt, improvements: [], qualityScore: 50, estimatedSuccessRate: 50, error: e.message };
  }
}

async function enhanceForChat(message, context = {}) {
  try {
    const response = await bridge.call(
      `Improve this message being sent to Claude Chat. Add context, structure it clearly, specify expected response format. Return ONLY the improved message text, nothing else.\n\nOriginal: ${message}\nProject: ${JSON.stringify(context).slice(0, 300)}`,
      { timeoutMs: 30000 }
    );
    return response.content[0].text;
  } catch { return message; }
}

module.exports = { enhance, enhanceForChat };
