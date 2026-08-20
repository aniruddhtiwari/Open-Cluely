const ALLOWED_AUDIO_RESPONSE_MODES = new Set(['all']);

const OBVIOUS_SPEECH_ACKNOWLEDGEMENTS = new Set([
  'okay', 'ok', 'right', 'alright', 'got it', 'makes sense', 'that makes sense',
  'sounds good', 'sure', 'perfect', 'great', 'understood', 'interesting', 'thank you',
  'thanks', 'okay right', 'okay that makes sense', 'right that makes sense'
]);

function normalizeAudioResponseMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_AUDIO_RESPONSE_MODES.has(normalized) ? normalized : 'all';
}

function classifyObviousNonActionableSpeech(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { bypass: false };

  const normalized = raw
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return { bypass: false };

  const questionOrRequestStart = /^(?:(?:so|and|but)\s+)?(?:what|why|how|when|where|which|who)\b/;
  const auxiliaryQuestionStart = /^(?:can you|could you|would you|will you|do you|did you|have you|has anyone|are you|were you|is there|are there)\b/;
  const interviewRequestStart = /^(?:please\s+)?(?:tell me|walk me through|explain|describe|give me|help me|show me|compare|summarize|design|discuss)\b/;
  const assistanceRequest = /\b(?:how should i|what should i|how do i|what do i say|can you explain|can you help|how would i|how would you|what would i)\b/;
  const embeddedRequest = /(?:^|[.!;:]\s+)(?:please\s+)?(?:tell me|walk me through|explain|describe|give me|help me|show me|compare|summarize|design|discuss)\b/i;
  if (raw.includes('?') || assistanceRequest.test(normalized) || embeddedRequest.test(raw)) {
    return { bypass: false };
  }

  const reportedRequest = /^(?:(?:they|he|she|the interviewer)\s+asked\s+(?:me|us)\s+to|i\s+was\s+asked\s+to)\b/;
  const declarativeQuestionLabel = /^(?:the\s+)?(?:main\s+)?question(?:\s+for\s+(?:us|me))?\s+(?:is|was)\b/;
  const whatNarrative = /^what\s+we\s+(?:found|discovered|learned|observed)\s+was\b/;
  const howNarrative = /^how\s+we\s+(?:solved|handled|addressed|resolved|fixed)(?:\s+(?:it|this|that))?\s+was\b/;
  const whyNarrative = /^why\s+this\s+(?:mattered|was\s+important)\s+(?:is|was)\b/;
  if (reportedRequest.test(normalized)) {
    return { bypass: true, reason: 'reported-request-narrative' };
  }
  if (declarativeQuestionLabel.test(normalized) || whatNarrative.test(normalized) ||
      howNarrative.test(normalized) || whyNarrative.test(normalized)) {
    return { bypass: true, reason: 'declarative-question-narrative' };
  }

  if (questionOrRequestStart.test(normalized) ||
      auxiliaryQuestionStart.test(normalized) || interviewRequestStart.test(normalized) ||
      assistanceRequest.test(normalized)) {
    return { bypass: false };
  }

  if (OBVIOUS_SPEECH_ACKNOWLEDGEMENTS.has(normalized)) {
    return { bypass: true, reason: 'acknowledgement' };
  }

  const contextStatementStart = /^(?:i currently work|so currently i work|i work at|i am currently|i'm currently|i have (?:about )?[a-z0-9-]+ years|i haven't worked|i have not worked|i don't have experience|i do not have experience|i haven't used|i have not used|in my current role|in my current project|in my project|my current project|my team|our team|our company|we process|we ingest|we use|we mainly use|we primarily use|this role|this position|the role|the position|the team|the next round|the next interview|we're looking for|we are looking for)\b/;
  if (contextStatementStart.test(normalized)) {
    return { bypass: true, reason: 'context-statement' };
  }

  if (normalized.split(' ').length <= 5) return { bypass: false };

  return { bypass: false };
}

function isActionableAudioRequest(text) {
  const normalized = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (!normalized) return false;

  const withoutTrailingPunctuation = normalized.replace(/[.!?]+$/g, '').trim();
  if (/^(?:yes|no|ok|okay|right|got it|sure|exactly)$/.test(withoutTrailingPunctuation)) {
    return false;
  }
  if (/\?$/.test(normalized)) return true;

  const conversationalPrefix = '(?:(?:and|so|but)\\s+)?';
  const interrogative = new RegExp(`^${conversationalPrefix}(?:what|why|how|when|where|who|which)\\b`, 'i');
  const auxiliaryQuestion = new RegExp(`^${conversationalPrefix}(?:is|are|am|do|does|did|can|could|would|should|will)\\b`, 'i');
  const request = new RegExp(
    `^${conversationalPrefix}(?:(?:please|can|could|would|will)\\s+you\\s+)?(?:explain|describe|tell\\s+me|show\\s+me|write|give\\s+me|compare|optimize|solve|walk\\s+me\\s+through)\\b`,
    'i'
  );
  return interrogative.test(normalized) || auxiliaryQuestion.test(normalized) || request.test(normalized);
}

function shouldAutomaticallyRespondToAudio(mode, source, text) {
  const normalizedMode = normalizeAudioResponseMode(mode);
  if (normalizedMode === 'all') return true;
  if (normalizedMode === 'speaker') return source === 'speaker';
  return isActionableAudioRequest(text);
}

module.exports = {
  classifyObviousNonActionableSpeech,
  isActionableAudioRequest,
  normalizeAudioResponseMode,
  shouldAutomaticallyRespondToAudio
};
