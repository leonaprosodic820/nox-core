const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const DECISIONS_DIR = path.join(__dirname, 'decisions');
fs.mkdirSync(DECISIONS_DIR, { recursive: true });

let client = null;
try {
  if (process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic();
  }
} catch {}

const SYSTEM_PROMPT = `Tu es le Chef de Projet IA du système Claude Relay.
Tu analyses les réponses de Claude Chat et tu prends des décisions autonomes.

Ton rôle :
1. Analyser chaque réponse en profondeur
2. Choisir la meilleure option quand plusieurs sont proposées
3. Répondre aux questions posées de façon intelligente
4. Détecter et corriger les erreurs automatiquement
5. Déterminer si une tâche est complète ou si elle doit continuer

Tu dois retourner UNIQUEMENT un JSON valide :
{
  "decision": "execute_prompt"|"choose_option"|"answer_question"|"retry_with_fix"|"mark_complete"|"escalate"|"wait",
  "reasoning": "explication courte",
  "payload": {
    "optionChosen": "label si choose_option",
    "answer": "texte si answer_question",
    "correctedPrompt": "prompt si retry_with_fix",
    "completionReason": "raison si mark_complete"
  },
  "confidence": 0-100,
  "nextAction": "description prochaine étape",
  "projectInsight": "observation sur le projet"
}`;

async function think(context) {
  const { analysisResult, rawInput, projectMemory, sessionHistory } = context;

  // If API available, use Claude
  if (client) {
    try {
      const userMsg = `Analyse cette réponse et décide:\n\nType détecté: ${analysisResult?.type}\nContenu: ${rawInput?.slice(0, 2000)}\n\nContexte projet: ${JSON.stringify(projectMemory?.objective || 'non défini')}\nHistorique: ${sessionHistory?.length || 0} itérations`;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        logDecision(context, decision);
        return decision;
      }
    } catch (err) {
      // Fall through to rule-based
    }
  }

  // Rule-based fallback (no API key or API error)
  const decision = ruleBasedDecision(analysisResult, rawInput);
  logDecision(context, decision);
  return decision;
}

function ruleBasedDecision(analysisResult, rawInput) {
  const type = analysisResult?.type || 'prompt';
  const elements = analysisResult?.elements || {};

  if (type === 'prompt' && elements.prompt) {
    return {
      decision: 'execute_prompt',
      reasoning: 'Prompt CC détecté, exécution directe',
      payload: {},
      confidence: 95,
      nextAction: 'Copier et exécuter le prompt dans Claude Code',
      projectInsight: 'Tâche en cours de traitement'
    };
  }

  if (type === 'options' || elements.options) {
    const opts = elements.options || [];
    const recommended = opts.find(o => o.recommended);
    const chosen = recommended || opts[0];
    return {
      decision: 'choose_option',
      reasoning: recommended ? `Option recommandée sélectionnée: ${chosen.label}` : `Première option sélectionnée: ${chosen?.label}`,
      payload: { optionChosen: chosen?.label || 'A' },
      confidence: recommended ? 90 : 70,
      nextAction: 'Appliquer l\'option choisie',
      projectInsight: `${opts.length} options disponibles`
    };
  }

  if (type === 'question' || elements.questions) {
    const questions = elements.questions || [];
    const answers = questions.map(q => {
      if (q.answerType === 'confirm') return 'Oui';
      return 'Procéder avec la configuration par défaut';
    });
    return {
      decision: 'answer_question',
      reasoning: `${questions.length} question(s) détectée(s), réponses auto-générées`,
      payload: { answer: answers.join('\n') },
      confidence: 75,
      nextAction: 'Envoyer les réponses à Claude Chat',
      projectInsight: 'Questions en attente de réponse'
    };
  }

  if (type === 'error' || elements.error) {
    const errMsg = elements.error?.message || 'Erreur inconnue';
    return {
      decision: 'retry_with_fix',
      reasoning: `Erreur détectée: ${errMsg.slice(0, 100)}`,
      payload: { correctedPrompt: `[CC_START]\nCorrection de l'erreur: ${errMsg}\nRetenter l'opération précédente.\n[CC_END]` },
      confidence: 65,
      nextAction: 'Retenter avec le prompt corrigé',
      projectInsight: 'Erreur rencontrée, correction en cours'
    };
  }

  if (type === 'confirmation' || elements.confirmation) {
    return {
      decision: 'mark_complete',
      reasoning: 'Confirmation de succès détectée',
      payload: { completionReason: elements.confirmation?.message || 'Tâche confirmée complète' },
      confidence: 90,
      nextAction: 'Archiver et passer à la suite',
      projectInsight: 'Tâche terminée avec succès'
    };
  }

  if (type === 'tests' || elements.tests) {
    return {
      decision: 'execute_prompt',
      reasoning: 'Tests à exécuter détectés',
      payload: {},
      confidence: 85,
      nextAction: 'Exécuter les tests dans Chrome',
      projectInsight: 'Phase de validation en cours'
    };
  }

  return {
    decision: 'wait',
    reasoning: 'Type de contenu non reconnu, attente',
    payload: {},
    confidence: 30,
    nextAction: 'Attendre plus de contexte',
    projectInsight: 'En attente de données supplémentaires'
  };
}

async function analyzeError(error, context) {
  const errMsg = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));

  if (client) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: `Analyse cette erreur et propose une correction en JSON {correctedPrompt, explanation, confidence}:\n${errMsg}` }]
      });
      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  return {
    correctedPrompt: `[CC_START]\nCorrection: ${errMsg.slice(0, 200)}\nRetenter.\n[CC_END]`,
    explanation: 'Correction automatique basée sur le message d\'erreur',
    confidence: 60
  };
}

async function generateAnswer(questions, projectMemory) {
  if (!questions || questions.length === 0) return { answer: '' };

  if (client) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: `Réponds à ces questions dans le contexte du projet:\nQuestions: ${JSON.stringify(questions)}\nContexte: ${JSON.stringify(projectMemory?.objective || '')}` }]
      });
      return { answer: response.content[0].text };
    } catch {}
  }

  const answers = questions.map(q => {
    if (q.answerType === 'confirm') return `Q: ${q.text}\nR: Oui`;
    return `Q: ${q.text}\nR: Procéder avec la configuration recommandée`;
  });
  return { answer: answers.join('\n\n') };
}

async function evaluateCompletion(iterations, objective) {
  if (!iterations || iterations.length === 0) {
    return { complete: false, reason: 'Aucune itération', missingItems: ['Démarrer le travail'] };
  }

  const lastIter = iterations[iterations.length - 1];
  const hasConfirmation = lastIter?.analysisType === 'confirmation';
  const hasResult = lastIter?.result != null;

  if (hasConfirmation) {
    return { complete: true, reason: 'Confirmation de succès reçue', missingItems: [] };
  }

  if (hasResult && iterations.length > 3) {
    return { complete: true, reason: 'Plusieurs itérations complétées avec résultats', missingItems: [] };
  }

  return { complete: false, reason: 'Travail en cours', missingItems: ['Attendre confirmation finale'] };
}

function logDecision(context, decision) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(DECISIONS_DIR, `${date}.json`);
    let entries = [];
    if (fs.existsSync(file)) {
      try { entries = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { entries = []; }
    }
    entries.push({
      timestamp: new Date().toISOString(),
      sessionId: context?.sessionId,
      instanceId: context?.instanceId,
      projectName: context?.projectName,
      decision: decision.decision,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      nextAction: decision.nextAction
    });
    fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  } catch {}
}

function isAvailable() {
  return { available: !!client, model: 'claude-sonnet-4-20250514', mode: client ? 'api' : 'rule-based' };
}

module.exports = { think, analyzeError, generateAnswer, evaluateCompletion, logDecision, isAvailable, ruleBasedDecision };
