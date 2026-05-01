const responseReader = require('./response-reader');
const qualityGate = require('./quality-gate');
const kb = require('./knowledge-base');
const perfTracker = require('./performance-tracker');
const { notify } = require('./notifier');

let omegaBrain, promptEnhancer, resultAnalyzer, strategyEngine;
try { omegaBrain = require('./omega-brain'); } catch { omegaBrain = null; }
try { promptEnhancer = require('./prompt-enhancer'); } catch { promptEnhancer = null; }
try { resultAnalyzer = require('./result-analyzer'); } catch { resultAnalyzer = null; }
try { strategyEngine = require('./strategy-engine'); } catch { strategyEngine = null; }

const superBrain = require('./super-brain');

class OmegaNavigator {
  constructor() {
    this.states = new Map();
    this.broadcastFn = null;
  }

  init(broadcastFn) { this.broadcastFn = broadcastFn; }
  broadcast(data) { if (this.broadcastFn) this.broadcastFn(data); }

  async navigate(instanceId, rawText, context = {}) {
    let state = this.states.get(instanceId) || this.createState(instanceId);
    this.states.set(instanceId, state);
    state.iteration++;

    this.broadcast({ event: 'omega_thinking', instanceId });

    const deepRead = responseReader.deepRead(rawText, context);
    const kbContext = kb.getRelevantContext(context.sessionId);

    const fullContext = {
      ...context,
      iterationNumber: state.iteration,
      knowledgeBase: kbContext.session,
      sessionHistory: context.sessionHistory || []
    };

    let omegaResult;
    if (omegaBrain && omegaBrain.getStatus().available) {
      try {
        omegaResult = await omegaBrain.think(rawText, fullContext);
      } catch (e) {
        omegaResult = null;
      }
    }

    if (!omegaResult) {
      const brainResult = await superBrain.think(deepRead, fullContext);
      omegaResult = {
        analysis: { inputType: deepRead.primaryIntent, primaryIntent: deepRead.suggestedNextStep, completeness: deepRead.confidence, quality: deepRead.confidence, complexity: deepRead.complexity, detectedProblems: deepRead.warnings, extractedFacts: [], errorsFound: deepRead.error ? [deepRead.error] : [] },
        decision: { action: mapAction(brainResult.decision), reasoning: brainResult.reasoning, confidence: brainResult.confidence },
        enhanced_payload: { promptForClaudeCode: brainResult.payload.promptToExecute, autonomousAction: brainResult.payload.optionChosen ? { type: 'choose_option', value: brainResult.payload.optionChosen, reasoning: brainResult.payload.optionReasoning } : null },
        quality_assessment: { promptQualityScore: 0, resultQualityScore: 0, improvementsApplied: [], preventedErrors: [] },
        navigation: { currentPhase: 'implementation', progressPercent: state.iteration * 10, nextMilestone: brainResult.nextAction, recommendedNextPrompt: '' },
        learning: { extractedFacts: brainResult.extractedFacts || [], knowledgeToSave: {} },
        meta: { model: 'super-brain-fallback', iterationNumber: state.iteration }
      };
    }

    let strategy = null;
    if (strategyEngine) {
      try { strategy = await strategyEngine.getStrategy(omegaResult, state); } catch {}
    }

    const executionResult = await this.executeDecision(omegaResult, deepRead, state, context);

    if (omegaResult.learning?.knowledgeToSave && Object.keys(omegaResult.learning.knowledgeToSave).length > 0) {
      kb.saveForSession(context.sessionId, omegaResult.learning.knowledgeToSave);
    }

    perfTracker.trackIteration(context.sessionId || 'default', {
      qualityScore: omegaResult.quality_assessment?.promptQualityScore || omegaResult.decision?.confidence || 0,
      action: omegaResult.decision?.action,
      enhancements: omegaResult.quality_assessment?.improvementsApplied?.length || 0,
      preventedErrors: omegaResult.quality_assessment?.preventedErrors?.length || 0
    });

    state.currentPhase = omegaResult.navigation?.currentPhase || state.currentPhase;
    state.lastAction = omegaResult.decision?.action;

    const result = {
      omegaResult,
      executionResult,
      strategy,
      deepRead: { primaryIntent: deepRead.primaryIntent, actionType: deepRead.actionType, confidence: deepRead.confidence, complexity: deepRead.complexity },
      state: this.getSnapshot(state)
    };

    this.broadcast({ event: 'omega_decision', instanceId, ...result });
    return result;
  }

  async executeDecision(omegaResult, deepRead, state, context) {
    const action = omegaResult.decision?.action;
    const payload = omegaResult.enhanced_payload || {};

    switch (action) {
      case 'send_to_claude_code': {
        let prompt = payload.promptForClaudeCode || deepRead.prompt;
        if (!prompt) return { type: 'no_prompt' };

        const gate = qualityGate.check(prompt);

        if (!gate.approved && promptEnhancer) {
          try {
            const enhanced = await promptEnhancer.enhance(prompt, context.projectMemory || {});
            if (enhanced.qualityScore > 60) {
              prompt = enhanced.enhancedPrompt || prompt;
              omegaResult.quality_assessment.improvementsApplied = enhanced.improvements || [];
              omegaResult.quality_assessment.promptQualityScore = enhanced.qualityScore;
            }
          } catch {}
        }

        notify({ message: `Prompt ready (gate: ${gate.score}/${gate.maxScore})`, sound: 'info' });
        return { type: 'prompt_to_claude_code', prompt, qualityGate: gate };
      }

      case 'decide_autonomously':
      case 'choose_option': {
        const auto = payload.autonomousAction;
        const optionChosen = auto?.value || payload.optionChosen || omegaResult.decision?.reasoning;
        notify({ message: `Auto-decision: ${(optionChosen || '').slice(0, 50)}`, sound: 'info' });
        return { type: 'autonomous_action', actionType: auto?.type || 'choose_option', value: optionChosen, reasoning: auto?.reasoning || omegaResult.decision?.reasoning };
      }

      case 'return_to_claude_chat': {
        let msg = payload.messageForClaudeChat || omegaResult.decision?.reasoning;
        if (promptEnhancer) {
          try { msg = await promptEnhancer.enhanceForChat(msg, context.projectMemory); } catch {}
        }
        return { type: 'message_for_claude_chat', message: msg };
      }

      case 'mark_complete': {
        if (deepRead.extractedEntities?.technologies?.length > 0) {
          kb.addSuccessPattern('completion', { techs: deepRead.extractedEntities.technologies });
        }
        notify({ message: 'Task completed', sound: 'success' });
        return { type: 'complete', assessment: omegaResult.decision?.reasoning };
      }

      case 'escalate': {
        notify({ message: `Escalation: ${(omegaResult.decision?.reasoning || '').slice(0, 60)}`, sound: 'error' });
        return { type: 'escalation', reason: omegaResult.decision?.reasoning };
      }

      default:
        return { type: 'acknowledged' };
    }
  }

  createState(instanceId) {
    return { instanceId, iteration: 0, currentPhase: 'planning', lastAction: null, startTime: Date.now() };
  }

  getSnapshot(state) {
    return { instanceId: state.instanceId, iteration: state.iteration, currentPhase: state.currentPhase, lastAction: state.lastAction, uptimeSeconds: Math.floor((Date.now() - state.startTime) / 1000) };
  }

  getState(instanceId) { return this.states.get(instanceId); }
}

function mapAction(decision) {
  const map = { execute_prompt: 'send_to_claude_code', choose_option: 'decide_autonomously', answer_question: 'decide_autonomously', retry_with_fix: 'send_to_claude_code', mark_complete: 'mark_complete', escalate: 'escalate', acknowledge_info: 'wait', run_tests: 'send_to_claude_code', wait: 'wait' };
  return map[decision] || decision;
}

module.exports = new OmegaNavigator();
