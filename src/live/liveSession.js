import { GoogleGenAI, Modality } from '@google/genai';
import { startMicCapture } from './micCapture.js';
import { AudioPlaybackQueue } from './audioPlayback.js';
import {
  NATIVE_AUDIO_MODEL_ID,
  SESSION_ENDED_TRIGGER,
  RECONNECT_BACKOFF_MS,
  SUMMARY_TIMEOUT_MS,
} from '../config/constants.js';

/**
 * Orchestrates one lesson: opens the Gemini Live API session, streams mic
 * audio in, plays model audio back, and reconnects (via session resumption)
 * if the socket drops mid-drive. Call start(), then endLesson() once, then
 * teardown().
 *
 * onStatusChange receives one of: 'listening' | 'speaking' | 'reconnecting' | 'disconnected'.
 */
export class LiveTutorSession {
  constructor({ apiKey, systemInstruction, onStatusChange }) {
    this.ai = new GoogleGenAI({ apiKey });
    this.systemInstruction = systemInstruction;
    this.onStatusChange = onStatusChange || (() => {});

    this.session = null;
    this.playback = null;
    this.stopMic = null;

    this.resumptionHandle = undefined;
    this.reconnectAttempt = 0;
    this.manuallyClosed = false;

    this.currentOutputTranscript = '';
    this.awaitingSummary = false;
    this.pendingSummaryResolve = null;
  }

  async start() {
    this.manuallyClosed = false;
    await this._connect();
    this.stopMic = await startMicCapture((base64Chunk) => {
      if (this.session) {
        this.session.sendRealtimeInput({
          audio: { data: base64Chunk, mimeType: 'audio/pcm;rate=16000' },
        });
      }
    });
  }

  async _connect() {
    if (this.playback) this.playback.close();
    this.playback = new AudioPlaybackQueue({
      onStart: () => this.onStatusChange('speaking'),
      onDrain: () => this.onStatusChange('listening'),
    });

    this.session = await this.ai.live.connect({
      model: NATIVE_AUDIO_MODEL_ID,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: this.systemInstruction }] },
        outputAudioTranscription: {},
        sessionResumption: { handle: this.resumptionHandle },
        contextWindowCompression: { slidingWindow: {} },
      },
      callbacks: {
        onopen: () => {
          this.reconnectAttempt = 0;
          this.onStatusChange('listening');
        },
        onmessage: (message) => this._handleMessage(message),
        onerror: () => this._handleDisconnect(),
        onclose: () => this._handleDisconnect(),
      },
    });
  }

  _handleMessage(message) {
    const audioBase64 = message.data; // concatenated inline-data (audio) parts
    if (audioBase64) this.playback.enqueue(audioBase64);

    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        this.playback.clear();
        this.onStatusChange('listening');
      }
      if (content.outputTranscription?.text) {
        this.currentOutputTranscript += content.outputTranscription.text;
      }
      if (content.turnComplete) {
        if (this.awaitingSummary && this.pendingSummaryResolve) {
          this.pendingSummaryResolve(this.currentOutputTranscript.trim());
          this.pendingSummaryResolve = null;
          this.awaitingSummary = false;
        }
        this.currentOutputTranscript = '';
      }
    }

    if (message.sessionResumptionUpdate?.newHandle) {
      this.resumptionHandle = message.sessionResumptionUpdate.newHandle;
    }
  }

  async _handleDisconnect() {
    if (this.manuallyClosed) return;
    if (this.reconnectAttempt >= RECONNECT_BACKOFF_MS.length) {
      this.onStatusChange('disconnected');
      return;
    }
    this.onStatusChange('reconnecting');
    const delay = RECONNECT_BACKOFF_MS[this.reconnectAttempt];
    this.reconnectAttempt += 1;
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.manuallyClosed) return;
    try {
      await this._connect();
    } catch {
      this._handleDisconnect();
    }
  }

  /** Sends the "session ended" trigger and resolves with the model's one-sentence summary (or '' on timeout). */
  async endLesson() {
    if (!this.session) return '';
    this.currentOutputTranscript = '';
    this.awaitingSummary = true;

    const summaryPromise = new Promise((resolve) => {
      this.pendingSummaryResolve = resolve;
    });

    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: SESSION_ENDED_TRIGGER }] }],
      turnComplete: true,
    });

    const timeout = new Promise((resolve) => setTimeout(() => resolve(''), SUMMARY_TIMEOUT_MS));
    return Promise.race([summaryPromise, timeout]);
  }

  teardown() {
    this.manuallyClosed = true;
    if (this.stopMic) this.stopMic();
    if (this.session) {
      try {
        this.session.close();
      } catch {
        // already closed
      }
    }
    if (this.playback) this.playback.close();
    this.session = null;
  }
}
