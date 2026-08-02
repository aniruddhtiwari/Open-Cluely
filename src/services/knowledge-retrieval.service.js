const { performance } = require('perf_hooks');

const DEFAULT_OPTIONS = Object.freeze({
  topK: 5,
  maxContextCharacters: 12000,
  minimumScore: 0.75
});

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'me', 'more', 'most', 'my', 'of', 'on', 'or', 'our', 'ours',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to',
  'too', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'would', 'you', 'your'
]);

const USEFUL_SINGLE_CHARACTER_TOKENS = new Set(['c', 'r']);
const COMMON_RETRIEVAL_TERMS = new Set([
  'application', 'architecture', 'build', 'business', 'data', 'design',
  'developed', 'development', 'experience', 'project', 'service', 'system',
  'team', 'technology', 'used', 'using', 'work'
]);
const QUERY_INTENT_EXPANSIONS = Object.freeze([
  Object.freeze({
    patterns: Object.freeze([
      /tell me about yourself/,
      /walk me through (?:your )?experience/,
      /describe (?:your )?background/,
      /professional experience/,
      /how many years/
    ]),
    terms: Object.freeze([
      'professional', 'summary', 'career', 'experience', 'skills', 'background',
      'leadership', 'responsibilities'
    ])
  }),
  Object.freeze({
    patterns: Object.freeze([
      /good fit/,
      /hire you/,
      /experience match(?:es)? (?:this |the )?role/,
      /why (?:are )?you suitable/
    ]),
    terms: Object.freeze([
      'experience', 'skills', 'qualifications', 'responsibilities', 'requirements',
      'technical', 'leadership', 'background', 'professional', 'summary',
      'project', 'contribution', 'collaboration', 'delivery'
    ])
  }),
  Object.freeze({
    patterns: Object.freeze([
      /current project/,
      /about your project/,
      /your role in (?:the |this )?project/,
      /day to day responsibilities/,
      /your contribution/
    ]),
    terms: Object.freeze([
      'project', 'architecture', 'responsibilities', 'implementation',
      'contribution', 'role', 'design', 'delivery', 'technologies'
    ])
  }),
  Object.freeze({
    patterns: Object.freeze([
      /what challenges? did you face/,
      /biggest challenge/
    ]),
    terms: Object.freeze([
      'challenge', 'problem', 'issue', 'improvement', 'redesigned', 'reduced',
      'resolved', 'solution'
    ])
  }),
  Object.freeze({
    patterns: Object.freeze([
      /improv(?:e|ed|ing) performance/,
      /optimi[sz](?:e|ed|ing|ation).*processing/,
      /reduc(?:e|ed|ing) latency/,
      /batch optimi[sz]ation/,
      /\btuning\b/
    ]),
    terms: Object.freeze([
      'performance', 'optimization', 'latency', 'throughput', 'batch',
      'batches', 'processing', 'runtime', 'tuning', 'compaction', 'scalability'
    ])
  }),
  Object.freeze({
    patterns: Object.freeze([
      /data quality/,
      /\bvalidation\b/,
      /\breconciliation\b/,
      /quality framework/
    ]),
    terms: Object.freeze([
      'quality', 'validation', 'rules', 'reconciliation', 'exceptions',
      'monitoring', 'framework'
    ])
  }),
  Object.freeze({
    patterns: Object.freeze([
      /source systems?/,
      /data sources?/,
      /systems? did you integrate/,
      /\bingestion\b/
    ]),
    terms: Object.freeze([
      'sources', 'source', 'ingestion', 'integration', 'api', 'apis', 'files',
      'feeds'
    ])
  }),
  Object.freeze({
    patterns: Object.freeze([
      /business domain/,
      /\bindustry\b/,
      /business process/,
      /regulatory requirements?/
    ]),
    terms: Object.freeze([
      'domain', 'business', 'industry', 'process', 'regulatory', 'reporting',
      'compliance'
    ])
  }),
  Object.freeze({
    patterns: Object.freeze([
      /\bchallenges?\b/,
      /\boutcomes?\b/,
      /\bresults?\b/,
      /\bimpact\b/,
      /\bachievements?\b/
    ]),
    terms: Object.freeze([
      'challenge', 'challenges', 'solution', 'outcome', 'result', 'impact',
      'improvement', 'achievement'
    ])
  })
]);

const QUERY_SYNONYMS = Object.freeze([
  Object.freeze({
    patterns: Object.freeze([/\btools?\b/]),
    terms: Object.freeze([
      'technologies', 'technology', 'stack', 'skills'
    ])
  }),
  Object.freeze({ patterns: Object.freeze([/\btechnologies\b/]), terms: Object.freeze(['tools', 'technology', 'stack']) }),
  Object.freeze({ patterns: Object.freeze([/source systems?/]), terms: Object.freeze(['sources', 'ingestion', 'integration']) }),
  Object.freeze({ patterns: Object.freeze([/\badf\b/]), terms: Object.freeze(['azure', 'data', 'factory']) }),
  Object.freeze({ patterns: Object.freeze([/azure data factory/]), terms: Object.freeze(['adf']) }),
  Object.freeze({ patterns: Object.freeze([/\bscd2\b/]), terms: Object.freeze(['scd', 'type', '2']) }),
  Object.freeze({ patterns: Object.freeze([/scd type 2/]), terms: Object.freeze(['scd2']) }),
  Object.freeze({ patterns: Object.freeze([/data quality/]), terms: Object.freeze(['validation', 'reconciliation', 'quality']) }),
  Object.freeze({ patterns: Object.freeze([/batch processing/]), terms: Object.freeze(['batch', 'processing', 'throughput']) })
]);

const PERSONAL_QUERY_PATTERNS = Object.freeze([
  /\byou\b/,
  /\byour\b/,
  /did you/,
  /have you/,
  /how did you/,
  /tell me about your/,
  /what was your/
]);
const PROJECT_QUERY_PATTERN = /current project|about your project|your role in (?:the |this )?project|day to day responsibilities|your contribution/;
const PERFORMANCE_QUERY_PATTERN = /improv(?:e|ed|ing) performance|optimi[sz](?:e|ed|ing|ation).*processing|reduc(?:e|ed|ing) latency|batch optimi[sz]ation|\btuning\b/;
const DOMAIN_QUERY_PATTERN = /business domain|\bindustry\b|business process|regulatory requirements?/;
const PERSONAL_DOCUMENT_NAME_TERMS = Object.freeze(['resume', 'profile', 'project', 'experience']);
const REFERENCE_DOCUMENT_NAME_TERMS = Object.freeze([
  'job', 'jd', 'description', 'requirements', 'guide', 'reference',
  'documentation', 'docs'
]);
const PERSONAL_CONTENT_TERMS = Object.freeze([
  'responsibilities', 'implemented', 'designed', 'built', 'worked', 'led',
  'developed', 'project'
]);
const DOCUMENT_NAME_BOOST = 0.6;
const PERSONAL_DOCUMENT_BOOST = 1.4;
const PROJECT_DOCUMENT_BOOST = 1;
const PERSONAL_PERFORMANCE_PROJECT_BOOST = 0.8;
const DOMAIN_DOCUMENT_BOOST = 1.8;
const PERSONAL_CONTENT_TERM_BOOST = 0.35;
const PERSONAL_REFERENCE_PENALTY = 0.7;
const SAME_DOCUMENT_SELECTION_FACTORS = Object.freeze([1, 0.9, 0.78]);
const EXPLICIT_FOLLOW_UP_PATTERN = /\b(?:explain (?:that|this|it)|explain in more detail|tell me more|elaborate(?: on (?:that|this|it))?|go deeper|what about (?:that|this|it)|how so|what was (?:the )?outcome|what was your contribution|what tools did you use|what challenges did you face|what was the biggest challenge|how did you solve (?:that|this|it)|how did you do (?:that|this|it)|can you (?:explain|expand|elaborate)(?: (?:that|this|it))?(?: in more detail)?|how did you implement (?:that|this|it))\b/;
const REFERENTIAL_TERM_PATTERN = /\b(?:that|this|it|those|there)\b/;
const STRUCTURAL_STANDALONE_TOPIC_PATTERN = /^(?:what (?:is|are)\b.+|(?:explain|describe)\s+(?!(?:that|this|it)\b).+|how (?:does|do)\b.+\bwork\b|(?:what is )?(?:the )?difference between\b.+|compare\b.+)$/;

class KnowledgeRetrievalService {
  normalizeText(text) {
    return String(text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9+#.\s]/g, ' ')
      .replace(/\.(?!net\b)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  tokenize(text) {
    return this.tokenizeNormalizedText(this.normalizeText(text));
  }

  tokenizeNormalizedText(normalizedText) {
    const matches = normalizedText.match(/\.net|[a-z0-9]+(?:\+\+|#)?/g) || [];
    return matches.filter(token => {
      if (STOP_WORDS.has(token)) return false;
      return token.length > 1 || USEFUL_SINGLE_CHARACTER_TOKENS.has(token);
    });
  }

  createTokenFrequencies(tokens) {
    const frequencies = Object.create(null);
    for (const token of tokens) {
      frequencies[token] = (frequencies[token] || 0) + 1;
    }
    return frequencies;
  }

  prepareChunkRetrievalData(content, documentName) {
    const normalizedContent = this.normalizeText(content);
    const tokens = this.tokenizeNormalizedText(normalizedContent);
    const tokenFrequencies = Object.freeze(this.createTokenFrequencies(tokens));
    const normalizedDocumentName = this.normalizeText(documentName);
    const documentNameTokens = Object.freeze(
      Array.from(new Set(this.tokenizeNormalizedText(normalizedDocumentName)))
    );

    return Object.freeze({
      normalizedContent,
      tokenFrequencies,
      uniqueTokens: Object.freeze(Object.keys(tokenFrequencies)),
      normalizedDocumentName,
      documentNameTokens
    });
  }

  retrieve(query, chunks, options = {}) {
    const startTime = performance.now();
    const queryText = typeof query === 'string' ? query : '';
    const sourceChunks = Array.isArray(chunks) ? chunks : [];
    const topK = this.normalizePositiveInteger(options.topK, DEFAULT_OPTIONS.topK);
    const maxContextCharacters = this.normalizePositiveInteger(
      options.maxContextCharacters,
      DEFAULT_OPTIONS.maxContextCharacters
    );
    const minimumScore = Number.isFinite(options.minimumScore) && options.minimumScore > 0
      ? options.minimumScore
      : DEFAULT_OPTIONS.minimumScore;
    const retrievalPlan = this.createRetrievalPlan(queryText, options.followUpContext);
    const normalizedQuery = this.normalizeText(retrievalPlan.retrievalQuery);
    const queryTokens = this.expandQueryTokens(
      normalizedQuery,
      this.tokenizeNormalizedText(normalizedQuery)
    );
    const queryContext = Object.freeze({
      isPersonalExperience: PERSONAL_QUERY_PATTERNS.some(pattern => pattern.test(normalizedQuery)),
      isProjectIntent: PROJECT_QUERY_PATTERN.test(normalizedQuery),
      isPerformanceIntent: PERFORMANCE_QUERY_PATTERN.test(normalizedQuery),
      isDomainIntent: DOMAIN_QUERY_PATTERN.test(normalizedQuery)
    });

    if (!normalizedQuery || queryTokens.length === 0 || sourceChunks.length === 0) {
      return this.createResult(
        queryText,
        startTime,
        sourceChunks.length,
        0,
        [],
        0,
        retrievalPlan.isFollowUp
      );
    }

    const queryFrequencies = this.createTokenFrequencies(queryTokens);
    const uniqueQueryTokens = Object.keys(queryFrequencies);
    const scoredChunks = [];

    sourceChunks.forEach((chunk, originalPosition) => {
      if (!this.hasPreparedRetrievalData(chunk)) return;

      const scored = this.scoreChunk(
        chunk,
        normalizedQuery,
        queryFrequencies,
        uniqueQueryTokens,
        queryContext
      );
      const score = scored.score;
      if (score >= minimumScore) {
        scoredChunks.push({ chunk, score, originalPosition });
      }
    });

    const selectedChunks = [];
    const selectedIds = new Set();
    const selectedDocumentCounts = new Map();
    const remainingCandidates = [...scoredChunks];
    let totalSelectedCharacters = 0;

    while (remainingCandidates.length > 0) {
      if (selectedChunks.length >= topK) break;
      remainingCandidates.sort((first, second) => {
        const firstScore = this.applyDiversityFactor(first, selectedDocumentCounts);
        const secondScore = this.applyDiversityFactor(second, selectedDocumentCounts);
        return secondScore - firstScore || first.originalPosition - second.originalPosition;
      });
      const candidate = remainingCandidates.shift();
      if (selectedIds.has(candidate.chunk.id)) continue;

      const remainingCharacters = maxContextCharacters - totalSelectedCharacters;
      if (remainingCharacters <= 0) break;

      let content = candidate.chunk.content;
      if (content.length > remainingCharacters) {
        if (selectedChunks.length > 0) break;
        content = content.slice(0, remainingCharacters);
      }

      selectedChunks.push({
        id: candidate.chunk.id,
        documentId: candidate.chunk.documentId,
        documentName: candidate.chunk.documentName,
        evidenceType: candidate.chunk.evidenceType || 'unknown',
        index: candidate.chunk.index,
        content,
        score: Number(this.applyDiversityFactor(candidate, selectedDocumentCounts).toFixed(4))
      });
      selectedIds.add(candidate.chunk.id);
      const documentKey = this.getDocumentKey(candidate.chunk);
      selectedDocumentCounts.set(
        documentKey,
        (selectedDocumentCounts.get(documentKey) || 0) + 1
      );
      totalSelectedCharacters += content.length;
    }

    const matchedChunks = new Set(scoredChunks.map(item => item.chunk.id)).size;
    return this.createResult(
      queryText,
      startTime,
      sourceChunks.length,
      matchedChunks,
      selectedChunks,
      totalSelectedCharacters,
      retrievalPlan.isFollowUp
    );
  }

  createRetrievalPlan(query, followUpContext) {
    const queryText = typeof query === 'string' ? query : '';
    const previousQuery = followUpContext && typeof followUpContext.previousQuestion === 'string'
      ? followUpContext.previousQuestion.trim()
      : followUpContext && typeof followUpContext.previousQuery === 'string'
        ? followUpContext.previousQuery.trim()
        : '';
    const isFollowUp = !!previousQuery && this.isAmbiguousFollowUp(queryText);
    return {
      isFollowUp,
      retrievalQuery: isFollowUp ? `${previousQuery} ${queryText}` : queryText,
      previousQuery
    };
  }

  isAmbiguousFollowUp(query) {
    const normalizedQuery = this.normalizeText(query);
    if (!normalizedQuery || STRUCTURAL_STANDALONE_TOPIC_PATTERN.test(normalizedQuery)) return false;
    if (QUERY_INTENT_EXPANSIONS.some(expansion =>
      expansion.patterns.some(pattern => pattern.test(normalizedQuery)))) {
      return false;
    }
    if (normalizedQuery === 'why') return true;
    if (EXPLICIT_FOLLOW_UP_PATTERN.test(normalizedQuery)) return true;
    return this.tokenizeNormalizedText(normalizedQuery).length <= 6 &&
      REFERENTIAL_TERM_PATTERN.test(normalizedQuery);
  }

  expandQueryTokens(normalizedQuery, queryTokens) {
    const expandedTokens = [...queryTokens];
    const seenTokens = new Set(queryTokens);
    const expansions = QUERY_INTENT_EXPANSIONS;

    for (const expansion of expansions) {
      if (!expansion.patterns.some(pattern => pattern.test(normalizedQuery))) continue;

      for (const term of expansion.terms) {
        if (seenTokens.has(term)) continue;
        expandedTokens.push(term);
        seenTokens.add(term);
      }
    }

    for (const token of this.expandSynonymTokens(normalizedQuery, expandedTokens)) {
      if (!seenTokens.has(token)) expandedTokens.push(token);
    }

    return expandedTokens;
  }

  expandSynonymTokens(normalizedText, tokens) {
    const expandedTokens = [...tokens];
    const seenTokens = new Set(tokens);
    for (const synonym of QUERY_SYNONYMS) {
      if (!synonym.patterns.some(pattern => pattern.test(normalizedText))) continue;
      for (const term of synonym.terms) {
        if (seenTokens.has(term)) continue;
        expandedTokens.push(term);
        seenTokens.add(term);
      }
    }
    return expandedTokens;
  }

  hasPreparedRetrievalData(chunk) {
    return !!(
      chunk &&
      typeof chunk.id === 'string' &&
      typeof chunk.content === 'string' &&
      typeof chunk.normalizedContent === 'string' &&
      chunk.tokenFrequencies &&
      typeof chunk.tokenFrequencies === 'object' &&
      Array.isArray(chunk.uniqueTokens) &&
      typeof chunk.normalizedDocumentName === 'string' &&
      Array.isArray(chunk.documentNameTokens)
    );
  }

  scoreChunk(chunk, normalizedQuery, queryFrequencies, uniqueQueryTokens, queryContext) {
    let score = 0;
    const matchedTokens = [];
    let documentNameMatched = false;

    for (const token of uniqueQueryTokens) {
      const chunkFrequency = Number(chunk.tokenFrequencies[token] || 0);
      if (chunkFrequency <= 0) continue;

      matchedTokens.push(token);
      const queryFrequency = queryFrequencies[token];
      score += 1.25;
      score += Math.min(chunkFrequency, 4) * 0.35;
      score += Math.min(queryFrequency, 3) * 0.2;

      if (chunk.documentNameTokens.includes(token)) {
        documentNameMatched = true;
      }
    }

    if (documentNameMatched) score += DOCUMENT_NAME_BOOST;

    if (normalizedQuery.length >= 4 && chunk.normalizedContent.includes(normalizedQuery)) {
      score += 4;
    }
    if (
      normalizedQuery.length >= 3 &&
      chunk.normalizedDocumentName.includes(normalizedQuery)
    ) {
      score += 3;
    }
    if (matchedTokens.length > 1) {
      score += Math.min(matchedTokens.length - 1, 5) * 0.75;
    }
    if (matchedTokens.length > 0) {
      const commonTermCount = matchedTokens.filter(token => COMMON_RETRIEVAL_TERMS.has(token)).length;
      const commonTermRatio = commonTermCount / matchedTokens.length;
      score *= 1 - (0.45 * commonTermRatio * commonTermRatio);
    }

    if (queryContext.isPersonalExperience && matchedTokens.length > 0) {
      if (PERSONAL_DOCUMENT_NAME_TERMS.some(term => chunk.documentNameTokens.includes(term))) {
        score += PERSONAL_DOCUMENT_BOOST;
      }
      const personalContentMatches = PERSONAL_CONTENT_TERMS.filter(term =>
        chunk.tokenFrequencies[term]
      ).length;
      score += Math.min(personalContentMatches, 4) * PERSONAL_CONTENT_TERM_BOOST;
      if (queryContext.isProjectIntent && chunk.documentNameTokens.includes('project')) {
        score += PROJECT_DOCUMENT_BOOST;
      }
      if (queryContext.isPerformanceIntent && chunk.documentNameTokens.includes('project')) {
        score += PERSONAL_PERFORMANCE_PROJECT_BOOST;
      }
      if (
        !queryContext.isDomainIntent &&
        REFERENCE_DOCUMENT_NAME_TERMS.some(term => chunk.documentNameTokens.includes(term))
      ) {
        score = Math.max(0, score - PERSONAL_REFERENCE_PENALTY);
      }
    }
    if (queryContext.isDomainIntent && chunk.documentNameTokens.includes('domain')) {
      score += DOMAIN_DOCUMENT_BOOST;
    }

    return { score, matchedTokens };
  }

  getDocumentKey(chunk) {
    return typeof chunk.documentId === 'string' && chunk.documentId
      ? chunk.documentId
      : chunk.documentName;
  }

  applyDiversityFactor(candidate, selectedDocumentCounts) {
    const selectedCount = selectedDocumentCounts.get(this.getDocumentKey(candidate.chunk)) || 0;
    const factor = SAME_DOCUMENT_SELECTION_FACTORS[
      Math.min(selectedCount, SAME_DOCUMENT_SELECTION_FACTORS.length - 1)
    ];
    return candidate.score * factor;
  }

  normalizePositiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  createResult(
    query,
    startTime,
    totalChunks,
    matchedChunks,
    selectedChunks,
    totalSelectedCharacters,
    followUpUsed = false
  ) {
    return {
      query,
      elapsedMs: Number((performance.now() - startTime).toFixed(3)),
      totalChunks,
      matchedChunks,
      selectedChunks,
      totalSelectedCharacters,
      followUpUsed
    };
  }
}

module.exports = new KnowledgeRetrievalService();
