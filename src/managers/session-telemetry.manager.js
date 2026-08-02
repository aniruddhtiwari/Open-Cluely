const crypto = require('crypto');

const TIMESTAMP_FIELDS = new Set([
  'retrievalStartedAt',
  'retrievalCompletedAt',
  'llmRequestStartedAt',
  'firstChunkReceivedAt',
  'responseCompletedAt'
]);

class SessionTelemetryManager {
  constructor() {
    this.telemetryEnabled = true;
    this.sessionStartedAt = Date.now();
    this.interactions = new Map();
  }

  isEnabled() {
    return this.telemetryEnabled;
  }

  setEnabled(enabled) {
    this.telemetryEnabled = enabled === true;
    if (!this.telemetryEnabled) this.clear();
    return this.telemetryEnabled;
  }

  startInteraction(details = {}) {
    if (!this.telemetryEnabled) return null;
    const now = Date.now();
    const inputType = details.inputType === 'speech' ? 'speech' : 'typed';
    const interactionId = typeof details.interactionId === 'string' && details.interactionId.trim()
      ? details.interactionId.trim()
      : crypto.randomUUID();
    const question = typeof details.question === 'string' ? details.question : '';
    const record = {
      interactionId,
      inputType,
      question,
      timestamp: new Date(now).toISOString(),
      rawTranscription: inputType === 'speech' && typeof details.rawTranscription === 'string'
        ? details.rawTranscription
        : null,
      finalTranscription: inputType === 'speech' && typeof details.finalTranscription === 'string'
        ? details.finalTranscription
        : null,
      interactionStartedAt: now,
      typedSubmittedAt: inputType === 'typed' ? now : null,
      speechFinalizedAt: inputType === 'speech' ? now : null,
      retrievalStartedAt: null,
      retrievalCompletedAt: null,
      llmRequestStartedAt: null,
      firstChunkReceivedAt: null,
      responseCompletedAt: null,
      aiResponseFirstRenderedAt: null,
      chatFirstRenderedAt: null,
      finalAnswer: null,
      activeSkill: typeof details.activeSkill === 'string' ? details.activeSkill : '',
      activeProfile: typeof details.activeProfile === 'string' ? details.activeProfile : '',
      codingLanguage: typeof details.codingLanguage === 'string' ? details.codingLanguage : '',
      responseMode: null,
      responseIntent: null,
      selectedDocumentIds: [],
      selectedChunkIds: [],
      timings: {
        retrievalMs: null,
        questionToFirstChunkMs: null,
        totalResponseMs: null,
        aiResponseRenderDelayMs: null,
        chatRenderDelayMs: null,
        questionToAiResponseRenderMs: null
      },
      error: null
    };
    this.interactions.set(interactionId, record);
    return interactionId;
  }

  mark(interactionId, field, timestamp = Date.now()) {
    if (!this.telemetryEnabled || !TIMESTAMP_FIELDS.has(field)) return false;
    const record = this.interactions.get(interactionId);
    if (!record || record[field] !== null) return false;
    record[field] = timestamp;
    this.updateDerivedMetrics(record);
    return true;
  }

  recordRetrieval(interactionId, details = {}) {
    if (!this.telemetryEnabled) return false;
    const record = this.interactions.get(interactionId);
    if (!record) return false;
    record.responseMode = typeof details.responseMode === 'string' ? details.responseMode : null;
    record.responseIntent = typeof details.responseIntent === 'string' ? details.responseIntent : null;
    record.selectedDocumentIds = this.normalizeIds(details.selectedDocumentIds);
    record.selectedChunkIds = this.normalizeIds(details.selectedChunkIds);
    return true;
  }

  recordFirstChunk(interactionId, timestamp = Date.now()) {
    return this.mark(interactionId, 'firstChunkReceivedAt', timestamp);
  }

  acknowledgeFirstRender(interactionId, target, timestamp = Date.now()) {
    if (!this.telemetryEnabled) return false;
    const record = this.interactions.get(interactionId);
    if (!record) return false;
    const field = target === 'aiResponse'
      ? 'aiResponseFirstRenderedAt'
      : target === 'chat'
        ? 'chatFirstRenderedAt'
        : null;
    if (!field || record[field] !== null) return false;
    record[field] = timestamp;
    this.updateDerivedMetrics(record);
    return true;
  }

  completeInteraction(interactionId, finalAnswer, timestamp = Date.now()) {
    if (!this.telemetryEnabled) return false;
    const record = this.interactions.get(interactionId);
    if (!record) return false;
    if (record.responseCompletedAt === null) record.responseCompletedAt = timestamp;
    if (record.finalAnswer === null && typeof finalAnswer === 'string') {
      record.finalAnswer = finalAnswer;
    }
    this.updateDerivedMetrics(record);
    return true;
  }

  failInteraction(interactionId, error, timestamp = Date.now()) {
    if (!this.telemetryEnabled) return false;
    const record = this.interactions.get(interactionId);
    if (!record) return false;
    if (record.responseCompletedAt === null) record.responseCompletedAt = timestamp;
    record.error = 'Interaction failed';
    this.updateDerivedMetrics(record);
    return true;
  }

  clear() {
    const removedCount = this.interactions.size;
    this.interactions.clear();
    this.sessionStartedAt = Date.now();
    return removedCount;
  }

  getInteractionCount() {
    return this.interactions.size;
  }

  createExportData() {
    if (!this.telemetryEnabled) {
      return { success: false, disabled: true, message: 'Session telemetry is disabled' };
    }
    return {
      success: true,
      session: {
        startedAt: new Date(this.sessionStartedAt).toISOString(),
        exportedAt: new Date().toISOString(),
        interactionCount: this.interactions.size
      },
      interactions: Array.from(this.interactions.values(), record => ({
        ...record,
        selectedDocumentIds: [...record.selectedDocumentIds],
        selectedChunkIds: [...record.selectedChunkIds],
        timings: { ...record.timings }
      }))
    };
  }

  exportJSON() {
    const data = this.createExportData();
    return data.success ? JSON.stringify(data, null, 2) : data;
  }

  exportMarkdown() {
    const data = this.createExportData();
    if (!data.success) return data;
    const lines = [
      '# OpenCluely Session Transcript',
      '',
      `- Started: ${data.session.startedAt}`,
      `- Exported: ${data.session.exportedAt}`,
      `- Interactions: ${data.session.interactionCount}`,
      ''
    ];
    data.interactions.forEach((record, index) => {
      const source = record.inputType === 'speech' ? 'speech' : 'typed';
      lines.push(`## Interaction ${index + 1}`, '');
      lines.push(`[${record.timestamp}] USER (${source})`, record.question || '', '');
      if (record.inputType === 'speech') {
        lines.push('Raw finalized transcription:', record.rawTranscription || '', '');
        lines.push('Final/coalesced transcription:', record.finalTranscription || '', '');
      }
      lines.push(
        `Context: skill=${record.activeSkill || 'None'}, profile=${record.activeProfile || 'None'}, ` +
        `language=${record.codingLanguage || 'None'}, mode=${record.responseMode || 'n/a'}, ` +
        `intent=${record.responseIntent || 'n/a'}`,
        `Selected documents: ${record.selectedDocumentIds.join(', ') || 'none'}`,
        `Selected chunks: ${record.selectedChunkIds.join(', ') || 'none'}`,
        ''
      );
      if (record.firstChunkReceivedAt !== null) {
        lines.push(`[${new Date(record.firstChunkReceivedAt).toISOString()}] AI FIRST CHUNK`, '');
      }
      if (record.responseCompletedAt !== null) {
        lines.push(
          `[${new Date(record.responseCompletedAt).toISOString()}] AI COMPLETE`,
          record.finalAnswer || '',
          ''
        );
      }
      const metrics = record.timings;
      lines.push(
        `Latency: retrieval=${this.formatMetric(metrics.retrievalMs)}, ` +
        `question-to-first-chunk=${this.formatMetric(metrics.questionToFirstChunkMs)}, ` +
        `total=${this.formatMetric(metrics.totalResponseMs)}, ` +
        `AI-render-delay=${this.formatMetric(metrics.aiResponseRenderDelayMs)}, ` +
        `chat-render-delay=${this.formatMetric(metrics.chatRenderDelayMs)}, ` +
        `question-to-AI-render=${this.formatMetric(metrics.questionToAiResponseRenderMs)}`,
        ''
      );
    });
    return lines.join('\n');
  }

  calculateDerivedMetrics(record) {
    const submittedAt = record.typedSubmittedAt || record.speechFinalizedAt || record.interactionStartedAt;
    return {
      retrievalMs: this.duration(record.retrievalStartedAt, record.retrievalCompletedAt),
      questionToFirstChunkMs: this.duration(submittedAt, record.firstChunkReceivedAt),
      totalResponseMs: this.duration(submittedAt, record.responseCompletedAt),
      aiResponseRenderDelayMs: this.duration(record.firstChunkReceivedAt, record.aiResponseFirstRenderedAt),
      chatRenderDelayMs: this.duration(record.firstChunkReceivedAt, record.chatFirstRenderedAt),
      questionToAiResponseRenderMs: this.duration(submittedAt, record.aiResponseFirstRenderedAt)
    };
  }

  updateDerivedMetrics(record) {
    const metrics = this.calculateDerivedMetrics(record);
    Object.assign(record.timings, metrics);
  }

  duration(start, end) {
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  }

  normalizeIds(values) {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.filter(value => typeof value === 'string' && value)));
  }

  formatMetric(value) {
    return value === null ? 'n/a' : `${value}ms`;
  }
}

module.exports = new SessionTelemetryManager();
