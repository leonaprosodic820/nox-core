'use strict';

const UNCERTAIN_WORDS = [
  'peut-être', 'environ', 'je pense', 'probablement', 'il me semble',
  'maybe', 'perhaps', 'probably', 'i think', 'it seems', 'might be',
  'could be', 'not sure', 'uncertain', 'possibly', 'approximately',
  'roughly', 'around', 'likely', 'unlikely', 'guess', 'assume'
];

const HEDGING = [
  'generally', 'usually', 'typically', 'often', 'sometimes', 'in most cases',
  'it depends', 'not always', 'en général', 'normalement', 'souvent',
  'dans la plupart des cas', 'ça dépend'
];

const FACTUAL_PATTERN = /\b\d{4}\b|\b\d+%|\b\d+\.\d+\b|\b\d{1,3}(,\d{3})+\b/g;

const MAX_HISTORY = 200;
const stats = {
  totalAnalyzed: 0,
  confidenceSum: 0,
  verdicts: { VERIFIED: 0, UNCERTAIN: 0, PROBLEM: 0, HALLUCINATION: 0 }
};

function analyzeResponse(response, question) {
  if (!response || typeof response !== 'string') {
    return { confidence: 0, signal: '🔴', verdict: 'HALLUCINATION', issues: ['Empty response'] };
  }

  let confidence = 100;
  const issues = [];
  const lower = response.toLowerCase();

  // Check uncertain words
  let uncertainCount = 0;
  for (const word of UNCERTAIN_WORDS) {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = lower.match(regex);
    if (matches) uncertainCount += matches.length;
  }
  if (uncertainCount > 0) {
    const penalty = Math.min(45, uncertainCount * 15);
    confidence -= penalty;
    issues.push(`${uncertainCount} uncertain expression(s) detected (-${penalty})`);
  }

  // Check factual claims without sources
  const factualMatches = response.match(FACTUAL_PATTERN) || [];
  if (factualMatches.length > 5) {
    const hasSource = /source|according to|reference|cited|documentation|official/i.test(response);
    if (!hasSource) {
      confidence -= 20;
      issues.push(`${factualMatches.length} factual claims without source (-20)`);
    }
  }

  // Response length vs question length ratio
  const questionLen = (question || '').length;
  const responseLen = response.length;
  if (questionLen > 0) {
    const ratio = responseLen / questionLen;
    if (ratio < 0.3) {
      confidence -= 10;
      issues.push('Response much shorter than question (-10)');
    } else if (ratio > 50) {
      confidence -= 5;
      issues.push('Response disproportionately long (-5)');
    }
  }

  // Hedging language
  let hedgeCount = 0;
  for (const hedge of HEDGING) {
    if (lower.includes(hedge)) hedgeCount++;
  }
  if (hedgeCount >= 3) {
    confidence -= 10;
    issues.push(`${hedgeCount} hedging expressions (-10)`);
  }

  // Contradictions (simple check)
  if (/\bbut actually\b|\bhowever.*\bcontrary\b|\bin fact.*\bnot\b/i.test(response)) {
    confidence -= 10;
    issues.push('Possible self-contradiction detected (-10)');
  }

  // Clamp
  confidence = Math.max(0, Math.min(100, confidence));

  let verdict, signal;
  if (confidence >= 80) { verdict = 'VERIFIED'; signal = '🟢'; }
  else if (confidence >= 50) { verdict = 'UNCERTAIN'; signal = '🟡'; }
  else if (confidence >= 20) { verdict = 'PROBLEM'; signal = '🔴'; }
  else { verdict = 'HALLUCINATION'; signal = '🔴'; }

  // Update stats
  stats.totalAnalyzed++;
  stats.confidenceSum += confidence;
  stats.verdicts[verdict]++;

  return { confidence, signal, verdict, issues };
}

function getStats() {
  return {
    totalAnalyzed: stats.totalAnalyzed,
    avgConfidence: stats.totalAnalyzed > 0 ? Math.round(stats.confidenceSum / stats.totalAnalyzed) : 0,
    verdictBreakdown: { ...stats.verdicts }
  };
}

module.exports = { analyzeResponse, getStats };
