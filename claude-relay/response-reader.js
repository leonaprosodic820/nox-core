const { extractPrompt, extractTests, extractOptions, extractQuestions } = require('./parser');

function deepRead(rawText, sessionContext = {}) {
  const text = (rawText || '').trim();
  if (!text) return emptyResult(text);

  const language = detectLanguage(text);
  const sections = segmentSections(text);

  // Raw extraction via parser
  const promptResult = extractPrompt(text);
  const prompt = promptResult ? promptResult.content : null;
  const options = extractOptions(text);
  const tests = extractTests(text);
  const questions = extractQuestions(text);

  // Confirmation/error detection
  const confirmWords = /✅|complété|succès|opérationnel|fonctionne|completed|done|réussi|terminé/i;
  const errorWords = /erreur|error|failed|❌|cannot|impossible|échoué|crash|exception/i;
  const isConfirmation = confirmWords.test(text);
  const isError = errorWords.test(text);

  const confirmation = isConfirmation ? { message: (text.match(new RegExp(`(.*(?:${confirmWords.source}).*)`, 'im')) || ['', 'Confirmed'])[1].trim(), success: true } : null;
  const error = isError ? { message: (text.match(new RegExp(`(.*(?:${errorWords.source}).*)`, 'im')) || ['', 'Error'])[1].trim(), type: 'runtime', suggestion: 'Review and fix the error' } : null;

  // Entity extraction
  const extractedEntities = extractEntities(text);

  // Determine primary intent and action
  let primaryIntent, actionRequired, actionType;

  if (prompt) {
    primaryIntent = 'execute_prompt';
    actionRequired = true;
    actionType = 'execute_prompt';
  } else if (options && options.length > 0) {
    primaryIntent = 'needs_choice';
    actionRequired = true;
    actionType = 'choose_option';
  } else if (questions && questions.length > 0) {
    primaryIntent = 'needs_answer';
    actionRequired = true;
    actionType = 'answer_question';
  } else if (tests) {
    primaryIntent = 'run_tests';
    actionRequired = true;
    actionType = 'run_tests';
  } else if (isError && !isConfirmation) {
    primaryIntent = 'needs_fix';
    actionRequired = true;
    actionType = 'fix_error';
  } else if (isConfirmation && !isError) {
    primaryIntent = 'task_complete';
    actionRequired = false;
    actionType = 'acknowledge_success';
  } else {
    primaryIntent = 'provide_info';
    actionRequired = false;
    actionType = 'provide_info';
  }

  // Complexity
  const complexity = determineComplexity(text, sections, isError);

  // Confidence
  let confidence = 50;
  if (prompt) confidence = 100;
  else if (options) confidence = 90;
  else if (questions) confidence = 85;
  else if (tests) confidence = 90;
  else if (isConfirmation) confidence = 85;
  else if (isError) confidence = 80;

  // Warnings
  const warnings = [];
  if (text.length > 10000) warnings.push('Very long response - may contain multiple topics');
  if (prompt && questions) warnings.push('Both prompt and questions detected - verify intent');
  if (isError && isConfirmation) warnings.push('Both error and confirmation signals detected');

  // Multiple CC_START blocks - take last one
  const ccMatches = text.match(/\[CC[-_]?START\]/gi);
  if (ccMatches && ccMatches.length > 1) warnings.push('Multiple CC_START blocks - using last one');

  // Suggested next step
  const suggestedNextStep = getSuggestedNextStep(actionType);

  return {
    rawText: text,
    language,
    sections,
    primaryIntent,
    actionRequired,
    actionType,
    extractedEntities,
    prompt,
    options,
    tests,
    questions,
    confirmation,
    error,
    complexity,
    confidence,
    warnings,
    suggestedNextStep
  };
}

function emptyResult(text) {
  return {
    rawText: text || '', language: 'unknown', sections: [],
    primaryIntent: 'provide_info', actionRequired: false, actionType: 'wait',
    extractedEntities: { files: [], commands: [], urls: [], ports: [], technologies: [], envVars: [], errorMessages: [], packageNames: [] },
    prompt: null, options: null, tests: null, questions: null, confirmation: null, error: null,
    complexity: 'simple', confidence: 0, warnings: ['Empty input'], suggestedNextStep: 'Provide content to analyze'
  };
}

function detectLanguage(text) {
  const frWords = /\b(le|la|les|de|du|des|un|une|est|sont|pour|dans|avec|sur|pas|qui|que|ce|cette|il|elle|nous|vous|ils|elles|faire|avoir|être)\b/gi;
  const enWords = /\b(the|is|are|was|were|have|has|had|will|would|could|should|this|that|with|from|they|their|been|being|does|did)\b/gi;
  const frCount = (text.match(frWords) || []).length;
  const enCount = (text.match(enWords) || []).length;
  if (frCount > enCount * 1.5) return 'fr';
  if (enCount > frCount * 1.5) return 'en';
  return 'mixed';
}

function segmentSections(text) {
  const sections = [];
  // Split by markdown headers or double newlines
  const parts = text.split(/\n(?=#{1,3}\s)|(?:\n\s*\n)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    sections.push({
      title: headerMatch ? headerMatch[2] : '',
      content: headerMatch ? trimmed.slice(headerMatch[0].length).trim() : trimmed,
      type: headerMatch ? 'headed' : 'paragraph'
    });
  }
  return sections.length > 0 ? sections : [{ title: '', content: text, type: 'paragraph' }];
}

function extractEntities(text) {
  const files = [...new Set((text.match(/[a-zA-Z0-9_\/.@-]+\.(js|ts|tsx|jsx|py|json|yaml|yml|md|css|html|sh|sql|env|toml|cfg)/g) || []))];
  const commands = [...new Set((text.match(/(?:npm|yarn|pnpm|pip|brew|apt|cargo|go)\s+\S+(?:\s+\S+)*/g) || []))];
  const urls = [...new Set((text.match(/https?:\/\/[^\s)>"]+/g) || []))];
  const portMatches = text.match(/(?:port|PORT|localhost:)\s*(\d{4,5})/g) || [];
  const ports = [...new Set(portMatches.map(p => parseInt(p.match(/\d{4,5}/)[0])).filter(n => n >= 1024 && n <= 65535))];
  const techPatterns = { 'Node.js': /\bnode\.?js\b/i, 'Express': /\bexpress\b/i, 'React': /\breact\b/i, 'TypeScript': /\btypescript\b|\.tsx?\b/i, 'Python': /\bpython\b/i, 'Docker': /\bdocker\b/i, 'PostgreSQL': /\bpostgres/i, 'MongoDB': /\bmongo/i, 'Redis': /\bredis\b/i, 'Next.js': /\bnext\.?js\b/i, 'Vue': /\bvue\b/i, 'Jest': /\bjest\b/i, 'WebSocket': /\bwebsocket\b|\bws\b/i };
  const technologies = Object.entries(techPatterns).filter(([, p]) => p.test(text)).map(([t]) => t);
  const envVars = [...new Set((text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || []).filter(v => !['GET','POST','PUT','DELETE','NULL','TRUE','FALSE','JSON','HTML','CSS','URL','API','HTTP','HTTPS','EOF','TODO'].includes(v)))];
  const errorMessages = [...new Set((text.match(/(?:Error|TypeError|ReferenceError|SyntaxError|ENOENT|EACCES|ECONNREFUSED):\s*.+/g) || []))];
  const packageNames = [...new Set((text.match(/(?:npm install|yarn add|pip install)\s+(.+)/g) || []).flatMap(m => m.replace(/^(?:npm install|yarn add|pip install)\s+/, '').split(/\s+/).filter(p => p && !p.startsWith('-'))))];

  return { files, commands, urls, ports, technologies, envVars, errorMessages, packageNames };
}

function determineComplexity(text, sections, isError) {
  if (isError && /fatal|critical|SIGKILL|kernel|panic/i.test(text)) return 'critical';
  if (sections.length > 5 || text.length > 5000) return 'complex';
  if (sections.length > 2 || text.length > 1000) return 'medium';
  return 'simple';
}

function getSuggestedNextStep(actionType) {
  const map = {
    execute_prompt: 'Copy and execute the prompt in Claude Code',
    choose_option: 'Select the best option and generate prompt',
    answer_question: 'Generate answers and send to Claude Chat',
    run_tests: 'Execute tests in browser DevTools',
    fix_error: 'Apply the correction and retry',
    acknowledge_success: 'Move to next iteration or complete session',
    provide_info: 'Store information and continue',
    wait: 'Wait for more context'
  };
  return map[actionType] || 'Analyze further';
}

module.exports = { deepRead, detectLanguage, segmentSections, extractEntities, determineComplexity };
