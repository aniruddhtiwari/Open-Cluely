const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const {
  classifyObviousNonActionableSpeech,
  isActionableAudioRequest,
  shouldAutomaticallyRespondToAudio
} = require('../src/services/speech-actionability.service');

const EXPECTED = Object.freeze({
  ACTIONABLE: 'LOCAL_EXPECTED_ACTIONABLE',
  NON_ACTIONABLE: 'LOCAL_EXPECTED_NON_ACTIONABLE',
  AMBIGUOUS: 'EXPECTED_AMBIGUOUS_PROVIDER_DECISION'
});

const cases = [];
const groupCounts = new Map();
function add(group, source, expected, entries, options = {}) {
  entries.forEach(text => {
    const ordinal = (groupCounts.get(group) || 0) + 1;
    groupCounts.set(group, ordinal);
    cases.push({
    id: `${group}-${String(ordinal).padStart(2, '0')}`,
    group,
    source,
    expected,
    text,
    provider: !!options.provider
    });
  });
}

add('mic-context', 'MIC', EXPECTED.NON_ACTIONABLE, [
  'In my current project I designed the common data model.',
  'I have not worked with Scala.'
]);
add('mic-context', 'MIC', EXPECTED.AMBIGUOUS, [
  'We integrated more than twenty source systems.',
  'I worked closely with Finance and Operations.',
  'The biggest challenge was data consistency.',
  'I have worked with Kafka.',
  'The portfolio is over $35 billion.',
  'Actually, the number is closer to 35 billion.',
  'My role was primarily data architecture.',
  'The result was that validation dropped to under two minutes.'
], { provider: true });

add('mic-request', 'MIC', EXPECTED.ACTIONABLE, [
  'What should I say?',
  'Give me a better answer.',
  'How should I explain this?',
  "What's a concise way to answer that?",
  'Can you help me answer this?'
]);

add('system-context', 'SYSTEM', EXPECTED.NON_ACTIONABLE, [
  'Our team is moving toward a lakehouse architecture.',
  'The role works closely with analytics and engineering.'
]);
add('system-context', 'SYSTEM', EXPECTED.AMBIGUOUS, [
  'We have several legacy systems.',
  'The main challenge for us is data quality.',
  'The environment supports several business units.',
  'Our current platform uses Kafka.',
  "We're planning a migration next year."
], { provider: true });

add('system-actionable', 'SYSTEM', EXPECTED.ACTIONABLE, [
  'Tell me about your current project.',
  'How do you handle slowly changing dimensions?',
  'Walk me through your data quality framework.',
  'Describe a difficult migration.',
  'Give me an example.',
  'Why?',
  'How so?',
  'What happened next?',
  'And the result?',
  'What was your role?',
  'Explain the architecture.',
  'Tell me how you handled that.'
]);

add('correction', 'MIC', EXPECTED.AMBIGUOUS, [
  'Actually, it is $35 billion.',
  'Correction, the number is 35.',
  'Let me correct that. It was December.',
  "I should clarify that I haven't worked with Scala.",
  "No, that's not right. It was Kafka."
], { provider: true });
add('correction-request', 'MIC', EXPECTED.ACTIONABLE, ['Actually, can you explain that?']);

add('acknowledgment', 'MIC', EXPECTED.NON_ACTIONABLE, [
  'Okay.', 'Right.', 'Got it.', 'Sure.', 'Understood.'
]);
add('acknowledgment', 'MIC', EXPECTED.AMBIGUOUS, ['Mm-hmm.', 'Yeah.']);

add('incomplete', 'MIC', EXPECTED.AMBIGUOUS, [
  'So the thing we...',
  'Right, and then...',
  'How would you',
  'Tell me about',
  'The system was'
]);

add('declarative-question-like', 'MIC', EXPECTED.AMBIGUOUS, [
  'The question for us is data quality.',
  'What we found was that validation took too long.',
  'How we solved it was through better validation.',
  'Why this mattered was reporting accuracy.',
  'Can you believe the system had twenty feeds.'
], { provider: true });

add('imperative', 'SYSTEM', EXPECTED.ACTIONABLE, [
  'Tell me about SCD Type 2.',
  'Explain the architecture.',
  'Walk me through the migration.',
  'Describe the issue.'
]);
add('narrative', 'MIC', EXPECTED.AMBIGUOUS, [
  'They asked me to tell them about SCD Type 2.',
  'I explained the architecture.',
  'I walked them through the migration.',
  'I described the issue to the team.'
], { provider: true });

add('mic-answer', 'MIC', EXPECTED.AMBIGUOUS, [
  'Yes. In my current project...',
  'Sure. The way I approached it was...',
  'One example would be...',
  'The main challenge was...',
  'What I did first was...'
]);

add('mixed-request', 'SYSTEM', EXPECTED.ACTIONABLE, [
  'Our team uses Kafka. How would you approach that?',
  'We have several legacy systems. Tell me how you would modernize them.',
  'The portfolio is $35 billion. What challenges do you see at that scale?',
  'Actually, the number is $35 billion. Can you update the answer?'
]);

add('short-follow-up', 'SYSTEM', EXPECTED.ACTIONABLE, [
  'Why?', 'How so?', 'And the result?'
]);

function diagnose(item, decision) {
  return `${item.id} source=${item.source} text=${JSON.stringify(item.text)} expected=${item.expected} ` +
    `actual=${decision.bypass ? 'LOCAL_BYPASS' : 'GEMINI_CAPABLE'} reason=${decision.reason || 'none'}`;
}

const started = performance.now();
let classificationMs = 0;
const results = cases.map(item => {
  const itemStarted = performance.now();
  const decision = classifyObviousNonActionableSpeech(item.text);
  classificationMs += performance.now() - itemStarted;

  if (item.expected === EXPECTED.NON_ACTIONABLE) {
    assert.equal(decision.bypass, true, diagnose(item, decision));
  } else {
    assert.equal(decision.bypass, false, diagnose(item, decision));
  }
  return { ...item, decision, actionableHelper: isActionableAudioRequest(item.text) };
});

// Source labels are signals, not identities: identical content keeps identical local behavior.
for (const text of ['Tell me about the architecture.', 'We have several legacy systems.', 'Actually, it is 35.']) {
  const micDecision = { source: 'MIC', local: classifyObviousNonActionableSpeech(text) };
  const systemDecision = { source: 'SYSTEM', local: classifyObviousNonActionableSpeech(text) };
  assert.deepEqual(micDecision.local, systemDecision.local, `source alone changed local behavior for ${text}`);
  assert.equal(shouldAutomaticallyRespondToAudio('all', 'mic', text), true, `all mode rejected MIC text: ${text}`);
  assert.equal(shouldAutomaticallyRespondToAudio('all', 'speaker', text), true, `all mode rejected SYSTEM text: ${text}`);
}

const count = expected => results.filter(item => item.expected === expected).length;
const passed = expected => results.filter(item => item.expected === expected).filter(item =>
  expected === EXPECTED.NON_ACTIONABLE ? item.decision.bypass : !item.decision.bypass
).length;
const group = name => results.filter(item => item.group === name);
const rate = (numerator, denominator) => denominator ? `${numerator}/${denominator} (${(numerator * 100 / denominator).toFixed(1)}%)` : 'n/a';

const actionable = count(EXPECTED.ACTIONABLE);
const nonActionable = count(EXPECTED.NON_ACTIONABLE);
const ambiguous = count(EXPECTED.AMBIGUOUS);
const micRequests = group('mic-request');
const mixed = group('mixed-request');
const pairCases = [...group('imperative'), ...group('narrative')];
const correctionCases = group('correction');

console.log('Interview actionability baseline');
console.log(`TOTAL CASES: ${results.length}`);
console.log(`KNOWN ACTIONABLE: ${actionable}`);
console.log(`KNOWN NON_ACTIONABLE: ${nonActionable}`);
console.log(`AMBIGUOUS: ${ambiguous}`);
console.log(`ACTIONABLE ROUTING PASS RATE: ${rate(passed(EXPECTED.ACTIONABLE), actionable)}`);
console.log(`NON_ACTIONABLE LOCAL SUPPRESSION RATE: ${rate(passed(EXPECTED.NON_ACTIONABLE), nonActionable)}`);
console.log(`MIC EXPLICIT REQUEST ROUTING RATE: ${rate(micRequests.filter(item => !item.decision.bypass).length, micRequests.length)}`);
console.log(`CORRECTION LOCAL SUPPRESSION RATE: ${rate(correctionCases.filter(item => item.decision.bypass).length, correctionCases.length)}; remaining cases require provider decision after storage`);
console.log(`IMPERATIVE/NARRATIVE PAIR PASS RATE: ${rate(pairCases.filter(item => item.expected === EXPECTED.ACTIONABLE ? !item.decision.bypass : !item.decision.bypass).length, pairCases.length)} baseline routes preserved`);
console.log(`MIXED CONTEXT+REQUEST PASS RATE: ${rate(mixed.filter(item => !item.decision.bypass).length, mixed.length)}`);
console.log(`LOCAL EXECUTION: ${(performance.now() - started).toFixed(3)} ms total; ${(classificationMs / results.length).toFixed(4)} ms average classification`);

async function runProviderCases() {
  if (process.env.OPENCLUELY_ACTIONABILITY_PROVIDER_TEST !== 'true') return;
  process.env.USE_GEMINI_INTERACTIONS_SESSION = 'false';
  require('dotenv').config();
  const llm = require('../src/services/llm.service');
  const claims = require('../src/services/candidate-claim-enforcement.service');
  const apiKey = process.env.GEMINI_API_KEY;
  assert.ok(apiKey, 'GEMINI_API_KEY is required for optional provider validation');

  const eligible = results.filter(item => item.provider && item.expected === EXPECTED.AMBIGUOUS);
  const providerCases = [
    ...['mic-context', 'system-context', 'correction', 'declarative-question-like', 'narrative']
      .flatMap(groupName => eligible.filter(item => item.group === groupName).slice(0, 2)),
    ...eligible.filter(item => item.group === 'mic-context').slice(2, 3)
  ];
  let noResponse = 0;
  let response = 0;
  const falsePositives = [];
  for (const item of providerCases) {
    const context = claims.prepare({ question: item.text });
    const built = llm.buildIntelligentTranscriptionRequest(item.text, '', '', [], null, [], context.contract, '');
    built.request.generationConfig = {
      ...built.request.generationConfig,
      maxOutputTokens: 260,
      thinkingConfig: { thinkingBudget: 0 }
    };
    const output = String(await llm._streamRequestForModel(
      built.request,
      'gemini-3.1-flash-lite',
      apiKey,
      null
    ) || '').trim();
    if (output === llm.getNoResponseToken() || !output) noResponse += 1;
    else {
      response += 1;
      falsePositives.push(item.id);
    }
  }
  console.log(`PROVIDER CASES: ${providerCases.length}`);
  console.log(`PROVIDER [[NO_RESPONSE]]: ${noResponse}`);
  console.log(`PROVIDER RESPONSES: ${response}`);
  console.log(`PROVIDER FALSE-POSITIVE RATE: ${rate(response, providerCases.length)}`);
  console.log('PROVIDER MISSED-ACTIONABLE RATE: n/a (provider sample intentionally ambiguous-only)');
  if (falsePositives.length) console.log(`PROVIDER FALSE-POSITIVE CASES: ${falsePositives.join(', ')}`);
}

runProviderCases().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
