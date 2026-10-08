import { OUTPUT_SAMPLE_RATE } from '../config/constants.js';

/**
 * Gapless playback queue for 24kHz PCM16 base64 chunks streamed from the
 * Live API. Schedules buffers back-to-back against a running cursor rather
 * than firing each one immediately on arrival, to avoid clicks/gaps.
 */
export class AudioPlaybackQueue {
  constructor({ onStart, onDrain } = {}) {
    this.audioContext = new AudioContext();
    this.nextStartTime = 0;
    this.activeSources = new Set();
    this.onStart = onStart;
    this.onDrain = onDrain;
  }

  enqueue(base64Pcm) {
    const float32 = decodeBase64Pcm16(base64Pcm);
    const audioBuffer = this.audioContext.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const startTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;

    const wasEmpty = this.activeSources.size === 0;
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0 && this.onDrain) this.onDrain();
    };
    if (wasEmpty && this.onStart) this.onStart();
  }

  /** Stops all scheduled/playing audio immediately — call on barge-in (interrupted). */
  clear() {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // already stopped/ended — fine to ignore
      }
    }
    this.activeSources.clear();
    this.nextStartTime = this.audioContext.currentTime;
  }

  close() {
    this.clear();
    this.audioContext.close();
  }
}

function decodeBase64Pcm16(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;
  return float32;
}
