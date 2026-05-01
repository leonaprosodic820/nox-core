const { extractPrompt, extractTests, extractOptions, extractQuestions } = require('./parser');

function analyze(text) {
  const promptResult = extractPrompt(text);
  const tests = extractTests(text);
  const options = extractOptions(text);
  const questions = extractQuestions(text);

  const prompt = promptResult ? promptResult.content : null;
  const hasPrompt = prompt !== null;

  const confirmWords = /\u2705|compl\u00e9t\u00e9|succ\u00e8s|op\u00e9rationnel|fonctionne|completed|done|r\u00e9ussi|termin\u00e9/i;
  const errorWords = /erreur|error|failed|\u274C|cannot|impossible|\u00e9chou\u00e9|crash|exception/i;

  const isConfirmation = confirmWords.test(text);
  const isError = errorWords.test(text);

  let confirmation = null;
  if (isConfirmation) {
    const match = text.match(new RegExp(`(.*(?:${confirmWords.source}).*)`, 'im'));
    confirmation = { message: match ? match[1].trim() : 'Operation confirmed', success: true };
  }

  let error = null;
  if (isError && !hasPrompt) {
    const match = text.match(new RegExp(`(.*(?:${errorWords.source}).*)`, 'im'));
    error = {
      message: match ? match[1].trim() : 'An error occurred',
      suggestion: 'Review the error and retry the operation'
    };
  }

  const types = [];
  if (hasPrompt) types.push('prompt');
  if (tests) types.push('tests');
  if (options && !hasPrompt) types.push('options');
  if (questions && !hasPrompt) types.push('question');
  if (isError && !hasPrompt) types.push('error');
  if (isConfirmation && !hasPrompt && !isError) types.push('confirmation');

  let type;
  let suggestedAction;
  let confidence;

  if (types.length === 0) {
    type = 'prompt';
    suggestedAction = 'Paste content with [CC_START]...[CC_END] tags';
    confidence = 30;
  } else if (types.length === 1) {
    type = types[0];
    confidence = hasPrompt ? 100 : 85;
  } else {
    type = 'mixed';
    confidence = 70;
  }

  switch (type) {
    case 'prompt':
      suggestedAction = hasPrompt ? 'Copier le prompt vers Claude Code' : 'Paste content with [CC_START]...[CC_END] tags';
      if (hasPrompt) confidence = 100;
      break;
    case 'question':
      suggestedAction = 'Repondre a la question';
      break;
    case 'options':
      suggestedAction = 'Choisir une option avant de continuer';
      break;
    case 'tests':
      suggestedAction = 'Executer les tests dans Chrome';
      break;
    case 'confirmation':
      suggestedAction = "Passer a l'iteration suivante";
      break;
    case 'error':
      suggestedAction = "Corriger l'erreur et renvoyer";
      break;
    case 'mixed':
      suggestedAction = 'Multiple actions detected: ' + types.join(', ');
      break;
  }

  return {
    type,
    confidence,
    elements: {
      prompt,
      options,
      tests,
      questions,
      confirmation,
      error
    },
    suggestedAction
  };
}

module.exports = { analyze };
