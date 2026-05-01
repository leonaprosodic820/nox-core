const { deepRead, detectLanguage, segmentSections, extractEntities, determineComplexity } = require('../response-reader');

describe('response-reader', () => {
  const REQUIRED_KEYS = [
    'rawText', 'language', 'sections', 'primaryIntent', 'actionRequired',
    'actionType', 'extractedEntities', 'prompt', 'options', 'tests',
    'questions', 'confirmation', 'error', 'complexity', 'confidence',
    'warnings', 'suggestedNextStep'
  ];

  // T1
  test('deepRead returns object with all required fields', () => {
    const result = deepRead('Hello world');
    for (const key of REQUIRED_KEYS) {
      expect(result).toHaveProperty(key);
    }
  });

  // T2
  test('detects prompt [CC_START]echo test[CC_END] correctly', () => {
    const result = deepRead('[CC_START]echo test[CC_END]');
    expect(result.prompt).toBe('echo test');
    expect(result.primaryIntent).toBe('execute_prompt');
  });

  // T3
  test('does NOT confuse explanation text with prompt (no CC tags)', () => {
    const result = deepRead('This is just an explanation of how echo works in bash.');
    expect(result.prompt).toBeNull();
  });

  // T4
  test('takes FIRST CC_START block when multiple present and warns', () => {
    const text = '[CC_START]first command[CC_END]\nSome text\n[CC_START]second command[CC_END]';
    const result = deepRead(text);
    // extractPrompt uses String.match which returns the first match
    expect(result.prompt).toBe('first command');
    expect(result.warnings.some(w => /multiple/i.test(w))).toBe(true);
  });

  // T5
  test('detects implicit question without "?" (text with "voulez-vous")', () => {
    const result = deepRead('Voulez-vous continuer avec cette configuration');
    expect(result.questions).not.toBeNull();
    expect(result.questions.length).toBeGreaterThan(0);
  });

  // T6
  test('detects options without explicit tags', () => {
    const result = deepRead('Choisissez:\nOption A: Use Express\nOption B: Use Fastify');
    expect(result.options).not.toBeNull();
    expect(result.options.length).toBe(2);
  });

  // T7
  test('extracts entity files: text mentioning "server.js and utils.ts"', () => {
    const result = deepRead('You need to edit server.js and utils.ts for this to work.');
    expect(result.extractedEntities.files).toContain('server.js');
    expect(result.extractedEntities.files).toContain('utils.ts');
  });

  // T8
  test('extracts entity commands: "npm install express"', () => {
    const result = deepRead('Run npm install express to add the dependency.');
    expect(result.extractedEntities.commands.some(c => c.includes('npm install express'))).toBe(true);
  });

  // T9
  test('extracts entity URLs: "https://example.com"', () => {
    const result = deepRead('Check https://example.com for documentation.');
    expect(result.extractedEntities.urls).toContain('https://example.com');
  });

  // T10
  test('extracts entity ports: "port 3000 and PORT 8080"', () => {
    const result = deepRead('The server runs on port 3000 and PORT 8080 for the proxy.');
    expect(result.extractedEntities.ports).toContain(3000);
    expect(result.extractedEntities.ports).toContain(8080);
  });

  // T11
  test('extracts entity package names: "npm install express cors"', () => {
    const result = deepRead('Run npm install express cors to add dependencies.');
    expect(result.extractedEntities.packageNames).toContain('express');
    expect(result.extractedEntities.packageNames).toContain('cors');
  });

  // T12
  test('extracts entity env vars: "ANTHROPIC_API_KEY and NODE_ENV"', () => {
    const result = deepRead('Set ANTHROPIC_API_KEY and NODE_ENV before starting.');
    expect(result.extractedEntities.envVars).toContain('ANTHROPIC_API_KEY');
    expect(result.extractedEntities.envVars).toContain('NODE_ENV');
  });

  // T13
  test('extracts error messages: "Error: Cannot find module"', () => {
    const result = deepRead('Error: Cannot find module "express"');
    expect(result.extractedEntities.errorMessages.some(e => e.includes('Cannot find module'))).toBe(true);
  });

  // T14
  test('actionRequired=true when question present', () => {
    const result = deepRead('Do you want to proceed with this approach?');
    expect(result.actionRequired).toBe(true);
  });

  // T15
  test('actionRequired=false when only info text', () => {
    const result = deepRead('The server is running normally with all services operational.');
    // No CC tags, no questions, no errors in this neutral text
    expect(result.actionRequired).toBe(false);
  });

  // T16
  test('complexity=simple for short text without code', () => {
    const result = deepRead('Hello world.');
    expect(result.complexity).toBe('simple');
  });

  // T17
  test('complexity=complex for multi-section text (>5000 chars)', () => {
    const longText = 'A'.repeat(5001);
    const result = deepRead(longText);
    expect(result.complexity).toBe('complex');
  });

  // T18
  test('complexity=critical for fatal error text with isError', () => {
    const result = deepRead('fatal error: the system crashed with a kernel panic');
    expect(result.complexity).toBe('critical');
  });

  // T19
  test('confidence=100 when CC_START tags present with content', () => {
    const result = deepRead('[CC_START]do something[CC_END]');
    expect(result.confidence).toBe(100);
  });

  // T20
  test('confidence<70 for ambiguous text (no clear patterns)', () => {
    const result = deepRead('Some general information about the project architecture.');
    expect(result.confidence).toBeLessThan(70);
  });

  // T21
  test('segments text with markdown headers correctly', () => {
    const text = '# Introduction\nSome intro text\n\n## Details\nMore details here';
    const result = deepRead(text);
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    const headed = result.sections.filter(s => s.type === 'headed');
    expect(headed.length).toBeGreaterThan(0);
  });

  // T22
  test('detectLanguage returns "fr" for French text', () => {
    const lang = detectLanguage('Je suis dans la maison avec les enfants pour faire du travail.');
    expect(lang).toBe('fr');
  });

  // T23
  test('detectLanguage returns "en" for English text', () => {
    const lang = detectLanguage('The server is running and has been configured with the correct settings.');
    expect(lang).toBe('en');
  });

  // T24
  test('primaryIntent="execute_prompt" when CC_START present', () => {
    const result = deepRead('Here is the command:\n[CC_START]ls -la[CC_END]');
    expect(result.primaryIntent).toBe('execute_prompt');
  });

  // T25
  test('primaryIntent="provide_info" for pure explanatory text', () => {
    const result = deepRead('The architecture uses a microservices pattern with message queues.');
    expect(result.primaryIntent).toBe('provide_info');
  });

  // T26
  test('primaryIntent="needs_choice" when options detected (no CC tags)', () => {
    const result = deepRead('Choose one:\nOption A: Fast approach\nOption B: Safe approach');
    expect(result.primaryIntent).toBe('needs_choice');
  });

  // T27
  test('primaryIntent="needs_fix" when error detected (no CC tags, no confirmation)', () => {
    const result = deepRead('The process failed with an error code 1.');
    expect(result.primaryIntent).toBe('needs_fix');
  });

  // T28
  test('warnings non-empty for very long text (>10000 chars)', () => {
    const longText = 'This is some text. '.repeat(600);
    const result = deepRead(longText);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => /long/i.test(w))).toBe(true);
  });

  // T29
  test('suggestedNextStep non-empty for every action type', () => {
    const actionTypes = [
      '[CC_START]test[CC_END]',                              // execute_prompt
      'Choose:\nOption A: X\nOption B: Y',                    // choose_option
      'Do you want to proceed?',                              // answer_question
      'The system failed with an error in production.',       // fix_error
      'Just some general info about architecture.',           // provide_info
    ];
    for (const text of actionTypes) {
      const result = deepRead(text);
      expect(result.suggestedNextStep).toBeTruthy();
      expect(result.suggestedNextStep.length).toBeGreaterThan(0);
    }
  });

  // T30
  test('handles very long text (>10000 chars) without crash', () => {
    const longText = 'Word '.repeat(3000);
    expect(() => deepRead(longText)).not.toThrow();
    const result = deepRead(longText);
    expect(result).toBeDefined();
    expect(result.rawText.length).toBeGreaterThan(10000);
  });
});
