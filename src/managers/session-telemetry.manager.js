class SessionTelemetryManager {
  constructor() {
    this.telemetryEnabled = true;
    this.clear();
  }

  isEnabled() {
    return this.telemetryEnabled;
  }

  setEnabled(enabled) {
    this.telemetryEnabled = enabled !== false;
    if (!this.telemetryEnabled) this.clear();
    return this.telemetryEnabled;
  }

  clear() {
    this.sessionStartedAt = new Date().toISOString();
    this.interactions = new Map();
  }

  startInteraction(data) {
    if (!this.telemetryEnabled) return null;
    if (!data || typeof data.id !== 'string' || !data.id.trim()) {
      throw new Error('Telemetry interaction id is required');
    }
    const startedAt = data.interactionStartedAt || new Date().toISOString();
    const interaction = {
      id: data.id.trim(),
      timestamp: startedAt,
      inputType: data.inputType === 'speech' ? 'speech' : 'typed',
      rawTranscription: data.inputType === 'speech' ? String(data.rawTranscription || '') : null,
      finalTranscription: data.inputType === 'speech' ? String(data.finalTranscription || data.question || '') : null,
      exactQuestion: String(data.question || ''),
      response: '',
      responseMode: null,
      responseDepth: null,
      followUpUsed: false,
      retrievedChunkCount: 0,
      retrievedDocumentCount: 0,
      interactionStartedAt: startedAt,
      typedSubmittedAt: data.typedSubmittedAt || null,
      speechFinalizedAt: data.speechFinalizedAt || null,
      retrievalStartedAt: null,
      retrievalCompletedAt: null,
      llmRequestStartedAt: null,
      firstChunkReceivedAt: null,
      aiResponseFirstRenderedAt: null,
      chatFirstRenderedAt: null,
      responseCompletedAt: null,
      retrievalMs: null,
      llmTimeToFirstChunkMs: null,
      totalResponseMs: null,
      questionToFirstChunkMs: null,
      aiResponseRenderDelayMs: null,
      chatRenderDelayMs: null,
      questionToAiResponseRenderMs: null
    };
    this.interactions.set(interaction.id, interaction);
    return interaction.id;
  }

  mark(id, field, value = new Date().toISOString()) {
    if (!this.telemetryEnabled) return false;
    const interaction = this.interactions.get(id);
    if (!interaction || !Object.prototype.hasOwnProperty.call(interaction, field)) return false;
    interaction[field] = value;
    this.updateDerivedMetrics(interaction);
    return true;
  }

  recordRetrieval(id, data = {}) {
    if (!this.telemetryEnabled) return false;
    const interaction = this.interactions.get(id);
    if (!interaction) return false;
    interaction.retrievalCompletedAt = data.completedAt || new Date().toISOString();
    interaction.retrievalMs = Number.isFinite(data.elapsedMs) ? data.elapsedMs : null;
    interaction.retrievedChunkCount = Number.isInteger(data.chunkCount) ? data.chunkCount : 0;
    interaction.retrievedDocumentCount = Number.isInteger(data.documentCount) ? data.documentCount : 0;
    interaction.followUpUsed = !!data.followUpUsed;
    return true;
  }

  recordFirstChunk(id, timestamp = new Date().toISOString()) {
    if (!this.telemetryEnabled) return false;
    const interaction = this.interactions.get(id);
    if (!interaction || interaction.firstChunkReceivedAt) return false;
    interaction.firstChunkReceivedAt = timestamp;
    this.updateDerivedMetrics(interaction);
    return true;
  }

  acknowledgeFirstRender(id, target, timestamp = new Date().toISOString()) {
    if (!this.telemetryEnabled) return false;
    const field = target === 'aiResponse' ? 'aiResponseFirstRenderedAt'
      : target === 'chat' ? 'chatFirstRenderedAt' : null;
    const interaction = this.interactions.get(id);
    if (!field || !interaction || interaction[field]) return false;
    interaction[field] = timestamp;
    this.updateDerivedMetrics(interaction);
    return true;
  }

  completeInteraction(id, data = {}) {
    if (!this.telemetryEnabled) return false;
    const interaction = this.interactions.get(id);
    if (!interaction) return false;
    interaction.response = String(data.response || '');
    interaction.responseMode = data.responseMode || null;
    interaction.responseDepth = data.responseDepth || null;
    interaction.responseCompletedAt = data.completedAt || new Date().toISOString();
    this.updateDerivedMetrics(interaction);
    return true;
  }

  updateDerivedMetrics(interaction) {
    const millisecondsBetween = (start, end) => {
      if (!start || !end) return null;
      const value = Date.parse(end) - Date.parse(start);
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    interaction.llmTimeToFirstChunkMs = millisecondsBetween(
      interaction.llmRequestStartedAt,
      interaction.firstChunkReceivedAt
    );
    interaction.questionToFirstChunkMs = millisecondsBetween(
      interaction.typedSubmittedAt || interaction.speechFinalizedAt || interaction.interactionStartedAt,
      interaction.firstChunkReceivedAt
    );
    interaction.totalResponseMs = millisecondsBetween(
      interaction.interactionStartedAt,
      interaction.responseCompletedAt
    );
    interaction.aiResponseRenderDelayMs = millisecondsBetween(
      interaction.firstChunkReceivedAt,
      interaction.aiResponseFirstRenderedAt
    );
    interaction.chatRenderDelayMs = millisecondsBetween(
      interaction.firstChunkReceivedAt,
      interaction.chatFirstRenderedAt
    );
    interaction.questionToAiResponseRenderMs = millisecondsBetween(
      interaction.typedSubmittedAt || interaction.speechFinalizedAt || interaction.interactionStartedAt,
      interaction.aiResponseFirstRenderedAt
    );
  }

  getSnapshot() {
    return {
      sessionStartedAt: this.sessionStartedAt,
      sessionEndedAt: new Date().toISOString(),
      interactions: Array.from(this.interactions.values(), interaction => ({ ...interaction }))
    };
  }

  toJSON() {
    return JSON.stringify(this.getExportSnapshot(), null, 2);
  }

  toMarkdown() {
    const snapshot = this.getExportSnapshot();
    const lines = [
      '# OpenCluely Session Transcript',
      '',
      `Session start: ${snapshot.sessionStartedAt}`,
      `Session end: ${snapshot.sessionEndedAt}`
    ];
    snapshot.interactions.forEach((interaction, index) => {
      lines.push('', `## Interaction ${index + 1} — ${interaction.timestamp}`, '');
      if (interaction.inputType === 'speech') {
        lines.push('Recognized transcript:', '', interaction.rawTranscription || '', '');
        lines.push('Final transcript sent to Gemini:', '', interaction.finalTranscription || '', '');
      }
      lines.push('USER:', '', interaction.exactQuestion, '', 'AI:', '', interaction.response || '', '', 'Metrics:', '');
      lines.push(`- input type: ${interaction.inputType}`);
      lines.push(`- response mode: ${interaction.responseMode || 'n/a'}`);
      lines.push(`- response depth: ${interaction.responseDepth || 'n/a'}`);
      lines.push(`- follow-up used: ${interaction.followUpUsed}`);
      lines.push(`- retrieval ms: ${interaction.retrievalMs ?? 'n/a'}`);
      lines.push(`- retrieved chunks: ${interaction.retrievedChunkCount}`);
      lines.push(`- retrieved documents: ${interaction.retrievedDocumentCount}`);
      lines.push(`- time to first chunk ms: ${interaction.llmTimeToFirstChunkMs ?? 'n/a'}`);
      lines.push(`- question to first chunk ms: ${interaction.questionToFirstChunkMs ?? 'n/a'}`);
      lines.push(`- AI Response render delay ms: ${interaction.aiResponseRenderDelayMs ?? 'n/a'}`);
      lines.push(`- Chat render delay ms: ${interaction.chatRenderDelayMs ?? 'n/a'}`);
      lines.push(`- question to AI Response render ms: ${interaction.questionToAiResponseRenderMs ?? 'n/a'}`);
      lines.push(`- total response ms: ${interaction.totalResponseMs ?? 'n/a'}`);
    });
    return `${lines.join('\n')}\n`;
  }

  getExportSnapshot() {
    const snapshot = this.getSnapshot();
    snapshot.interactions = snapshot.interactions.map(interaction => ({
      ...interaction,
      rawTranscription: this.sanitizeExportText(interaction.rawTranscription),
      finalTranscription: this.sanitizeExportText(interaction.finalTranscription),
      exactQuestion: this.sanitizeExportText(interaction.exactQuestion),
      response: this.sanitizeExportText(interaction.response)
    }));
    return snapshot;
  }

  sanitizeExportText(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/https?:\/\/[^\s<>()]+/gi, rawUrl => {
      try {
        const parsed = new URL(rawUrl);
        if (!parsed.search && !parsed.hash) return rawUrl;
        return `${parsed.origin}${parsed.pathname}[query omitted]`;
      } catch (_) {
        return rawUrl;
      }
    });
  }
}

module.exports = new SessionTelemetryManager();
