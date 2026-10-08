// Runs in the AudioWorklet global scope (no DOM, no imports from app code).
// Resamples the mic's native sample rate down to the target rate (16kHz),
// converts Float32 samples to Int16 PCM, and posts fixed-size chunks back
// to the main thread for sending to the Live API.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetSampleRate, chunkMs } = options.processorOptions;
    this.ratio = sampleRate / targetSampleRate; // `sampleRate` is a global in this scope
    this.position = 0;
    this.inputBuffer = [];
    this.outChunk = [];
    this.samplesPerChunk = Math.round(targetSampleRate * (chunkMs / 1000));
  }

  process(inputs) {
    const channelData = inputs[0] && inputs[0][0];
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i++) {
      this.inputBuffer.push(channelData[i]);
    }

    while (true) {
      const i0 = Math.floor(this.position);
      const i1 = i0 + 1;
      if (i1 >= this.inputBuffer.length) break;

      const frac = this.position - i0;
      const sample = this.inputBuffer[i0] * (1 - frac) + this.inputBuffer[i1] * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.outChunk.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      this.position += this.ratio;

      if (this.outChunk.length >= this.samplesPerChunk) {
        this._flush();
      }
    }

    const consumedUpTo = Math.floor(this.position);
    if (consumedUpTo > 0) {
      this.inputBuffer.splice(0, consumedUpTo);
      this.position -= consumedUpTo;
    }

    return true;
  }

  _flush() {
    const int16 = new Int16Array(this.outChunk);
    this.outChunk = [];
    this.port.postMessage(int16.buffer, [int16.buffer]);
  }
}

registerProcessor('pcm-processor', PCMProcessor);
