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
const QUERY_EXPANSIONS = Object.freeze([
  Object.freeze({
    phrase: 'tell me about yourself',
    terms: Object.freeze([
      'professional', 'summary', 'experience', 'skills', 'career', 'profile'
    ])
  }),
  Object.freeze({
    phrase: 'current project',
    terms: Object.freeze([
      'project', 'responsibilities', 'architecture', 'implementation'
    ])
  })
]);

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
    const normalizedQuery = this.normalizeText(queryText);
    const queryTokens = this.expandQueryTokens(
      normalizedQuery,
      this.tokenizeNormalizedText(normalizedQuery)
    );

    if (!normalizedQuery || queryTokens.length === 0 || sourceChunks.length === 0) {
      return this.createResult(queryText, startTime, sourceChunks.length, 0, [], 0);
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
        uniqueQueryTokens
      );
      if (scored.score >= minimumScore) {
        scoredChunks.push({ chunk, score: scored.score, originalPosition });
      }
    });

    scoredChunks.sort((first, second) =>
      second.score - first.score || first.originalPosition - second.originalPosition
    );

    const selectedChunks = [];
    const selectedIds = new Set();
    let totalSelectedCharacters = 0;

    for (const candidate of scoredChunks) {
      if (selectedChunks.length >= topK) break;
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
        index: candidate.chunk.index,
        content,
        score: Number(candidate.score.toFixed(4))
      });
      selectedIds.add(candidate.chunk.id);
      totalSelectedCharacters += content.length;
    }

    const matchedChunks = new Set(scoredChunks.map(item => item.chunk.id)).size;
    return this.createResult(
      queryText,
      startTime,
      sourceChunks.length,
      matchedChunks,
      selectedChunks,
      totalSelectedCharacters
    );
  }

  expandQueryTokens(normalizedQuery, queryTokens) {
    const expandedTokens = [...queryTokens];
    const seenTokens = new Set(queryTokens);

    for (const expansion of QUERY_EXPANSIONS) {
      if (!normalizedQuery.includes(expansion.phrase)) continue;

      for (const term of expansion.terms) {
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

  scoreChunk(chunk, normalizedQuery, queryFrequencies, uniqueQueryTokens) {
    let score = 0;
    const matchedTokens = [];

    for (const token of uniqueQueryTokens) {
      const chunkFrequency = Number(chunk.tokenFrequencies[token] || 0);
      if (chunkFrequency <= 0) continue;

      matchedTokens.push(token);
      const queryFrequency = queryFrequencies[token];
      score += 1.25;
      score += Math.min(chunkFrequency, 4) * 0.35;
      score += Math.min(queryFrequency, 3) * 0.2;

      if (chunk.documentNameTokens.includes(token)) {
        score += 1.5;
      }
    }

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
    if (
      matchedTokens.length > 0 &&
      matchedTokens.every(token => COMMON_RETRIEVAL_TERMS.has(token))
    ) {
      score *= 0.55;
    }

    return { score, matchedTokens };
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
    totalSelectedCharacters
  ) {
    return {
      query,
      elapsedMs: Number((performance.now() - startTime).toFixed(3)),
      totalChunks,
      matchedChunks,
      selectedChunks,
      totalSelectedCharacters
    };
  }
}

module.exports = new KnowledgeRetrievalService();
