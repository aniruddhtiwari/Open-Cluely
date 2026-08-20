const promptBuilderService = require('./prompt-builder.service');

const STATES = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',
  EXPLICIT_NEGATIVE: 'explicit_negative',
  EXPLICIT_POSITIVE: 'explicit_positive',
  SUPPORTED: 'supported',
  UNKNOWN: 'unknown',
  MIXED: 'mixed'
});

const STOP_WORDS = new Set(['and', 'or', 'the', 'a', 'an', 'technology', 'technologies', 'tool', 'tools']);
const ACTION_ROOTS = Object.freeze({
  worked: 'work', working: 'work', used: 'use', using: 'use', built: 'build', building: 'build',
  implemented: 'implement', implementing: 'implement', developed: 'develop', developing: 'develop', designed: 'design', designing: 'design',
  deployed: 'deploy', deploying: 'deploy', configured: 'configure', configuring: 'configure',
  managed: 'manage', managing: 'manage', management: 'manage', led: 'lead', leading: 'lead',
  presented: 'present', presenting: 'present', sold: 'sell', selling: 'sell', negotiated: 'negotiate',
  negotiating: 'negotiate', delivered: 'deliver', delivering: 'deliver', owned: 'own', owning: 'own',
  supported: 'support', supporting: 'support', advised: 'advise', advising: 'advise',
  consulted: 'consult', consulting: 'consult', launched: 'launch', launching: 'launch',
  migrated: 'migrate', migrating: 'migrate', facilitated: 'facilitate', facilitating: 'facilitate',
  partnered: 'partner', partnering: 'partner'
});
const ACTION_PATTERN = 'worked|work|working|used|use|using|built|build|building|implemented|implement|implementing|developed|develop|developing|designed|design|designing|deployed|deploy|deploying|configured|configure|configuring|managed|manage|managing|led|lead|leading|presented|present|presenting|sold|sell|selling|negotiated|negotiate|negotiating|delivered|deliver|delivering|owned|own|owning|supported|support|supporting|advised|advise|advising|consulted|consult|consulting|launched|launch|launching|migrated|migrate|migrating|facilitated|facilitate|facilitating|partnered|partner|partnering';

class ExperienceEvidenceService {
  evaluate(question, sessionManager) {
    if (!promptBuilderService.isPersonalExperienceQuestion(question)) {
      return Object.freeze({ applicable: false, allowGemini: true, state: STATES.NOT_APPLICABLE, subjects: [] });
    }

    const sources = sessionManager.getExperienceEvidenceSources();
    const subjects = this.refineCompoundSubjects(this.extractSubjects(question), sources);
    const perSubject = subjects.map(subject => this.evaluateSubject(subject, sources));
    const states = perSubject.map(item => item.state);
    let state = STATES.UNKNOWN;
    if (states.length > 0 && states.every(value => value === STATES.EXPLICIT_NEGATIVE)) {
      state = STATES.EXPLICIT_NEGATIVE;
    } else if (states.length > 0 && states.every(value => value === STATES.EXPLICIT_POSITIVE)) {
      state = STATES.EXPLICIT_POSITIVE;
    } else if (states.length > 0 && states.every(value => value === STATES.EXPLICIT_POSITIVE || value === STATES.SUPPORTED)) {
      state = states.includes(STATES.EXPLICIT_POSITIVE) ? STATES.EXPLICIT_POSITIVE : STATES.SUPPORTED;
    } else if (new Set(states).size > 1) {
      state = STATES.MIXED;
    }

    const allowGemini = state === STATES.EXPLICIT_POSITIVE || state === STATES.SUPPORTED;
    return Object.freeze({
      applicable: true,
      allowGemini,
      state,
      subjects: Object.freeze(subjects),
      perSubject: Object.freeze(perSubject),
      response: allowGemini ? '' : this.buildSafeResponse(perSubject, subjects)
    });
  }

  extractSubjects(question) {
    if (typeof question !== 'string') return [];
    const normalized = question.replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
    const action = ACTION_PATTERN;
    const patterns = [
      /\bexperience\s+(?:with|in|using)\s+(.+)$/i,
      /\b(?:tell me about|describe|walk me through)\s+your\s+(?:hands-on\s+)?(.+?)\s+experience$/i,
      /\bhow\s+(?:much|many\s+years?\s+of)\s+(.+?)\s+experience\s+do\s+you\s+have$/i,
      /\bwhat\s+(?:hands-on\s+)?experience\s+do\s+you\s+have\s+(?:with|in|using)\s+(.+)$/i,
      new RegExp(`\\b(?:tell me about|describe|walk me through)\\s+your\\s+(?:hands-on\\s+)?experience\\s+(?:${action})(?:\\s+(?:with|on|in|into|to|for))?\\s+(.+)$`, 'i'),
      new RegExp(`\\bwhat\\s+(?:hands-on\\s+)?experience\\s+do\\s+you\\s+have\\s+(?:${action})(?:\\s+(?:with|on|in|into|to|for))?\\s+(.+)$`, 'i'),
      new RegExp(`\\bhow\\s+long\\s+have\\s+you\\s+(?:${action})(?:\\s+(?:with|on|in|into|to|for))?\\s+(.+)$`, 'i'),
      new RegExp(`\\bhave\\s+you\\s+(?:ever\\s+)?(?:${action})(?:\\s+(?:with|on|in|into|to|for))?\\s+(.+)$`, 'i'),
      new RegExp(`\\bdid\\s+you\\s+(?:ever\\s+)?(?:${action})(?:\\s+(?:with|on|in|into|to|for))?\\s+(.+)$`, 'i')
    ];
    let phrase = '';
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        phrase = match[1];
        break;
      }
    }
    if (!phrase) return [];
    return [phrase.replace(/^(?:the|a|an)\s+/i, '').trim()].filter(Boolean);
  }

  refineCompoundSubjects(subjects, sources) {
    if (subjects.length !== 1 || !/\s(?:and|or)\s/i.test(subjects[0])) return subjects;
    const parts = subjects[0]
      .split(/\s+(?:and|or)\s+/i)
      .map(value => value.replace(/^(?:the|a|an)\s+/i, '').trim())
      .filter(Boolean)
      .slice(0, 4);
    if (parts.length < 2) return subjects;
    const evidence = [...sources.liveFacts, ...sources.manualContexts, ...sources.candidateDocumentChunks];
    const independentlySupported = parts.every(part => evidence.some(source => {
      const content = typeof source === 'string' ? source : source.content;
      return !!this.findMatchingClause(content, part);
    }));
    return independentlySupported ? parts : subjects;
  }

  evaluateSubject(subject, sources) {
    let liveState = null;
    for (const fact of sources.liveFacts) {
      const clause = this.findMatchingClause(fact.content, subject);
      if (!clause) continue;
      if (this.isNegativeStatement(clause)) liveState = STATES.EXPLICIT_NEGATIVE;
      else if (this.isPositiveStatement(clause)) liveState = STATES.EXPLICIT_POSITIVE;
    }
    if (liveState) return Object.freeze({ subject, state: liveState });

    const trustedPositive = [...sources.manualContexts, ...sources.candidateDocumentChunks]
      .some(content => {
        const clause = this.findMatchingClause(content, subject);
        return clause && this.isPositiveStatement(clause);
      });
    return Object.freeze({ subject, state: trustedPositive ? STATES.SUPPORTED : STATES.UNKNOWN });
  }

  findMatchingClause(text, subject) {
    if (typeof text !== 'string') return '';
    const clauses = text.split(/(?:\bbut\b|\bhowever\b|\bwhile\b|[;\n])/i);
    return clauses.find(clause => this.subjectMatchesText(subject, clause)) || '';
  }

  subjectMatchesText(subject, text) {
    const subjectTokens = this.tokens(subject);
    const textTokens = this.tokens(text);
    if (subjectTokens.length === 0 || textTokens.length === 0) return false;
    return subjectTokens.every(subjectToken => textTokens.some(textToken => {
      if (subjectToken === textToken) return true;
      return subjectToken.length >= 5 && textToken.length >= 5 &&
        Math.abs(subjectToken.length - textToken.length) <= 1 &&
        this.editDistanceAtMostOne(subjectToken, textToken);
    }));
  }

  tokens(value) {
    return String(value || '').toLowerCase().match(/[a-z0-9]+/g)
      ?.filter(token => !STOP_WORDS.has(token))
      .map(token => ACTION_ROOTS[token] || token) || [];
  }

  editDistanceAtMostOne(left, right) {
    if (left === right) return true;
    if (Math.abs(left.length - right.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        i += 1;
        j += 1;
        continue;
      }
      edits += 1;
      if (edits > 1) return false;
      if (left.length > right.length) i += 1;
      else if (right.length > left.length) j += 1;
      else {
        i += 1;
        j += 1;
      }
    }
    if (i < left.length || j < right.length) edits += 1;
    return edits <= 1;
  }

  isNegativeStatement(text) {
    const action = ACTION_PATTERN;
    return new RegExp(`\\bi\\s+(?:have\\s+not|haven't|do\\s+not|don't)\\s+(?:${action}|have)\\b`, 'i').test(text) ||
      new RegExp(`\\bi\\s+(?:have\\s+never|never)\\s+(?:${action})\\b`, 'i').test(text) ||
      /\bi\s+(?:do\s+not|don't)\s+have\s+(?:direct\s+|hands-on\s+)?experience\b/i.test(text);
  }

  isPositiveStatement(text) {
    const action = ACTION_PATTERN;
    return new RegExp(`\\bi\\s+(?:have\\s+)?(?:${action})\\b`, 'i').test(text) ||
      /\bi\s+(?:do\s+)?have\s+(?:(?:direct|hands-on|professional|practical|commercial)\s+)?experience\b/i.test(text) ||
      new RegExp(`\\b(?:${action})\\b`, 'i').test(text);
  }

  buildSafeResponse(perSubject, subjects) {
    if (subjects.length === 0) {
      return "I don't want to overstate my experience here. I can explain how I would approach it if helpful.";
    }
    const negatives = perSubject.filter(item => item.state === STATES.EXPLICIT_NEGATIVE).map(item => item.subject);
    const positives = perSubject.filter(item => item.state === STATES.EXPLICIT_POSITIVE || item.state === STATES.SUPPORTED).map(item => item.subject);
    const unknowns = perSubject.filter(item => item.state === STATES.UNKNOWN).map(item => item.subject);
    const parts = [];
    if (positives.length) parts.push(`I can speak to my experience with ${this.joinSubjects(positives)}`);
    if (negatives.length) parts.push(`I haven't had direct experience with ${this.joinSubjects(negatives)}`);
    if (unknowns.length) parts.push(`I don't want to overstate my experience with ${this.joinSubjects(unknowns)}`);
    return `${parts.join(', but ')}. I can explain how I would approach ${subjects.length > 1 ? 'them' : 'it'} if helpful.`;
  }

  joinSubjects(subjects) {
    if (subjects.length < 2) return subjects[0] || 'that';
    return `${subjects.slice(0, -1).join(', ')} and ${subjects[subjects.length - 1]}`;
  }
}

module.exports = new ExperienceEvidenceService();
module.exports.STATES = STATES;
