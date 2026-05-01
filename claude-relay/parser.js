function extractPrompt(text) {
  if (!text) return null;
  const startMatch = text.match(/\[CC[-_]?START\]/i);
  if (!startMatch) return null;
  const endMatch = text.match(/\[CC[-_]?END\]/i);
  if (!endMatch) return null;

  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = text.search(/\[CC[-_]?END\]/i);
  if (endIdx <= startIdx) return { content: null, flag: 'empty_prompt' };

  const content = text.slice(startIdx, endIdx).trim();
  if (!content) return { content: null, flag: 'empty_prompt' };
  return { content, flag: null };
}

function extractTests(text) {
  if (!text) return null;
  const startMatch = text.match(/\[TEST[-_]?START\]/i);
  if (!startMatch) return null;
  const endMatch = text.match(/\[TEST[-_]?END\]/i);
  if (!endMatch) return null;

  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = text.search(/\[TEST[-_]?END\]/i);
  const content = text.slice(startIdx, endIdx).trim();
  if (!content) return null;

  const lines = content.split('\n').filter(l => l.trim());
  const steps = [];
  let stepNum = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const numbered = trimmed.match(/^(?:Step\s*)?(\d+)[.):\s-]+\s*(.+)/i)
      || trimmed.match(/^-\s*(?:Test\s*:?\s*)?(.+)/i);
    if (!numbered) continue;
    stepNum++;

    let action, expected;
    const fullText = numbered[2] || numbered[1];

    if (fullText.includes('\u2192')) {
      [action, expected] = fullText.split('\u2192').map(s => s.trim());
    } else if (fullText.includes('->')) {
      [action, expected] = fullText.split('->').map(s => s.trim());
    } else {
      action = fullText;
      expected = '';
    }

    let jsCommand = null;
    const jsMatch = fullText.match(/((?:console|document|window)\.[^\u2192]*?)(?:\s*\u2192|\s*->|$)/);
    if (jsMatch) jsCommand = jsMatch[1].trim();

    steps.push({ step: stepNum, action: action || '', expected: expected || '', jsCommand });
  }

  return steps.length > 0 ? steps : null;
}

function extractOptions(text) {
  if (!text) return null;
  const options = [];
  const recKeywords = /recommand[e\u00e9]|recommended|\u2b50|je conseille|suggested|preferred|meilleure option|i suggest/i;

  const patterns = [
    /^(?:Option\s+)?([A-C])\s*[):]\s*(.+)/gim,
    /^([A-C])\)\s*(.+)/gim,
    /^-\s*Option\s+(\d+)\s*[):]\s*(.+)/gim,
  ];

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const label = m[1];
      const description = m[2].trim();
      const recommended = recKeywords.test(description);
      const cleanDesc = description.replace(recKeywords, '').trim();
      if (!options.find(o => o.label === label && o.description === cleanDesc)) {
        options.push({ label, description: cleanDesc, recommended });
      }
    }
  }

  const numberedCtx = /chois|option|select|prefer|pick/i.test(text);
  if (options.length === 0 && numberedCtx) {
    const numPat = /^(\d+)\.\s+(.+)/gm;
    let m;
    while ((m = numPat.exec(text)) !== null) {
      const description = m[2].trim();
      const recommended = recKeywords.test(description);
      const cleanDesc = description.replace(recKeywords, '').trim();
      options.push({ label: m[1], description: cleanDesc, recommended });
    }
  }

  return options.length > 0 ? options : null;
}

function extractQuestions(text) {
  if (!text) return null;
  const questions = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const hasQuestionMark = trimmed.endsWith('?');
    const hasImplicit = /\b(quel(?:le)?s?|voulez-vous|pr\u00e9f\u00e9rez-vous|souhaitez|avez-vous|which|do you|would you|should we|can you)\b/i.test(trimmed);

    if (!hasQuestionMark && !hasImplicit) continue;

    let answerType = 'text';
    if (/\b(oui|non|yes|no|true|false|confirme[rz]?)\b/i.test(trimmed)) {
      answerType = 'confirm';
    } else if (/\b(option|chois|select|pick|prefer|A\)|B\)|C\))\b/i.test(trimmed)) {
      answerType = 'choice';
    }

    questions.push({ text: trimmed, answerType });
  }

  return questions.length > 0 ? questions : null;
}

module.exports = { extractPrompt, extractTests, extractOptions, extractQuestions };
