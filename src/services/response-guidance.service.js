const RESPONSE_MODES = Object.freeze({
  GENERAL: 'GENERAL',
  INTERVIEW_PERSONAL: 'INTERVIEW_PERSONAL',
  INTERVIEW_PROJECT: 'INTERVIEW_PROJECT',
  TECHNICAL_CONCEPT: 'TECHNICAL_CONCEPT',
  FOLLOW_UP: 'FOLLOW_UP'
});

const DETAILED_PATTERN = /\b(?:in detail|more detail|explain (?:that |this )?more|elaborate|deep dive|step by step|thoroughly)\b/i;
const PERSONAL_PATTERN = /\b(?:tell me about yourself|walk me through your experience|why should we hire you|why are you a good fit|describe your background|your strengths|your experience)\b/i;
const PROJECT_PATTERN = /\b(?:current project|your project|your role|your contribution|your responsibilities|what challenges? did you face|biggest challenge|how did you implement|how did you use|how did you solve|what was the outcome|what was the result)\b/i;
const TECHNICAL_PATTERN = /^(?:what (?:is|are)\b.+|(?:explain|describe)\s+(?!(?:that|this|it)\b).+|how (?:does|do)\b.+\bwork\b|(?:what is )?(?:the )?difference between\b.+|compare\b.+?)[?.!]*$/i;
const ABOUT_SELF_PATTERN = /\b(?:tell me about yourself|walk me through your experience|describe your background)\b/i;
const ROLE_FIT_PATTERN = /\b(?:why should we hire you|why are you a good fit)\b/i;
const PROJECT_OVERVIEW_PATTERN = /\b(?:current project|tell me about your project)\b/i;
const PROJECT_CHALLENGE_PATTERN = /\b(?:what challenges? did you face|biggest challenge)\b/i;
const REFERENTIAL_FOLLOW_UP_PATTERN = /\b(?:that|this|it|those|there)\b/i;

const SHARED_GUIDANCE = `APPLICATION RESPONSE GUIDANCE
Write exactly as a candidate would speak spontaneously to an interviewer, not as a resume, LinkedIn profile, article, documentation page, or AI assistant. Start directly. Natural conversational tone must come only from wording, contractions, and sentence flow, never from adding facts. Give a complete but focused answer and match its depth to the question. Simple factual questions may be concise, while experience, project, architecture, challenge, and behavioral questions may be more detailed when useful. Avoid unnecessary repetition and unrelated information. Do not shorten an answer merely to satisfy a word or paragraph limit, and do not add unsupported details merely to make it longer.
Do not use headings or bullets unless the interviewer explicitly asks for a list. Do not restate the question, add a greeting, offer further help, or end with a sales slogan. Avoid generated resume phrases such as "my technical foundation is built on," "my core technical expertise includes," "I bring extensive experience," "throughout my career," "my primary objective," "I prioritize operational excellence," and "I have a proven track record."
Treat retrieved knowledge as a fact pool, never a checklist. For personal or project answers, distinguish factual claims from explanatory language. Every factual clause describing what happened, why, what the candidate did or used, how it was done, who was involved, the process followed, operational mechanics, impact, metrics, timeline, or outcome must be directly supported by explicit CANDIDATE EVIDENCE or an equally explicit Profile statement. A named action, tool, check, notification, or process supports only saying it was used or done; do not infer its purpose, configuration, recipient, input, output, or mechanics. Explanatory language may only paraphrase or connect supported facts without adding a new fact, purpose, capability, cause, step, actor, or result. Technical plausibility is not evidence. Omit unsupported connective detail.
Use session knowledge naturally and silently. Do not reveal filenames, document names, chunks, retrieval mechanics, uploaded material, or provided context unless explicitly asked for attribution.
Personal and project claims may come only from CANDIDATE EVIDENCE for this turn or Profile text that explicitly states the same personal fact or action. Job context, reference knowledge, unknown context, conversation history, and general model knowledge never authorize first-person claims. A technology appearing in a Profile skill list does not authorize a claim that the candidate implemented, configured, designed, or used it in a particular way. Never infer extra implementation details, causes, metrics, timelines, or outcomes beyond the explicit candidate evidence. Do not make unsupported negative biographical claims or discuss whether the candidate has or has not personally done something. When personal-action evidence is unavailable, begin directly with neutral or conditional phrasing such as "A typical implementation would" or "If I were implementing it, I would." General technical knowledge may explain concepts, but must not be presented as the user's experience.
When REFERENCE KNOWLEDGE supplies facts about the technical subject being asked about, it is the factual authority for that subject. Do not add properties or behavior from general model knowledge beyond that supplied reference. When no supplied reference covers the subject, normal general technical knowledge may be used.`;

class ResponseGuidanceService {
  createContinuity(conversationHistory, currentQuestion) {
    if (!Array.isArray(conversationHistory)) return null;

    for (let modelIndex = conversationHistory.length - 1; modelIndex >= 0; modelIndex--) {
      const modelEvent = conversationHistory[modelIndex];
      if (
        !modelEvent ||
        modelEvent.role !== 'model' ||
        typeof modelEvent.content !== 'string' ||
        !modelEvent.content.trim()
      ) {
        continue;
      }

      for (let userIndex = modelIndex - 1; userIndex >= 0; userIndex--) {
        const userEvent = conversationHistory[userIndex];
        if (
          !userEvent ||
          userEvent.role !== 'user' ||
          typeof userEvent.content !== 'string' ||
          !userEvent.content.trim()
        ) {
          continue;
        }
        const normalize = (value, maximumLength) => value
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maximumLength);
        return Object.freeze({
          previousQuestion: normalize(userEvent.content, 300),
          previousAnswer: normalize(modelEvent.content, 1000),
          currentQuestion
        });
      }
    }
    return null;
  }

  classify({ question, followUpUsed = false, hasProfile = false, hasKnowledge = false, hasCandidateEvidence = false, hasReferenceEvidence = false } = {}) {
    const normalizedQuestion = typeof question === 'string' ? question.trim() : '';
    let mode = RESPONSE_MODES.GENERAL;
    if (PERSONAL_PATTERN.test(normalizedQuestion)) {
      mode = RESPONSE_MODES.INTERVIEW_PERSONAL;
    } else if (followUpUsed && REFERENTIAL_FOLLOW_UP_PATTERN.test(normalizedQuestion)) {
      mode = RESPONSE_MODES.FOLLOW_UP;
    } else if (PROJECT_PATTERN.test(normalizedQuestion)) {
      mode = RESPONSE_MODES.INTERVIEW_PROJECT;
    } else if (TECHNICAL_PATTERN.test(normalizedQuestion)) {
      mode = RESPONSE_MODES.TECHNICAL_CONCEPT;
    } else if (followUpUsed) {
      mode = RESPONSE_MODES.FOLLOW_UP;
    }

    return Object.freeze({
      mode,
      intent: this.detectIntent(normalizedQuestion, mode),
      detailed: DETAILED_PATTERN.test(normalizedQuestion),
      followUpUsed: !!followUpUsed,
      hasPersonalEvidence: !!(hasProfile || hasCandidateEvidence),
      hasKnowledge: !!hasKnowledge,
      hasReferenceEvidence: !!hasReferenceEvidence
    });
  }

  detectIntent(question, mode) {
    if (ABOUT_SELF_PATTERN.test(question)) return 'ABOUT_SELF';
    if (ROLE_FIT_PATTERN.test(question)) return 'ROLE_FIT';
    if (PROJECT_CHALLENGE_PATTERN.test(question)) return 'PROJECT_CHALLENGE';
    if (PROJECT_OVERVIEW_PATTERN.test(question)) return 'PROJECT_OVERVIEW';
    if (mode === RESPONSE_MODES.FOLLOW_UP) return 'FOLLOW_UP_DETAIL';
    return mode;
  }

  buildGuidance(classification = {}, { continuity = null } = {}) {
    const modeGuidance = this.getModeGuidance(classification);
    const continuityBlock = classification.followUpUsed
      ? this.buildContinuityBlock(continuity)
      : '';
    const lengthGuidance = classification.detailed
      ? 'The interviewer requested detail. Expand meaningfully only by including additional facts explicitly present in authorized evidence or by explaining already-supported facts without adding new factual claims. Every added factual clause must remain directly traceable to that evidence. Do not infer a purpose, mechanism, configuration, recipient, workflow, cause, impact, outcome, or how a named action works. If the available evidence has no further depth, restate the supported information clearly and stop naturally rather than inventing details.'
      : 'Give a complete, focused answer at the depth the question warrants. Do not add unnecessary repetition or unrelated information.';
    return [
      SHARED_GUIDANCE,
      `RESPONSE MODE: ${classification.mode}`,
      `RESPONSE INTENT: ${classification.intent}`,
      continuityBlock,
      modeGuidance,
      lengthGuidance
    ].filter(Boolean).join('\n\n');
  }

  buildContinuityBlock(continuity) {
    if (!continuity || !continuity.previousQuestion || !continuity.previousAnswer) return '';
    return `CONVERSATIONAL CONTINUITY ONLY - NOT FACTUAL EVIDENCE

PREVIOUS USER QUESTION:
${continuity.previousQuestion}

PREVIOUS ASSISTANT ANSWER:
${continuity.previousAnswer}

Use the previous Q+A only to resolve conversational references and continue the narrow subject. Previous assistant claims are not factual evidence. Personal and project facts must be supported by current retrieved knowledge or matching Profile facts. General model knowledge may explain technical concepts neutrally. If matching personal evidence is unavailable, do not substitute an unrelated project implementation; answer neutrally or conditionally.`;
  }

  getModeGuidance(classification) {
    switch (classification.mode) {
      case RESPONSE_MODES.INTERVIEW_PERSONAL:
        if (!classification.hasPersonalEvidence) {
          return 'Do not invent a candidate history. Give a short, honest framework the user can customize without claiming unsupported experience.';
        }
        if (classification.intent === 'ROLE_FIT') {
          return 'Answer in natural first person using only explicitly supported differentiators relevant to the available role or job context. Omit unsupported fit, contribution, or impact claims. Do not produce another resume summary or use sales slogans.';
        }
        return 'Answer in natural first person using only the parts of a career description explicitly supported by personal evidence. Omit any unsupported identity, experience, work, or role connection. Do not enumerate skills or accomplishments.';
      case RESPONSE_MODES.INTERVIEW_PROJECT:
        if (!classification.hasPersonalEvidence) {
          return 'Do not fabricate a personal project or implementation. Give a bounded framework or identify the missing fact briefly.';
        }
        if (classification.intent === 'PROJECT_CHALLENGE') {
          return 'Choose one challenge explicitly supported by CANDIDATE EVIDENCE and answer in natural first person. Include the problem, reason, action, or result only when each is explicitly stated. Do not force a problem-action-result structure. Do not synthesize missing causes, impacts, methods, or techniques from general knowledge.';
        }
        if (classification.intent === 'PROJECT_OVERVIEW') {
          return 'Answer in natural first person. State only what the project is and what the candidate personally works on when explicitly supported. Include purpose, importance, or impact only when candidate evidence states it. Omit missing details rather than deriving experience from job or reference context.';
        }
        return 'Answer naturally in first person using only explicit CANDIDATE EVIDENCE or equally explicit Profile actions. Focus narrowly on the requested implementation, role, solution, or outcome, and stop when the supported facts are exhausted.';
      case RESPONSE_MODES.TECHNICAL_CONCEPT:
        if (classification.hasReferenceEvidence) {
          return 'Explain the subject naturally using only properties explicitly supplied by REFERENCE KNOWLEDGE. Harmless connective wording is allowed, but do not add capabilities, benefits, implementation details, actors, scale claims, use cases, technologies, causes, or outcomes from general model knowledge.';
        }
        return 'Give a neutral, conversational technical explanation at the depth the question warrants. A simple concept may be explained concisely, while a detailed request may receive a fuller explanation. Explain the idea the way one engineer would explain it aloud to another, using plain transitions and a compact example when useful. Avoid textbook headings, definition lists, and documentation-style prose. Do not force a first-person project narrative unless the question explicitly asks about the candidate\'s implementation and that experience is supported.';
      case RESPONSE_MODES.FOLLOW_UP:
        if (classification.hasReferenceEvidence && !classification.hasPersonalEvidence) {
          return 'Use the previous Q+A only to resolve the referenced subject. REFERENCE KNOWLEDGE is the factual ceiling. Do not claim personal experience and do not propose hypothetical tools, data structures, configurations, actors, steps, benefits, or implementation mechanics beyond what the reference explicitly states. If the question asks how it was implemented and the reference does not specify that, say the supplied information describes what it does but does not provide implementation details.';
        }
        return 'Use the conversational continuity block only to resolve what references such as that, this, or it mean and continue the narrow subject being discussed. Previous questions and assistant answers are not factual evidence. Personal implementation and project claims must be supported by CANDIDATE EVIDENCE or Profile facts that explicitly state the same action for the referenced subject. Ignore job, reference, unknown, unrelated retrieved, and unrelated Profile material as personal authority. Do not substitute a different personal implementation when matching evidence is unavailable. Never use past-tense first-person implementation claims such as "I used," "I implemented," "I compared," or "I assigned" unless explicit personal-action evidence supports them. Without such evidence, answer neutrally or conditionally. When REFERENCE KNOWLEDGE covers the subject, that conditional explanation must remain within the supplied reference facts; if it contains no implementation details, do not invent any. When no supplied reference covers the subject, normal general technical knowledge may be used.';
      default:
        return 'Use the format best suited to the request while remaining direct, concise, and human-sounding.';
    }
  }
}

module.exports = new ResponseGuidanceService();
module.exports.RESPONSE_MODES = RESPONSE_MODES;
