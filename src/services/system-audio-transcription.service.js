const { EventEmitter } = require('events');
const logger = require('../core/logger').createServiceLogger('SYSTEM-SPEECH');

class SystemAudioTranscriptionService extends EventEmitter {
  constructor(speechService) {
    super();
    this.speechService = speechService;
    this.active = false;
    this.generation = 0;
    this.watchdog = null;
    this._resetSegment();
  }

  startSession() {
    this.stopSession();
    this.active = true;
    this.generation += 1;
    this._resetSegment();
    this.watchdog = setInterval(() => {
      if (!this.active || !this.vadSpeaking || !this.vadLastChunkAt) return;
      const settings = this.speechService.getWhisperVadSettings();
      const stalled = Date.now() - this.vadLastChunkAt > 1500;
      const tooLong = this.vadSpeechMs >= settings.maxUtteranceMs;
      if (stalled || tooLong) this._flushSegment();
    }, 500);
  }

  stopSession() {
    this.active = false;
    this.generation += 1;
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    // A stopped capture discards its partial segment. Already queued Whisper
    // work may finish, but the generation check prevents stale delivery.
    this._resetSegment();
  }

  handlePcmChunk(chunk) {
    if (!this.active || !chunk || !chunk.length) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.length < 2) return;

    const settings = this.speechService.getWhisperVadSettings();
    const chunkMs = buffer.length / 32;
    const energy = this._chunkRmsEnergy(buffer);
    this.vadLastChunkAt = Date.now();

    if (!this.vadNoiseInit) {
      this.vadNoiseFloor = Math.min(energy, settings.energyFloor);
      this.vadNoiseInit = true;
    }
    const enterThreshold = Math.max(settings.energyFloor, this.vadNoiseFloor * 2.5);
    const exitThreshold = Math.max(settings.energyFloor * 0.7, this.vadNoiseFloor * 1.6);
    const isVoiced = this.vadSpeaking ? energy >= exitThreshold : energy >= enterThreshold;

    if (!this.vadSpeaking) {
      if (isVoiced) {
        this.vadSpeaking = true;
        this.vadSpeechMs = chunkMs;
        this.vadSilenceMs = 0;
        for (const pre of this.vadPreRoll) this._append(pre);
        this.vadPreRoll = [];
        this.vadPreRollMs = 0;
        this._append(buffer);
      } else {
        this.vadNoiseFloor = this.vadNoiseFloor * 0.95 + energy * 0.05;
        this.vadPreRoll.push(buffer);
        this.vadPreRollMs += chunkMs;
        while (this.vadPreRollMs > settings.preRollMs && this.vadPreRoll.length > 1) {
          const dropped = this.vadPreRoll.shift();
          this.vadPreRollMs -= dropped.length / 32;
        }
      }
      return;
    }

    this._append(buffer);
    if (isVoiced) {
      this.vadSpeechMs += chunkMs;
      this.vadSilenceMs = 0;
    } else {
      this.vadSilenceMs += chunkMs;
    }

    const paused = this.vadSilenceMs >= settings.silenceHangoverMs;
    const haveSpeech = this.vadSpeechMs >= settings.minUtteranceMs;
    const tooLong = this.vadSpeechMs >= settings.maxUtteranceMs;
    if ((paused && haveSpeech) || tooLong) {
      this._flushSegment();
    } else if (paused) {
      this._resetUtterance();
    }
  }

  _append(buffer) {
    this.segmentBuffers.push(buffer);
    this.segmentBytes += buffer.length;
  }

  _flushSegment() {
    if (!this.segmentBytes) {
      this._resetUtterance();
      return;
    }
    const pcm = Buffer.concat(this.segmentBuffers, this.segmentBytes);
    const segmentDurationMs = Math.round(pcm.length / 32);
    const generation = this.generation;
    this._resetUtterance();

    this.speechService.transcribePcmBuffer(pcm, { source: 'speaker' })
      .then(({ text, processingTime }) => {
        if (!this.active || generation !== this.generation || !text) return;
        logger.info('Finalized audio transcription', {
          source: 'speaker',
          textPreview: text.substring(0, 100),
          segmentDurationMs,
          processingTime
        });
        this.emit('transcription', { text, source: 'speaker' });
      })
      .catch((error) => {
        logger.warn('Speaker transcription failed; microphone remains available', {
          error: error.message,
          segmentDurationMs
        });
      });
  }

  _resetSegment() {
    this._resetUtterance();
    this.vadNoiseFloor = 0;
    this.vadNoiseInit = false;
    this.vadLastChunkAt = 0;
  }

  _resetUtterance() {
    this.segmentBuffers = [];
    this.segmentBytes = 0;
    this.vadSpeaking = false;
    this.vadSpeechMs = 0;
    this.vadSilenceMs = 0;
    this.vadPreRoll = [];
    this.vadPreRollMs = 0;
  }

  _chunkRmsEnergy(buffer) {
    const sampleCount = Math.floor(buffer.length / 2);
    if (!sampleCount) return 0;
    let sumSquares = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = buffer.readInt16LE(index * 2) / 32768;
      sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / sampleCount);
  }
}

module.exports = SystemAudioTranscriptionService;
