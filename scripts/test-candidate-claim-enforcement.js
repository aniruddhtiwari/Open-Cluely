const assert = require('node:assert/strict');
const service = require('../src/services/candidate-claim-enforcement.service');

const { FALLBACK_INTENTS, EVIDENCE_TYPES } = service;

function context(question, evidence = {}, selectedChunks = []) {
  return service.prepare({ question, evidenceSources: evidence, selectedChunks });
}

function enforce(question, raw, evidence = {}, selectedChunks = [], deltas = null) {
  const prepared = context(question, evidence, selectedChunks);
  const stream = service.createStream(prepared);
  for (const delta of deltas || [raw]) stream.push(delta);
  return stream.finalize(raw);
}

function manual(...manualContexts) {
  return { manualContexts };
}

let assertions = 0;
function check(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

const splitUnsafe = enforce(
  'Tell me about your Snowflake experience.',
  '',
  {},
  [],
  ['I', ' implemented', ' Snowflake', ' pipelines.']
);
check(!splitUnsafe.text.includes('implemented Snowflake'), 'split historical claim must not be visible');
check(splitUnsafe.metadata.unsafeUnits === 1, 'split historical claim must be detected once');

check(
  enforce('How would you model this?', 'My approach would be to start with the grain.').text.includes('start with the grain'),
  'safe prospective answer must remain visible'
);
check(
  !enforce('How do you use Kafka?', 'I typically use Kafka for event streaming.').text.includes('typically use Kafka'),
  'habitual claim must be blocked without evidence'
);
check(
  enforce('How would you use Kafka?', 'I would use Kafka for event streaming.').text.includes('I would use Kafka'),
  'prospective Kafka statement must remain visible'
);
check(
  !enforce('How would you use Kafka?', 'I would use the same pattern I implemented at my last company.').text.includes('last company'),
  'prospective wrapper must not authorize embedded history'
);

const projectContext = context('Tell me about the environment you support.', manual('$35B+ portfolio'));
check(projectContext.capsules[0].type === EVIDENCE_TYPES.PROJECT_FACT, 'project fact capsule must be created');
check(projectContext.capsules[0].renderText.includes('$35B+ portfolio'), 'project fact must render neutrally');
check(!projectContext.capsules[0].renderText.startsWith('I '), 'project fact must not create personal ownership');
check(
  !enforce('Tell me about the environment you support.', 'I built the $35B+ portfolio.', manual('$35B+ portfolio')).text.includes('I built'),
  'project fact must not authorize an invented action'
);

const kafkaContext = context('Do you have experience with Kafka?', manual('I have worked with Kafka'));
check(kafkaContext.capsules[0].type === EVIDENCE_TYPES.TECHNOLOGY_ONLY, 'Kafka evidence must be technology-only');
check(
  enforce('Do you have experience with Kafka?', '[[CLAIM:C1]]\n', manual('I have worked with Kafka')).text.includes("I've worked with Kafka"),
  'exact technology capsule must render'
);
check(
  !enforce('Do you have experience with Kafka?', 'I configured Schema Registry compatibility rules.', manual('I have worked with Kafka')).text.includes('Schema Registry'),
  'technology-only evidence must not authorize invented mechanics'
);

const excluded = context(
  'Do you have experience with Snowflake or Databricks?',
  {},
  [
    { evidenceType: 'reference', content: 'The candidate built Snowflake pipelines.' },
    { evidenceType: 'system', content: 'The candidate used Databricks.' },
    { evidenceType: 'prior-ai', content: 'I implemented both platforms.' }
  ]
);
check(excluded.capsules.length === 0, 'SYSTEM/JD/reference/prior-AI sources must not create capsules');

check(
  enforce('How would you validate a design?', 'I would validate the grain and constraints').text.includes('grain and constraints'),
  'unterminated safe final unit must be released'
);
check(
  !enforce('Tell me about your work.', 'I implemented the migration').text.includes('implemented the migration'),
  'unterminated historical final unit must be suppressed'
);

const recovered = enforce(
  'Tell me about your CDC experience.',
  'A practical CDC design would define ordering. I implemented CDC at my last company. A safe design would also define recovery requirements.'
);
check(recovered.text.includes('define ordering'), 'safe unit before unsafe history must remain');
check(!recovered.text.includes('last company'), 'unsafe middle unit must be absent');
check(recovered.text.includes('define recovery requirements'), 'independent safe unit after suppression must recover');
check(recovered.metadata.safeUnitsRetained === 2, 'safe retained telemetry must count both independent units');

const dependent = enforce(
  'Tell me about a project.',
  'I implemented Snowflake pipelines. This allowed us to reduce latency. For a similar requirement today, I would first establish ordering and recovery requirements.'
);
check(!dependent.text.includes('implemented Snowflake'), 'unsafe project action must be suppressed');
check(!dependent.text.includes('allowed us'), 'dependent continuation must be suppressed');
check(dependent.text.includes('similar requirement today'), 'independent prospective continuation must remain');
check(dependent.metadata.dependentUnitsSuppressed === 1, 'dependent suppression telemetry must be explicit');

const markdown = enforce(
  'How would you approach this?',
  '- First, I would define the grain.\n- Then, I would validate recovery.\n\n`code.with.periods()` remains intact.'
);
check(markdown.text.includes('- First,'), 'Markdown list marker must be preserved');
check(markdown.text.includes('- Then,'), 'second Markdown list marker must be preserved');
check(markdown.text.includes('`code.with.periods()`'), 'inline code boundary must be preserved');

const intents = [
  ['Do you have experience with Kafka?', FALLBACK_INTENTS.DIRECT_EXPERIENCE],
  ['Describe your Snowflake implementation experience.', FALLBACK_INTENTS.DIRECT_EXPERIENCE],
  ['Tell me about a time you resolved a conflict.', FALLBACK_INTENTS.BEHAVIORAL_EVENT],
  ['Tell me about the environment you support.', FALLBACK_INTENTS.PROJECT_OR_ENVIRONMENT],
  ['How would you design a resilient pipeline?', FALLBACK_INTENTS.PROSPECTIVE_HOW],
  ['What is SCD Type 2?', FALLBACK_INTENTS.CONCEPTUAL_EXPLANATION],
  ['Can you help with this question?', FALLBACK_INTENTS.GENERAL_RESPONSE]
];
for (const [question, expected] of intents) {
  check(context(question).fallbackIntent === expected, `${question} must select ${expected}`);
}

const directFallback = enforce(
  'Do you have experience with Kafka?',
  'I built Kafka producers and managed Schema Registry.',
  manual('I have worked with Kafka')
);
check(directFallback.text.includes("I've worked with Kafka"), 'direct fallback must use exact technology capsule');
check(directFallback.text.includes('approach I would take'), 'direct fallback must add prospective guidance');
check(!directFallback.text.includes('Schema Registry'), 'fallback must not reuse suppressed raw history');
check(directFallback.metadata.fallbackIntent === FALLBACK_INTENTS.DIRECT_EXPERIENCE, 'fallback intent telemetry must be present');
check(directFallback.metadata.fallbackCapsulesUsed === 1, 'fallback capsule telemetry must be present');

const behavioralFallback = enforce(
  'Tell me about a time you resolved a conflict.',
  'I resolved a difficult stakeholder conflict and saved the project.'
);
check(behavioralFallback.text.includes('Without inventing a past example'), 'sparse behavioral fallback must be honest');
check(behavioralFallback.text.includes('approach I would take'), 'behavioral fallback must be prospective');

const supportedBehavioral = enforce(
  'Tell me about a time you resolved a conflict.',
  'I persuaded the stakeholder and saved the project.',
  manual('I facilitated a discussion between engineering and finance')
);
check(supportedBehavioral.text.includes('facilitated a discussion'), 'partial behavioral fallback must use supported action');
check(supportedBehavioral.text.includes('approach I would take'), 'partial behavioral fallback must add methodology');
check(!supportedBehavioral.text.includes('persuaded'), 'partial fallback must exclude invented raw action');

const malformedReference = enforce(
  'Tell me about a time you resolved a conflict.',
  '[[C1]]',
  manual('I facilitated a discussion between engineering and finance')
);
check(!malformedReference.text.includes('[[C1]]'), 'malformed capsule shorthand must fail closed');
check(malformedReference.text.includes('facilitated a discussion'), 'malformed capsule shorthand must recover through safe fallback');

const projectFallback = enforce(
  'Tell me about the environment you support.',
  'I built and managed the entire platform.',
  manual('$35B+ portfolio', 'More than 20 source systems', 'More than 35 downstream applications')
);
check(projectFallback.text.includes('$35B+ portfolio'), 'project fallback must synthesize safe scale fact');
check(projectFallback.text.includes('20 source systems'), 'project fallback must retain second safe project fact');
check(projectFallback.text.includes('35 downstream applications'), 'project fallback must retain third safe project fact');
check(!projectFallback.text.includes('I built'), 'project fallback must not invent ownership');

const prospectiveFallback = enforce('How would you design a resilient ingestion pipeline?', 'I built this at my last company.');
check(prospectiveFallback.text.includes('resilient ingestion pipeline'), 'prospective fallback must use the safe question subject');
check(prospectiveFallback.text.startsWith('For '), 'prospective fallback must answer prospectively');

const unsupportedDirect = enforce(
  'Describe your Snowflake implementation experience.',
  'I implemented Snowpipe and managed production warehouses.'
);
check(unsupportedDirect.text.includes('do not have candidate-owned evidence'), 'unsupported direct experience fallback must disclose the evidence limit');
check(unsupportedDirect.text.includes('approach I would take'), 'unsupported direct experience fallback must remain useful and prospective');

const unsupportedProjectExpansion = enforce(
  'Tell me about the environment you support.',
  'The infrastructure ensures reliable data flows across the enterprise.',
  manual('$35B+ portfolio')
);
check(!unsupportedProjectExpansion.text.includes('ensures reliable data flows'), 'unsupported project expansion must be blocked');
check(unsupportedProjectExpansion.text.includes('$35B+ portfolio'), 'blocked project expansion must recover with safe capsule');

const conceptual = enforce('What is SCD Type 2?', 'SCD Type 2 preserves history by adding versioned rows.');
check(conceptual.text.includes('preserves history'), 'safe Gemini conceptual content must be preserved');
check(!conceptual.metadata.fallbackUsed, 'safe conceptual content must not be replaced by fallback');

const validatedOnly = enforce(
  'Tell me about your migration experience.',
  'I led the migration. A prospective migration plan would define rollback criteria.'
);
check(!validatedOnly.text.includes('I led'), 'final result must exclude raw suppressed history');
check(validatedOnly.text.includes('rollback criteria'), 'final result must retain validated content');

console.log(`candidate claim enforcement: ${assertions} assertions passed`);
