import { INPUT_SAMPLE_RATE, MIC_CHUNK_MS } from '../config/constants.js';

/**
 * Requests mic access, streams 16kHz PCM16 chunks (base64) to onChunk, and
 * reports a rough 0..1 input level per chunk to onLevel (for a mic-activity
 * meter — confirms the mic is actually picking up sound).
 * Call the returned stop() function to release the mic and audio context.
 * Must be called from within a user-gesture handler (e.g. a button click)
 * so the permission prompt is tied to that gesture.
 */
export async function startMicCapture({ onChunk, onLevel }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule(new URL('./pcm-processor.worklet.js', import.meta.url));

  const source = audioContext.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
    processorOptions: { targetSampleRate: INPUT_SAMPLE_RATE, chunkMs: MIC_CHUNK_MS },
  });

  workletNode.port.onmessage = (event) => {
    const int16 = new Int16Array(event.data);
    if (onLevel) onLevel(computeRmsLevel(int16));
    onChunk(arrayBufferToBase64(event.data));
  };

  // Connect mic -> worklet only; never connect to destination (don't echo the mic to speakers).
  source.connect(workletNode);

  return function stop() {
    workletNode.port.onmessage = null;
    source.disconnect();
    workletNode.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close();
  };
}

function computeRmsLevel(int16Array) {
  if (int16Array.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < int16Array.length; i++) {
    const normalized = int16Array[i] / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / int16Array.length);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
