const RESPONSE_MODES = Object.freeze({
  FACTUAL_PERSONAL: 'FACTUAL_PERSONAL',
  PARTIAL_PERSONAL: 'PARTIAL_PERSONAL',
  GENERAL_PROSPECTIVE: 'GENERAL_PROSPECTIVE'
});

const FALLBACK_INTENTS = Object.freeze({
  DIRECT_EXPERIENCE: 'DIRECT_EXPERIENCE',
  BEHAVIORAL_EVENT: 'BEHAVIORAL_EVENT',
  PROJECT_OR_ENVIRONMENT: 'PROJECT_OR_ENVIRONMENT',
  PROSPECTIVE_HOW: 'PROSPECTIVE_HOW',
  CONCEPTUAL_EXPLANATION: 'CONCEPTUAL_EXPLANATION',
  GENERAL_RESPONSE: 'GENERAL_RESPONSE'
});

const EVIDENCE_TYPES = Object.freeze({
  EXACT_ACTION: 'EXACT_ACTION',
  EXACT_OUTCOME: 'EXACT_OUTCOME',
  TECHNOLOGY_ONLY: 'TECHNOLOGY_ONLY',
  PROJECT_FACT: 'PROJECT_FACT',
  ROLE_OR_ENVIRONMENT: 'ROLE_OR_ENVIRONMENT',
  GENERAL_BACKGROUND: 'GENERAL_BACKGROUND',
  EXPLICIT_NEGATIVE: 'EXPLICIT_NEGATIVE'
});

const VALIDATION_OUTCOMES = Object.freeze({
  SAFE_GENERAL: 'SAFE_GENERAL',
  CLAIM_REFERENCE: 'CLAIM_REFERENCE',
  UNSAFE_PERSONAL: 'UNSAFE_PERSONAL',
  AMBIGUOUS: 'AMBIGUOUS'
});

const MAX_CAPSULES = 8;
const MAX_CAPSULE_TEXT_CHARACTERS = 360;
const MAX_CAPSULE_PROMPT_CHARACTERS = 2400;
const CLAIM_REFERENCE_PATTERN = /^\s*\[\[CLAIM:(C\d+)\]\]\s*(?:\r?\n)?$/i;
const COMMON_ABBREVIATIONS = new Set([
  'e.g.', 'i.e.', 'etc.', 'vs.', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.',
  'st.', 'no.', 'fig.', 'approx.', 'inc.', 'ltd.', 'corp.', 'u.s.', 'u.k.'
]);
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did', 'do',
  'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'my',
  'of', 'on', 'or', 'our', 'that', 'the', 'their', 'them', 'this', 'to', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'with', 'would', 'you', 'your', 'tell',
  'describe', 'walk', 'through', 'about', 'experience', 'project', 'role', 'time'
]);

const ACTION_WORDS = Object.freeze([
  'architected', 'automated', 'built', 'collaborated', 'configured', 'coordinated', 'created',
  'delivered', 'deployed', 'designed', 'developed', 'established', 'facilitated', 'handled',
  'helped', 'implemented', 'improved', 'launched', 'led', 'managed', 'migrated', 'negotiated',
  'optimized', 'owned', 'partnered', 'presented', 'rebuilt', 'reconfigured', 'redesigned',
  'reduced', 'resolved', 'sold', 'supported', 'used', 'worked'
]);
const ACTION_PATTERN = ACTION_WORDS.join('|');
const OUTCOME_PATTERN = /\b(?:achieved|decreased|delivered|improved|increased|lowered|reduced|resulted|saved|shortened)\b|\b(?:from|to|under|over|more than|less than)\s+(?:about\s+)?(?:[$€£]?\d|one\b|two\b|three\b|month\b|minute\b|hour\b|day\b|week\b|percent\b)/i;
const METRIC_PATTERN = /(?:[$€£]\s?\d|\b\d+(?:\.\d+)?\s*(?:%|\+|k\b|m\b|b\b|million\b|billion\b|seconds?\b|minutes?\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|sources?\b|systems?\b|applications?\b))/i;
const BEHAVIORAL_PATTERN = /\b(?:tell me about a time|give me an example|describe (?:a|the) (?:time|situation|project)|difficult stakeholder|conflicting requirements|did not go as planned|challenge you faced|resolved a conflict)\b/i;
const PERSONAL_OR_PROJECT_PATTERN = /\b(?:your|you|candidate|current project|current role|environment you support|experience|background|responsibilit|contribution|tell me about a time|give me an example)\b/i;
const DIRECT_EXPERIENCE_PATTERN = /\b(?:do you have|have you (?:worked|used)|your experience|describe your .{0,60}experience|experience (?:with|using|in)|worked with|familiar with)\b/i;
const PROJECT_OR_ENVIRONMENT_PATTERN = /\b(?:project|environment|platform|portfolio|current role|source systems?|downstream applications?|architecture you support)\b/i;
const PROSPECTIVE_HOW_PATTERN = /^\s*(?:how would you|what would you do|how do you recommend|how should (?:i|we)|what approach would you)\b/i;
const CONCEPTUAL_PATTERN = /^\s*(?:what is|what are|explain|define|compare|what does|how does|why (?:is|are|does|do))\b/i;

const HISTORICAL_PATTERNS = Object.freeze([
  new RegExp(`\\bi\\s+(?:personally\\s+)?(?:${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\bi(?:'ve|\u2019ve|\\s+have)\\s+(?:personally\\s+)?(?:${ACTION_PATTERN})\\b`, 'i'),
  /\bi\s+(?:was|am)\s+(?:personally\s+)?responsible\s+for\b/i,
  /\bi\s+(?:typically|usually|normally|often|generally)\b/i,
  /\bi(?:'ve|\u2019ve|\s+have)\s+(?:typically|usually|normally|often|generally|also)\b/i,
  /\bi(?:'ve|\u2019ve|\s+have)\s+(?:\w+\s+){0,2}\w+(?:ed|en)\b/i,
  /\bi\s+(?:ended\s+up|was\s+able\s+to|had\s+to|decided\s+to|contributed\s+to)\b/i,
  /\bwhen\s+i\s+(?:work|worked|use|used|design|designed|build|built|implement|implemented|handle|handled)\b/i,
  /\bwhen\s+(?:working|using|designing|building|implementing|handling|managing|leading)\b/i,
  /\bi\s+focus\s+on\b/i,
  /\bmy\s+(?:normal|usual|typical)\s+(?:approach|process|practice)\b/i,
  /\b(?:in|through|during)\s+my\s+(?:work|career|role|project|job)\b/i,
  /\b(?:my|our)\s+(?:current\s+)?(?:project|team|company|organization|client|platform|environment)\b/i,
  new RegExp(`\\bwe\\s+(?:personally\\s+)?(?:${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\bwe(?:'ve|\u2019ve|\\s+have)\\s+(?:${ACTION_PATTERN})\\b`, 'i'),
  /\bthrough\s+my\s+(?:efforts?|work|leadership|contribution)\b/i,
  /\bi\s+(?:achieved|accomplished|helped\s+(?:to\s+)?deliver)\b/i,
  /\b(?:at|during)\s+my\s+(?:last|previous|current)\s+(?:company|employer|role|job)\b/i,
  /\bthe\s+environment\s+i\s+(?:support|supported|built|designed|manage|managed)\b/i,
  /\bthe\s+candidate\s+(?:has|had|did|worked|used|built|implemented|designed|led|managed)\b/i
]);

const PROSPECTIVE_PREFIXES = Object.freeze([
  /^\s*i\s+would\b/i,
  /^\s*i(?:'d|\u2019d)\b/i,
  /^\s*my\s+(?:approach|recommendation)\s+would\b/i,
  /^\s*we\s+(?:could|would|should|might)\b/i,
  /^\s*if\s+(?:i|we)\s+were\b/i,
  /^\s*(?:a|the)\s+(?:practical|common|typical)\s+(?:approach|pattern)\b/i,
  /^\s*i\s+understand\b/i,
  /^\s*i\s+have\s+(?:two|three|several|a few)\s+(?:approaches|options|ideas|points)\b/i
]);

class CandidateClaimEnforcementService {
  prepare({ question = '', evidenceSources = {}, selectedChunks = [] } = {}) {
    const startedAt = process.hrtime.bigint();
    const candidates = this.collectCandidateClauses(evidenceSources, selectedChunks);
    const capsules = this.buildCapsules(question, candidates);
    const mode = this.selectResponseMode(question, capsules);
    const fallbackIntent = this.selectFallbackIntent(question);
    const policy = this.buildCompactPolicy(mode);
    const capsuleBlock = this.buildCapsuleBlock(capsules);
    const contract = [policy, capsuleBlock].filter(Boolean).join('\n');
    return Object.freeze({
      question: String(question || ''),
      mode,
      fallbackIntent,
      capsules: Object.freeze(capsules),
      contract,
      metadata: Object.freeze({
        mode,
        fallbackIntent,
        capsuleCount: capsules.length,
        evidenceCharacters: capsules.reduce((total, capsule) => total + capsule.text.length, 0),
        policyCharacters: policy.length,
        capsulePromptCharacters: capsuleBlock.length,
        contractCharacters: contract.length,
        preparationMs: Number(process.hrtime.bigint() - startedAt) / 1e6
      })
    });
  }

  collectCandidateClauses(evidenceSources, selectedChunks) {
    const entries = [];
    const liveFacts = Array.isArray(evidenceSources?.liveFacts) ? evidenceSources.liveFacts : [];
    const newerLiveSubjects = [];
    [...liveFacts].reverse().forEach((fact, reverseIndex) => {
      if (!fact || typeof fact.content !== 'string') return;
      this.splitEvidence(fact.content).forEach(text => {
        const subjectTokens = this.evidenceSubjectTokens(text);
        if (newerLiveSubjects.some(tokens => this.tokensOverlap(tokens, subjectTokens))) return;
        newerLiveSubjects.push(subjectTokens);
        entries.push({
          text,
          sourceType: 'MIC',
          sourceId: fact.timestamp || `mic-${liveFacts.length - reverseIndex}`,
          audioSource: fact.audioSource || 'mic',
          subjectTokens
        });
      });
    });

    const manualContexts = Array.isArray(evidenceSources?.manualContexts)
      ? evidenceSources.manualContexts
      : [];
    manualContexts.forEach((content, index) => {
      this.splitEvidence(content).forEach(text => entries.push({
        text,
        sourceType: 'MANUAL_CONTEXT',
        sourceId: `manual-${index + 1}`
      }));
    });

    const chunks = Array.isArray(selectedChunks) ? selectedChunks : [];
    chunks
      .filter(chunk => chunk?.evidenceType === 'candidate' && typeof chunk.content === 'string')
      .forEach(chunk => {
        this.splitEvidence(chunk.content).forEach(text => entries.push({
          text,
          sourceType: 'CANDIDATE_DOCUMENT',
          sourceId: chunk.id || null,
          documentId: chunk.documentId || null,
          documentName: chunk.documentName || null,
          chunkIndex: Number.isInteger(chunk.index) ? chunk.index : null
        }));
      });
    return entries;
  }

  splitEvidence(content) {
    return String(content || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n+|(?<=[.!?])\s+|\s*;\s*/)
      .map(value => value.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
      .map(value => value.replace(/^(?:actually|to clarify|correction|more precisely|i should clarify)[,:]?\s+/i, ''))
      .filter(value => value.length >= 3)
      .map(value => value.slice(0, MAX_CAPSULE_TEXT_CHARACTERS));
  }

  buildCapsules(question, entries) {
    const seen = new Set();
    const prepared = [];
    const liveSubjects = entries
      .filter(entry => entry.sourceType === 'MIC')
      .map(entry => entry.subjectTokens || this.evidenceSubjectTokens(entry.text));
    for (const [ordinal, entry] of entries.entries()) {
      if (
        entry.sourceType !== 'MIC' &&
        liveSubjects.some(tokens => this.tokensOverlap(tokens, this.evidenceSubjectTokens(entry.text)))
      ) {
        continue;
      }
      const type = this.classifyEvidence(entry.text);
      if (!type) continue;
      const normalized = entry.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      prepared.push({
        ...entry,
        ordinal,
        type,
        relevant: this.isRelevant(question, entry.text),
        renderText: this.renderCapsuleText(entry.text, type)
      });
    }

    const questionIsBroadPersonal = PERSONAL_OR_PROJECT_PATTERN.test(String(question || ''));
    prepared.sort((left, right) => {
      if (left.relevant !== right.relevant) return left.relevant ? -1 : 1;
      return left.ordinal - right.ordinal;
    });

    const selected = [];
    let promptCharacters = 0;
    for (const item of prepared) {
      if (!item.relevant && !questionIsBroadPersonal) continue;
      const projected = promptCharacters + item.text.length + 40;
      if (projected > MAX_CAPSULE_PROMPT_CHARACTERS || selected.length >= MAX_CAPSULES) break;
      const capsule = Object.freeze({
        id: `C${selected.length + 1}`,
        type: item.type,
        text: item.text,
        renderText: item.renderText,
        source: Object.freeze({
          type: item.sourceType,
          id: item.sourceId,
          audioSource: item.audioSource || null,
          documentId: item.documentId || null,
          documentName: item.documentName || null,
          chunkIndex: item.chunkIndex ?? null
        })
      });
      selected.push(capsule);
      promptCharacters = projected;
    }
    return selected;
  }

  classifyEvidence(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    if (/\bi\s+(?:have\s+not|haven't|do\s+not|don't|have\s+never|never)\b/i.test(value)) {
      return EVIDENCE_TYPES.EXPLICIT_NEGATIVE;
    }
    if (METRIC_PATTERN.test(value) && /\b(?:portfolio|source systems?|downstream applications?|platform|environment)\b/i.test(value)) {
      return EVIDENCE_TYPES.PROJECT_FACT;
    }
    if (OUTCOME_PATTERN.test(value) && (METRIC_PATTERN.test(value) || /\b(?:outcome|result|validation|latency|time)\b/i.test(value))) {
      return EVIDENCE_TYPES.EXACT_OUTCOME;
    }
    if (new RegExp(`^(?:i|we)\\s+(?:have\\s+)?(?:${ACTION_PATTERN})\\b`, 'i').test(value) ||
        new RegExp(`^(?:${ACTION_PATTERN})\\b`, 'i').test(value)) {
      if (/\bi\s+(?:have\s+)?worked\s+with\b/i.test(value) || /\bi\s+(?:have\s+)?(?:used|use)\s+[^,.;]+[.!]?$/i.test(value)) {
        return EVIDENCE_TYPES.TECHNOLOGY_ONLY;
      }
      return EVIDENCE_TYPES.EXACT_ACTION;
    }
    if (/\bi\s+(?:do\s+)?have\s+(?:direct\s+|hands-on\s+)?experience\s+(?:with|in|using)\b/i.test(value)) {
      return EVIDENCE_TYPES.TECHNOLOGY_ONLY;
    }
    if (METRIC_PATTERN.test(value) || /\b(?:portfolio|source systems?|downstream applications?|multi-tenant|bi-temporal|architecture|platform|environment)\b/i.test(value)) {
      return EVIDENCE_TYPES.PROJECT_FACT;
    }
    if (/\b(?:currently work|current role|current job|team|company|organization|financial services|healthcare|retail)\b/i.test(value)) {
      return EVIDENCE_TYPES.ROLE_OR_ENVIRONMENT;
    }
    if (/\b(?:background|knowledge|familiar|experience)\b/i.test(value)) {
      return EVIDENCE_TYPES.GENERAL_BACKGROUND;
    }
    return null;
  }

  evidenceStrength(type) {
    switch (type) {
      case EVIDENCE_TYPES.EXACT_ACTION: return 70;
      case EVIDENCE_TYPES.EXACT_OUTCOME: return 60;
      case EVIDENCE_TYPES.EXPLICIT_NEGATIVE: return 55;
      case EVIDENCE_TYPES.TECHNOLOGY_ONLY: return 45;
      case EVIDENCE_TYPES.PROJECT_FACT: return 35;
      case EVIDENCE_TYPES.ROLE_OR_ENVIRONMENT: return 25;
      default: return 10;
    }
  }

  isRelevant(question, text) {
    const questionTokens = this.tokens(question);
    const textTokens = this.tokens(text);
    if (questionTokens.length === 0 || textTokens.length === 0) return false;
    return questionTokens.some(token => textTokens.includes(token));
  }

  tokens(value) {
    return String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9+.#-]*/g)
      ?.map(token => token.replace(/[.,:;!?]+$/g, ''))
      .filter(token => token.length > 1 && !STOP_WORDS.has(token)) || [];
  }

  evidenceSubjectTokens(value) {
    const ignored = new Set([
      ...ACTION_WORDS,
      'not', 'never', 'direct', 'hands-on', 'professional', 'practical', 'commercial',
      'currently', 'current', 'worked', 'working', 'using', 'experience'
    ]);
    return this.tokens(value).filter(token => !ignored.has(token));
  }

  tokensOverlap(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) return false;
    return left.some(token => right.includes(token));
  }

  selectResponseMode(question, capsules) {
    const relevant = capsules.filter(capsule => capsule.type !== EVIDENCE_TYPES.EXPLICIT_NEGATIVE);
    const strongActions = relevant.filter(capsule => capsule.type === EVIDENCE_TYPES.EXACT_ACTION);
    if (BEHAVIORAL_PATTERN.test(String(question || ''))) {
      const hasOutcome = relevant.some(capsule => capsule.type === EVIDENCE_TYPES.EXACT_OUTCOME);
      if (strongActions.length > 0 && hasOutcome) return RESPONSE_MODES.FACTUAL_PERSONAL;
      if (strongActions.length > 0) return RESPONSE_MODES.PARTIAL_PERSONAL;
      return RESPONSE_MODES.GENERAL_PROSPECTIVE;
    }
    if (strongActions.length > 0) return RESPONSE_MODES.FACTUAL_PERSONAL;
    if (relevant.length > 0) return RESPONSE_MODES.PARTIAL_PERSONAL;
    return RESPONSE_MODES.GENERAL_PROSPECTIVE;
  }

  selectFallbackIntent(question) {
    const value = String(question || '');
    if (BEHAVIORAL_PATTERN.test(value)) return FALLBACK_INTENTS.BEHAVIORAL_EVENT;
    if (DIRECT_EXPERIENCE_PATTERN.test(value)) return FALLBACK_INTENTS.DIRECT_EXPERIENCE;
    if (PROJECT_OR_ENVIRONMENT_PATTERN.test(value)) return FALLBACK_INTENTS.PROJECT_OR_ENVIRONMENT;
    if (PROSPECTIVE_HOW_PATTERN.test(value)) return FALLBACK_INTENTS.PROSPECTIVE_HOW;
    if (CONCEPTUAL_PATTERN.test(value)) return FALLBACK_INTENTS.CONCEPTUAL_EXPLANATION;
    return FALLBACK_INTENTS.GENERAL_RESPONSE;
  }

  renderCapsuleText(text, type) {
    let value = String(text || '').replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '');
    if (!value) return '';
    if (type === EVIDENCE_TYPES.TECHNOLOGY_ONLY) {
      value = value.replace(/^I have worked\b/i, "I've worked");
    }
    if (type === EVIDENCE_TYPES.EXACT_ACTION && new RegExp(`^(?:${ACTION_PATTERN})\\b`, 'i').test(value)) {
      value = `I ${value.charAt(0).toLowerCase()}${value.slice(1)}`;
    }
    if (type === EVIDENCE_TYPES.PROJECT_FACT && !/^(?:the|this|that|my|our|i|we)\b/i.test(value)) {
      const fragment = value.replace(/^a\s+/i, '');
      const article = /^[$€£]/.test(fragment) ? 'a ' : '';
      value = `The environment includes ${article}${fragment.charAt(0).toLowerCase()}${fragment.slice(1)}`;
    }
    if (!/[.!?]$/.test(value)) value += '.';
    return value;
  }

  buildCompactPolicy(mode) {
    return [
      'CANDIDATE CLAIM CONTRACT',
      `MODE=${mode}`,
      'Write general or prospective reasoning as natural text. For any candidate history, habit, project ownership, action, or outcome, output only a standalone valid [[CLAIM:Cn]] line; never restate or expand it. Use only listed IDs. If evidence is insufficient, answer prospectively.'
    ].join('\n');
  }

  buildCapsuleBlock(capsules) {
    if (capsules.length === 0) return 'CLAIM CAPSULES: NONE';
    return ['CLAIM CAPSULES', ...capsules.map(capsule => `${capsule.id}|${capsule.type}|${capsule.text}`)].join('\n');
  }

  createStream(context, onValidatedUnit) {
    return new CandidateClaimStream(this, context, onValidatedUnit);
  }

  validateUnit(unit, context, streamState = {}) {
    const reference = String(unit || '').match(CLAIM_REFERENCE_PATTERN);
    if (reference) {
      const capsule = context.capsules.find(item => item.id.toLowerCase() === reference[1].toLowerCase());
      if (!capsule) return { outcome: VALIDATION_OUTCOMES.AMBIGUOUS, text: '', suppressionReason: 'invalid-claim-reference' };
      const suffix = /\r?\n$/.test(unit) ? '\n' : '';
      return { outcome: VALIDATION_OUTCOMES.CLAIM_REFERENCE, text: capsule.renderText + suffix, capsule };
    }
    if (/\[\[\s*(?:CLAIM\s*:\s*)?C\d+\s*\]\]/i.test(unit)) {
      return { outcome: VALIDATION_OUTCOMES.AMBIGUOUS, text: '', suppressionReason: 'malformed-claim-reference' };
    }
    if (this.containsCandidateClaim(unit) || this.containsContextualCandidateClaim(unit, context)) {
      return { outcome: VALIDATION_OUTCOMES.UNSAFE_PERSONAL, text: '', suppressionReason: 'unsafe-candidate-claim' };
    }
    if (streamState.hasSuppressedUnit && this.isDependentHistoricalUnit(unit)) {
      return { outcome: VALIDATION_OUTCOMES.AMBIGUOUS, text: '', suppressionReason: 'dependent-continuation' };
    }
    return { outcome: VALIDATION_OUTCOMES.SAFE_GENERAL, text: unit };
  }

  containsCandidateClaim(unit) {
    const text = String(unit || '').replace(/[`*_>#-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const prospective = PROSPECTIVE_PREFIXES.some(pattern => pattern.test(text));
    const historicalMatch = HISTORICAL_PATTERNS.some(pattern => pattern.test(text));
    if (historicalMatch) return true;
    if (prospective) return false;
    if (/\bi\s+(?:support|manage|own|lead|work\s+with|use)\b/i.test(text)) return true;
    if (/\bmy\s+approach\s+is\b/i.test(text)) return true;
    return false;
  }

  containsContextualCandidateClaim(unit, context) {
    const text = String(unit || '').replace(/[`*_>#-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || PROSPECTIVE_PREFIXES.some(pattern => pattern.test(text))) return false;
    if (/\b(?:my\s+(?:approach|recommendation)\s+would|i\s+would|we\s+(?:could|would|should|might)|if\s+(?:i|we)\s+were)\b/i.test(text) &&
        !/\b(?:was|were|had|did|implemented|built|used|worked|managed|led|delivered|migrated|resolved|achieved)\b/i.test(text)) {
      return false;
    }

    const question = String(context?.question || '');
    if (BEHAVIORAL_PATTERN.test(question)) {
      if (/\b(?:i|my|we|our)\b/i.test(text)) return true;
      return /\b(?:was|were|had|did|from|met|held|worked|resolved|involved|created|caused|needed|wanted|disagreed|resulted|became|led|built|implemented|delivered|pushed|pushing|requested|required)\b/i.test(text) ||
        /\b\w+(?:ed)\b/i.test(text);
    }

    if (PERSONAL_OR_PROJECT_PATTERN.test(question)) {
      if (/\b(?:i|my|we|our)\b/i.test(text) && !/^\s*i\s+understand\b/i.test(text) && !/^\s*i\s+have\s+(?:two|three|several|a few)\s+(?:approaches|options|ideas|points)\b/i.test(text)) {
        return true;
      }
      const projectSubject = /\b(?:project|team|platform|environment|system|infrastructure|company|organization|client|portfolio|source systems?|downstream applications?|architecture|validation)\b/i.test(text) || METRIC_PATTERN.test(text);
      const factualVerb = /\b(?:is|are|was|were|has|had|uses|used|includes|included|involves|involving|supports|supported|processes|processed|serves|served|ensures|provides|feeds|handles|built|implemented|migrated|delivered|reduced|improved)\b/i.test(text) || /\bit(?:'s|\u2019s)\b/i.test(text);
      const implicitExperience = /\b(?:this|that|the|such)\s+(?:work|experience|background|role|responsibility|involvement)\b/i.test(text) ||
        /^(?:this|that|it)\s+(?:included|involved|required|meant|covered|consisted|enabled|allowed)\b/i.test(text) ||
        /\b(?:part|aspect|component)\s+of\s+(?:this|that|the)\s+(?:work|experience|role)\b/i.test(text);
      return (projectSubject && factualVerb) || implicitExperience;
    }
    return false;
  }

  isDependentHistoricalUnit(unit) {
    const text = String(unit || '').replace(/^[\s*_>#-]+/, '');
    const dependentReference = /^(?:this|that|it|these|those|as a result|because of that|the result|the outcome|the project|the platform|the system)\b/i.test(text) &&
      !/^(?:this|that|it|these|those)\s+(?:would|could|should|might|may)\b/i.test(text);
    const gerundContinuation = /^(?:managing|handling|using|building|designing|implementing|configuring|monitoring|supporting|leading|working|integrating|ensuring)\b/i.test(text);
    return dependentReference || gerundContinuation;
  }

  extractProspectiveSubject(question) {
    return String(question || '')
      .replace(/^\s*(?:how would you|what would you do(?:\s+to)?|how do you recommend|how should (?:i|we)|what approach would you)\s*/i, '')
      .replace(/[?!.]+\s*$/, '')
      .replace(/^(?:approach|design|handle|implement|build|solve|address|manage)\s+/i, '')
      .trim();
  }

  buildProspectiveContinuation(context) {
    if (context.fallbackIntent === FALLBACK_INTENTS.DIRECT_EXPERIENCE) {
      return 'For a similar requirement, the approach I would take is to clarify the constraints, choose the simplest suitable pattern, and validate it against the expected workload.';
    }
    if (context.fallbackIntent === FALLBACK_INTENTS.BEHAVIORAL_EVENT) {
      return 'The approach I would take is to clarify the competing needs, align stakeholders on decision criteria, document the trade-offs, and confirm the outcome.';
    }
    if (context.fallbackIntent === FALLBACK_INTENTS.PROJECT_OR_ENVIRONMENT) {
      return 'At that scale, I would focus on consistency, lineage, data quality, and controlled change.';
    }
    return '';
  }

  buildFallback(context) {
    const usableCapsules = context.capsules.filter(capsule => capsule.type !== EVIDENCE_TYPES.EXPLICIT_NEGATIVE);
    const capsuleText = capsules => capsules.filter(Boolean).slice(0, 3).map(capsule => capsule.renderText).join(' ');

    if (context.fallbackIntent === FALLBACK_INTENTS.DIRECT_EXPERIENCE) {
      const technology = usableCapsules.filter(capsule => capsule.type === EVIDENCE_TYPES.TECHNOLOGY_ONLY);
      const evidence = capsuleText(technology.length > 0 ? technology : usableCapsules);
      const approach = this.buildProspectiveContinuation(context);
      const limitation = evidence ? '' : 'I do not have candidate-owned evidence for that direct experience.';
      return [evidence, limitation, approach].filter(Boolean).join(' ');
    }
    if (context.fallbackIntent === FALLBACK_INTENTS.BEHAVIORAL_EVENT) {
      const supported = usableCapsules.filter(capsule =>
        capsule.type === EVIDENCE_TYPES.EXACT_ACTION || capsule.type === EVIDENCE_TYPES.EXACT_OUTCOME
      );
      const evidence = capsuleText(supported);
      const approach = `Without inventing a past example, ${this.buildProspectiveContinuation(context).replace(/^The /, 'the ')}`;
      return [evidence, approach].filter(Boolean).join(' ');
    }
    if (context.fallbackIntent === FALLBACK_INTENTS.PROJECT_OR_ENVIRONMENT) {
      const project = usableCapsules.filter(capsule =>
        capsule.type === EVIDENCE_TYPES.PROJECT_FACT || capsule.type === EVIDENCE_TYPES.ROLE_OR_ENVIRONMENT
      );
      const evidence = capsuleText(project.length > 0 ? project : usableCapsules);
      const approach = this.buildProspectiveContinuation(context);
      return [evidence, approach].filter(Boolean).join(' ');
    }
    if (context.fallbackIntent === FALLBACK_INTENTS.PROSPECTIVE_HOW) {
      const subject = this.extractProspectiveSubject(context.question);
      return subject
        ? `For ${subject}, I would first clarify the requirements and constraints, then compare the trade-offs and validate the simplest design that meets them.`
        : 'The approach I would take is to clarify the requirements and constraints, compare the trade-offs, and validate the simplest design that meets them.';
    }
    if (context.fallbackIntent === FALLBACK_INTENTS.CONCEPTUAL_EXPLANATION) {
      return '';
    }
    if (usableCapsules.length > 0) {
      return `${capsuleText(usableCapsules)} For the broader question, the approach I would take is to clarify the requirements and evaluate the trade-offs before choosing a direction.`;
    }
    return 'The approach I would take is to clarify the requirements, evaluate the trade-offs, and choose the simplest direction that meets them.';
  }
}

class CandidateClaimStream {
  constructor(service, context, onValidatedUnit) {
    this.service = service;
    this.context = context;
    this.onValidatedUnit = typeof onValidatedUnit === 'function' ? onValidatedUnit : () => {};
    this.buffer = '';
    this.visibleText = '';
    this.rawText = '';
    this.firstRawDeltaAt = null;
    this.firstValidatedUnitAt = null;
    this.startedAt = Date.now();
    this.completed = false;
    this.stats = {
      safeGeneralUnits: 0,
      capsuleRenderedUnits: 0,
      unsafeUnits: 0,
      ambiguousUnits: 0,
      dependentUnitsSuppressed: 0,
      suppressedUnits: 0,
      safeUnitsRetained: 0,
      safeGeneralCharacters: 0,
      fallbackCapsulesUsed: 0,
      fallbackUsed: false
    };
  }

  push(delta) {
    if (this.completed || typeof delta !== 'string' || delta.length === 0) return;
    if (this.firstRawDeltaAt === null) this.firstRawDeltaAt = Date.now();
    this.rawText += delta;
    this.buffer += delta;
    this.drain(false);
  }

  drain(final) {
    while (this.buffer) {
      const boundary = this.findBoundary(this.buffer, final);
      if (boundary <= 0) break;
      const unit = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary);
      this.processUnit(unit);
    }
  }

  findBoundary(value, final) {
    let inlineCode = false;
    let inCodeFence = false;
    for (let index = 0; index < value.length; index += 1) {
      if (value.startsWith('```', index)) {
        inCodeFence = !inCodeFence;
        index += 2;
        continue;
      }
      const character = value[index];
      if (character === '`' && !inCodeFence) inlineCode = !inlineCode;
      if (character === '\n' && !inCodeFence) return index + 1;
      if (inCodeFence || inlineCode || !/[.!?]/.test(character)) continue;
      if (character === '.' && /\d/.test(value[index - 1] || '') && /\d/.test(value[index + 1] || '')) continue;
      const candidate = value.slice(0, index + 1);
      if (character === '.' && this.isAbbreviation(candidate)) continue;
      const next = value[index + 1];
      if (next === undefined) return final ? index + 1 : 0;
      if (/\s/.test(next)) return index + 1;
    }
    return final ? value.length : 0;
  }

  isAbbreviation(candidate) {
    const tail = candidate.toLowerCase().match(/(?:^|\s)([a-z](?:\.[a-z])?\.|[a-z]{2,8}\.)$/)?.[1];
    return !!tail && (COMMON_ABBREVIATIONS.has(tail) || /^[a-z]\.$/.test(tail));
  }

  processUnit(unit) {
    const result = this.service.validateUnit(unit, this.context, {
      hasSuppressedUnit: this.stats.suppressedUnits > 0
    });
    if (result.outcome === VALIDATION_OUTCOMES.SAFE_GENERAL) {
      this.stats.safeGeneralUnits += 1;
      this.stats.safeGeneralCharacters += result.text.trim().length;
    }
    if (result.outcome === VALIDATION_OUTCOMES.CLAIM_REFERENCE) this.stats.capsuleRenderedUnits += 1;
    if (result.outcome === VALIDATION_OUTCOMES.UNSAFE_PERSONAL) this.stats.unsafeUnits += 1;
    if (result.outcome === VALIDATION_OUTCOMES.AMBIGUOUS) this.stats.ambiguousUnits += 1;
    if (!result.text) {
      this.stats.suppressedUnits += 1;
      if (result.suppressionReason === 'dependent-continuation') this.stats.dependentUnitsSuppressed += 1;
      return;
    }
    this.stats.safeUnitsRetained += 1;
    if (this.firstValidatedUnitAt === null) this.firstValidatedUnitAt = Date.now();
    this.visibleText += result.text;
    this.onValidatedUnit(result.text, result);
  }

  finalize(rawFallbackText = '') {
    if (this.completed) return this.result();
    if (!this.rawText && typeof rawFallbackText === 'string' && rawFallbackText) {
      this.push(rawFallbackText);
    }
    this.drain(true);
    const needsCapsuleContinuation = this.stats.capsuleRenderedUnits > 0 &&
      this.stats.safeGeneralCharacters === 0 &&
      [
        FALLBACK_INTENTS.DIRECT_EXPERIENCE,
        FALLBACK_INTENTS.BEHAVIORAL_EVENT,
        FALLBACK_INTENTS.PROJECT_OR_ENVIRONMENT
      ].includes(this.context.fallbackIntent);
    if (needsCapsuleContinuation) {
      const continuation = this.service.buildProspectiveContinuation(this.context);
      if (continuation) {
        this.stats.fallbackUsed = true;
        this.visibleText = `${this.visibleText.trim()} ${continuation}`;
        this.onValidatedUnit(` ${continuation}`, { outcome: VALIDATION_OUTCOMES.SAFE_GENERAL, fallback: true });
      }
    }
    if (!this.visibleText.trim()) {
      const fallback = this.service.buildFallback(this.context);
      this.stats.fallbackUsed = true;
      this.stats.fallbackCapsulesUsed = this.context.capsules.filter(capsule =>
        capsule.type !== EVIDENCE_TYPES.EXPLICIT_NEGATIVE && fallback.includes(capsule.renderText)
      ).length;
      if (fallback) {
        if (this.firstValidatedUnitAt === null) this.firstValidatedUnitAt = Date.now();
        this.visibleText = fallback;
        this.onValidatedUnit(fallback, { outcome: VALIDATION_OUTCOMES.SAFE_GENERAL, fallback: true });
      }
    }
    this.completed = true;
    return this.result();
  }

  result() {
    const completedAt = Date.now();
    return Object.freeze({
      text: this.visibleText.trim(),
      rawText: this.rawText,
      mode: this.context.mode,
      rejected: this.stats.suppressedUnits > 0,
      metadata: Object.freeze({
        ...this.stats,
        mode: this.context.mode,
        fallbackIntent: this.context.fallbackIntent,
        capsuleCount: this.context.capsules.length,
        firstRawDeltaMs: this.firstRawDeltaAt === null ? null : this.firstRawDeltaAt - this.startedAt,
        validationBufferMs: this.firstRawDeltaAt === null || this.firstValidatedUnitAt === null
          ? null
          : this.firstValidatedUnitAt - this.firstRawDeltaAt,
        firstValidatedUnitMs: this.firstValidatedUnitAt === null ? null : this.firstValidatedUnitAt - this.startedAt,
        enforcementDurationMs: completedAt - this.startedAt
      })
    });
  }
}

module.exports = new CandidateClaimEnforcementService();
module.exports.RESPONSE_MODES = RESPONSE_MODES;
module.exports.FALLBACK_INTENTS = FALLBACK_INTENTS;
module.exports.EVIDENCE_TYPES = EVIDENCE_TYPES;
module.exports.VALIDATION_OUTCOMES = VALIDATION_OUTCOMES;
module.exports.MAX_CAPSULES = MAX_CAPSULES;
module.exports.MAX_CAPSULE_PROMPT_CHARACTERS = MAX_CAPSULE_PROMPT_CHARACTERS;
