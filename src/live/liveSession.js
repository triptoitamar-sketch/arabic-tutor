import { GoogleGenAI, Modality } from '@google/genai';
import { startMicCapture } from './micCapture.js';
import { AudioPlaybackQueue } from './audioPlayback.js';
import {
  NATIVE_AUDIO_MODEL_ID,
  SESSION_ENDED_TRIGGER,
  RECONNECT_BACKOFF_MS,
  SUMMARY_TIMEOUT_MS,
} from '../config/constants.js';

const NO_RESPONSE_WARNING_MS = 15000;
const MIC_LOG_INTERVAL_CHUNKS = 25; // ~5s at the default 200ms chunk size

/**
 * Orchestrates one lesson: opens the Gemini Live API session, streams mic
 * audio in, plays model audio back, and reconnects (via session resumption)
 * if the socket drops mid-drive. Call start(), then endLesson() once, then
 * teardown().
 *
 * onStatusChange receives one of: 'connecting' | 'listening' | 'speaking' | 'reconnecting' | 'disconnected' | 'error'.
 * onDebug receives human-readable lifecycle/diagnostic strings.
 * onMicLevel receives a 0..1 input level per mic chunk (for a VU-style meter).
 */
export class LiveTutorSession {
  constructor({ apiKey, systemInstruction, onStatusChange, onDebug, onMicLevel }) {
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({ apiKey });
    this.systemInstruction = systemInstruction;
    this.onStatusChange = onStatusChange || (() => {});
    this.onDebug = onDebug || (() => {});
    this.onMicLevel = onMicLevel || (() => {});

    this.session = null;
    this.playback = null;
    this.stopMic = null;

    this.resumptionHandle = undefined;
    this.reconnectAttempt = 0;
    this.manuallyClosed = false;

    this.currentOutputTranscript = '';
    this.awaitingSummary = false;
    this.pendingSummaryResolve = null;
    this.skipNextTurnComplete = false;

    this.micChunkCount = 0;
    this.serverMessageCount = 0;
    this.lastServerMessageAt = null;
    this.noResponseWarned = false;
    this.watchdogTimer = null;
  }

  async start() {
    this.manuallyClosed = false;
    const keyPreview = this.apiKey ? `${this.apiKey.slice(0, 6)}…(${this.apiKey.length} chars)` : '(none)';
    this.onDebug(`Starting lesson. Model: ${NATIVE_AUDIO_MODEL_ID}. API key: ${keyPreview}`);

    this.onStatusChange('connecting');
    await this._connect();

    this.stopMic = await startMicCapture({
      onChunk: (base64Chunk) => {
        this.micChunkCount += 1;
        if (this.micChunkCount % MIC_LOG_INTERVAL_CHUNKS === 0) {
          this.onDebug(`Sent ${this.micChunkCount} audio chunks to Gemini so far.`);
        }
        if (this.session) {
          this.session.sendRealtimeInput({
            audio: { data: base64Chunk, mimeType: 'audio/pcm;rate=16000' },
          });
        }
      },
      onLevel: (level) => this.onMicLevel(level),
      onDebug: (msg) => this.onDebug(msg),
    });

    this.onDebug('Mic capture started.');
    this._startWatchdog();
  }

  async _connect() {
    if (this.playback) this.playback.close();
    this.playback = new AudioPlaybackQueue({
      onStart: () => this.onStatusChange('speaking'),
      onDrain: () => this.onStatusChange('listening'),
    });

    this.onDebug('Opening Live API WebSocket connection…');

    this.session = await this.ai.live.connect({
      model: NATIVE_AUDIO_MODEL_ID,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: this.systemInstruction }] },
        outputAudioTranscription: {},
        sessionResumption: { handle: this.resumptionHandle },
        // Explicit (small) thresholds instead of the defaults (~80% of the
        // model's 131k-token window). The Live API re-bills the ENTIRE
        // accumulated conversation on every turn, so without this a lesson
        // under ~30 min never triggers compression and cost grows with
        // lesson length. This caps the re-billed context to a few thousand
        // tokens throughout, keeping cost roughly flat per minute.
        contextWindowCompression: { triggerTokens: '5000', slidingWindow: { targetTokens: '2500' } },
      },
      callbacks: {
        onopen: () => {
          this.reconnectAttempt = 0;
          this.onDebug('WebSocket opened — connected to Gemini.');
          this.onStatusChange('listening');
        },
        onmessage: (message) => this._handleMessage(message),
        onerror: (e) => {
          const detail = e?.message || e?.error?.message || 'unknown error';
          this.onDebug(`⚠️ WebSocket error: ${detail}`);
          this._handleDisconnect();
        },
        onclose: (e) => {
          this.onDebug(`WebSocket closed (code=${e?.code ?? '?'}, reason="${e?.reason || ''}").`);
          this._handleDisconnect();
        },
      },
    });
  }

  _handleMessage(message) {
    this.serverMessageCount += 1;
    this.lastServerMessageAt = Date.now();
    if (this.noResponseWarned) {
      this.onDebug('✅ Received a response from Gemini.');
      this.noResponseWarned = false;
    }

    const audioBase64 = message.data; // concatenated inline-data (audio) parts
    if (audioBase64) this.playback.enqueue(audioBase64);

    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        this.onDebug('Barge-in: user interrupted, clearing playback.');
        this.playback.clear();
        this.onStatusChange('listening');
        if (this.awaitingSummary) {
          // Our end-of-lesson trigger just interrupted whatever the model was
          // still saying from before. That turn's upcoming turnComplete is
          // leftover from the OLD turn, not the summary — discard it rather
          // than resolving endLesson() with the wrong (truncated) text.
          this.onDebug('End-of-lesson trigger interrupted an in-progress response — discarding it, waiting for the actual summary.');
          this.currentOutputTranscript = '';
          this.skipNextTurnComplete = true;
        }
      }
      if (content.outputTranscription?.text) {
        this.currentOutputTranscript += content.outputTranscription.text;
      }
      if (content.turnComplete) {
        if (this.skipNextTurnComplete) {
          this.skipNextTurnComplete = false;
          this.currentOutputTranscript = '';
        } else {
          const transcript = this.currentOutputTranscript.trim();
          if (transcript) {
            this.onDebug(`Model said: "${transcript.slice(0, 120)}"`);
          }
          if (this.awaitingSummary && this.pendingSummaryResolve) {
            this.pendingSummaryResolve(transcript);
            this.pendingSummaryResolve = null;
            this.awaitingSummary = false;
          }
          this.currentOutputTranscript = '';
        }
      }
    }

    if (message.sessionResumptionUpdate?.newHandle) {
      this.resumptionHandle = message.sessionResumptionUpdate.newHandle;
      this.onDebug('Session resumption handle updated.');
    }
  }

  _startWatchdog() {
    this._stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      const quietFor = this.lastServerMessageAt ? Date.now() - this.lastServerMessageAt : Date.now();
      if (quietFor > NO_RESPONSE_WARNING_MS && !this.noResponseWarned) {
        this.noResponseWarned = true;
        this.onDebug(
          `⚠️ No response from Gemini in ${Math.round(quietFor / 1000)}s. Sent ${this.micChunkCount} mic chunks, ` +
            `received ${this.serverMessageCount} server messages total. Check: model id, API key validity/quota, ` +
            'and that the mic level meter is actually moving while you talk.',
        );
      }
    }, 5000);
  }

  _stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  async _handleDisconnect() {
    if (this.manuallyClosed) return;
    if (this.reconnectAttempt >= RECONNECT_BACKOFF_MS.length) {
      this.onDebug('Giving up reconnecting after repeated failures.');
      this.onStatusChange('disconnected');
      return;
    }
    this.onStatusChange('reconnecting');
    const delay = RECONNECT_BACKOFF_MS[this.reconnectAttempt];
    this.reconnectAttempt += 1;
    this.onDebug(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt}/${RECONNECT_BACKOFF_MS.length})…`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.manuallyClosed) return;
    try {
      await this._connect();
    } catch (err) {
      this.onDebug(`Reconnect attempt failed: ${err.message}`);
      this._handleDisconnect();
    }
  }

  /** Sends the "session ended" trigger and resolves with the model's one-sentence summary (or '' on timeout). */
  async endLesson() {
    if (!this.session) return '';
    this.onStatusChange('ending');

    // Stop sending mic audio first — if voice-activity-detection picks up
    // anything (your voice, road noise) while we're waiting for the
    // summary, it would interrupt that generation too and truncate it.
    if (this.stopMic) {
      this.stopMic();
      this.stopMic = null;
      this.onDebug('Mic stopped before requesting the lesson summary.');
    }

    // Explicitly close out the realtime audio stream. Without this, the
    // server's automatic voice-activity-detection can be left thinking the
    // user might still be mid-utterance (it was never told the stream
    // ended, just that packets stopped arriving), which can stall
    // processing of the text trigger sent right after.
    try {
      this.session.sendRealtimeInput({ audioStreamEnd: true });
      this.onDebug('Signaled end of audio stream.');
    } catch (err) {
      this.onDebug(`Could not signal audioStreamEnd: ${err.message}`);
    }

    this.onDebug('Sending end-of-lesson trigger…');
    this.currentOutputTranscript = '';
    this.awaitingSummary = true;
    const serverMessagesBeforeTrigger = this.serverMessageCount;

    const summaryPromise = new Promise((resolve) => {
      this.pendingSummaryResolve = resolve;
    });

    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: SESSION_ENDED_TRIGGER }] }],
      turnComplete: true,
    });

    const startedAt = Date.now();
    const ticker = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const receivedSince = this.serverMessageCount - serverMessagesBeforeTrigger;
      this.onDebug(`Still waiting for the summary… (${elapsed}s elapsed, ${receivedSince} server messages received since the trigger)`);
    }, 5000);

    const timeout = new Promise((resolve) =>
      setTimeout(() => {
        this.onDebug(`⚠️ Timed out after ${SUMMARY_TIMEOUT_MS / 1000}s waiting for the lesson summary.`);
        resolve('');
      }, SUMMARY_TIMEOUT_MS),
    );
    const result = await Promise.race([summaryPromise, timeout]);
    clearInterval(ticker);
    return result;
  }

  teardown() {
    this.manuallyClosed = true;
    this._stopWatchdog();
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
    this.onDebug('Session torn down.');
  }
}
