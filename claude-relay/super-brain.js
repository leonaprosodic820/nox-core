const fs = require('fs');
const path = require('path');

const DECISIONS_DIR = path.join(__dirname, 'decisions');
fs.mkdirSync(DECISIONS_DIR, { recursive: true });

let client = null;
try {
  const Anthropic = require('@anthropic-ai/sdk');
  if (process.env.ANTHROPIC_API_KEY) client = new Anthropic();
} catch {}

const SYSTEM_PROMPT = `Tu es le Super Brain du Claude Relay — Chef de Projet IA autonome.
Tu reçois l'analyse profonde d'une réponse de Claude Chat et tu décides quoi faire.

RÈGLES:
1. Si prompt [CC_START] présent → execute_prompt
2. Si options présentes sans prompt → choose_option (prendre recommandée ou première)
3. Si question sans prompt → answer_question
4. Si erreur → retry_with_fix avec prompt corrigé
5. Si confirmation finale → mark_complete
6. Si texte informatif pur → acknowledge_info
7. Si confidence < 70 → escalate

Retourne UNIQUEMENT du JSON valide:
{
  "decision": "execute_prompt"|"choose_option"|"answer_question"|"retry_with_fix"|"mark_complete"|"escalate"|"acknowledge_info"|"run_tests"|"wait",
  "reasoning": "explication (min 2 phrases)",
  "confidence": 0-100,
  "payload": {
    "promptToExecute": "si execute_prompt",
    "optionChosen": "si choose_option",
    "optionReasoning": "pourquoi cette option",
    "answerToQuestion": "si answer_question",
    "correctedPrompt": "si retry_with_fix",
    "correctionExplanation": "explication correction",
    "completionAssessment": "si mark_complete",
    "escalationReason": "si escalate",
    "testsToRun": []
  },
  "nextAction": "description prochaine étape",
  "projectInsight": "observation projet",
  "extractedFacts": [],
  "warningsDetected": []
}`;

async function think(deepReadResult, sessionContext = {}) {
  const dr = deepReadResult || {};

  if (client) {
    try {
      const userMsg = `Analyse cette réponse:\nType: ${dr.primaryIntent}\nAction requise: ${dr.actionRequired}\nPrompt: ${dr.prompt ? 'OUI' : 'NON'}\nOptions: ${dr.options ? dr.options.length : 0}\nQuestions: ${dr.questions ? dr.questions.length : 0}\nErreur: ${dr.error ? dr.error.message : 'NON'}\nConfirmation: ${dr.confirmation ? 'OUI' : 'NON'}\nTexte (500 chars): ${(dr.rawText || '').slice(0, 500)}\nContexte projet: ${JSON.stringify(sessionContext.projectMemory?.objective || '')}\nHistorique: ${(sessionContext.sessionHistory || []).length} itérations`;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        decision.confidence = Math.max(0, Math.min(100, decision.confidence || 50));
        logDecision(sessionContext, decision);
        return normalizeDecision(decision);
      }
    } catch {}
  }

  // Rule-based fallback
  const decision = ruleBasedDecision(dr);
  logDecision(sessionContext, decision);
  return decision;
}

function ruleBasedDecision(dr) {
  if (dr.prompt) {
    return makeDecision('execute_prompt', 95,
      'Prompt CC détecté entre balises. Exécution directe requise.',
      { promptToExecute: dr.prompt },
      'Copier et exécuter dans Claude Code',
      'Prompt prêt à exécuter');
  }

  if (dr.options && dr.options.length > 0) {
    const rec = dr.options.find(o => o.recommended);
    const chosen = rec || dr.options[0];
    return makeDecision('choose_option', rec ? 90 : 70,
      `${dr.options.length} options détectées. ${rec ? 'Option recommandée sélectionnée.' : 'Première option sélectionnée par défaut.'} Choix: ${chosen.label}.`,
      { optionChosen: chosen.label, optionReasoning: rec ? 'Marked as recommended by Claude Chat' : 'First available option selected' },
      'Appliquer l\'option et générer le prompt',
      `${dr.options.length} options, choix: ${chosen.label}`);
  }

  if (dr.questions && dr.questions.length > 0) {
    const answers = dr.questions.map(q => q.answerType === 'confirm' ? 'Oui' : 'Procéder avec la configuration par défaut').join('\n');
    return makeDecision('answer_question', 75,
      `${dr.questions.length} question(s) détectée(s). Réponses auto-générées basées sur le contexte projet.`,
      { answerToQuestion: answers },
      'Envoyer les réponses à Claude Chat',
      'Questions en attente de réponse');
  }

  if (dr.tests && dr.tests.length > 0) {
    return makeDecision('run_tests', 85,
      `${dr.tests.length} tests à exécuter détectés. Phase de validation.`,
      { testsToRun: dr.tests },
      'Exécuter les tests dans Chrome DevTools',
      'Phase de validation en cours');
  }

  if (dr.error && !dr.confirmation) {
    return makeDecision('retry_with_fix', 65,
      `Erreur détectée: ${(dr.error.message || '').slice(0, 100)}. Correction automatique générée.`,
      { correctedPrompt: `[CC_START]\nCorrection: ${dr.error.message}\nRetenter l'opération.\n[CC_END]`, correctionExplanation: dr.error.suggestion || 'Auto-correction based on error message' },
      'Retenter avec le prompt corrigé',
      'Erreur en cours de correction');
  }

  if (dr.confirmation && !dr.error) {
    return makeDecision('mark_complete', 90,
      `Confirmation de succès reçue. ${dr.confirmation.message || 'Tâche complétée.'}`,
      { completionAssessment: dr.confirmation.message || 'Task completed successfully' },
      'Archiver et passer à la suite',
      'Tâche terminée avec succès');
  }

  if (!dr.actionRequired) {
    return makeDecision('acknowledge_info', 60,
      'Texte informatif détecté sans action requise. Sauvegarde des faits extraits.',
      {},
      'Stocker les informations et continuer',
      'Information reçue et traitée');
  }

  return makeDecision('wait', 30,
    'Contenu non reconnu avec certitude. Attente de plus de contexte avant de décider.',
    {},
    'Attendre plus de contexte',
    'En attente de clarification');
}

function makeDecision(decision, confidence, reasoning, payload, nextAction, projectInsight) {
  return {
    decision, confidence, reasoning,
    payload: { promptToExecute: null, optionChosen: null, optionReasoning: null, answerToQuestion: null, correctedPrompt: null, correctionExplanation: null, completionAssessment: null, escalationReason: null, testsToRun: null, ...payload },
    nextAction, projectInsight,
    extractedFacts: [], warningsDetected: []
  };
}

function normalizeDecision(d) {
  return {
    decision: d.decision || 'wait',
    confidence: d.confidence || 50,
    reasoning: d.reasoning || 'No reasoning provided.',
    payload: { promptToExecute: null, optionChosen: null, optionReasoning: null, answerToQuestion: null, correctedPrompt: null, correctionExplanation: null, completionAssessment: null, escalationReason: null, testsToRun: null, ...(d.payload || {}) },
    nextAction: d.nextAction || 'Continue',
    projectInsight: d.projectInsight || 'Project in progress',
    extractedFacts: d.extractedFacts || [],
    warningsDetected: d.warningsDetected || []
  };
}

async function analyzeError(error, context) {
  const errMsg = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
  if (client) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 500,
        messages: [{ role: 'user', content: `Analyse cette erreur:\n${errMsg}\n\nRetourne JSON: {rootCause, correctedPrompt, explanation, confidence}` }]
      });
      const match = response.content[0].text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch {}
  }
  return { rootCause: errMsg.slice(0, 200), correctedPrompt: `[CC_START]\nFix: ${errMsg.slice(0, 200)}\n[CC_END]`, explanation: 'Auto-correction from error message', confidence: 60 };
}

async function generateAnswer(questions, projectMemory, sessionHistory) {
  if (!questions || questions.length === 0) return { answer: '' };
  if (client) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 500,
        messages: [{ role: 'user', content: `Réponds: ${JSON.stringify(questions)}\nContexte: ${JSON.stringify(projectMemory?.objective || '')}` }]
      });
      return { answer: response.content[0].text };
    } catch {}
  }
  return { answer: questions.map(q => q.answerType === 'confirm' ? `Q: ${q.text}\nR: Oui` : `Q: ${q.text}\nR: Configuration par défaut`).join('\n\n') };
}

async function evaluateCompletion(iterations, objective, lastResponse) {
  if (!iterations || iterations.length === 0) return { complete: false, completionPercent: 0, reason: 'No iterations yet', missingItems: ['Start work'], nextSteps: ['Begin first task'] };
  const last = iterations[iterations.length - 1];
  if (last?.analysisType === 'confirmation' || last?.result?.includes?.('complété') || last?.result?.includes?.('completed')) {
    return { complete: true, completionPercent: 100, reason: 'Confirmation received', missingItems: [], nextSteps: [] };
  }
  const pct = Math.min(95, Math.round((iterations.filter(i => i.result).length / Math.max(iterations.length, 1)) * 100));
  return { complete: false, completionPercent: pct, reason: 'Work in progress', missingItems: ['Final confirmation'], nextSteps: ['Continue current task'] };
}

async function describeScreenshot(imageBase64) {
  if (client && imageBase64) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
          { type: 'text', text: 'Describe what you see on this Mac screenshot in 2-3 sentences.' }
        ]}]
      });
      return response.content[0].text;
    } catch {}
  }
  return 'Screenshot captured. Visual analysis requires Anthropic API key with vision support.';
}

function logDecision(context, decision) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(DECISIONS_DIR, `${date}.json`);
    let entries = [];
    if (fs.existsSync(file)) { try { entries = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { entries = []; } }
    entries.push({
      timestamp: new Date().toISOString(),
      sessionId: context?.sessionId, instanceId: context?.instanceId,
      projectName: context?.projectName,
      decision: decision.decision, reasoning: decision.reasoning,
      confidence: decision.confidence, nextAction: decision.nextAction
    });
    fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  } catch {}
}

function isAvailable() {
  return { available: !!client, model: 'claude-sonnet-4-20250514', mode: client ? 'api' : 'rule-based' };
}

module.exports = { think, analyzeError, generateAnswer, evaluateCompletion, describeScreenshot, logDecision, isAvailable, ruleBasedDecision, makeDecision };
