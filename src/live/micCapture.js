import { INPUT_SAMPLE_RATE, MIC_CHUNK_MS } from '../config/constants.js';

const MIC_CONSTRAINTS = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const BLUETOOTH_LABEL_RE = /bluetooth|hands[\s-]?free|hfp|headset/i;

/**
 * Picks a mic stream, preferring the phone's own built-in microphone over a
 * connected Bluetooth one (e.g. a car's hands-free mic). On Android, Chrome
 * puts the OS audio into "voice call" mode whenever it captures from a
 * Bluetooth mic, which switches Bluetooth from the normal media link (A2DP)
 * to the low-quality call link (SCO) — and many car head units don't play
 * the tutor's audio back over SCO, so it silently falls back to the phone's
 * own speaker instead of the car's speakers. We don't need the car's mic —
 * the phone's own mic hears the driver fine — so avoiding it keeps Bluetooth
 * on the normal media link for audio playback.
 */
async function getPreferredMicStream(onDebug) {
  const defaultStream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
  const defaultLabel = defaultStream.getAudioTracks()[0]?.label || '';

  if (!BLUETOOTH_LABEL_RE.test(defaultLabel)) return defaultStream;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const builtIn = devices.find(
      (d) => d.kind === 'audioinput' && d.label && !BLUETOOTH_LABEL_RE.test(d.label),
    );
    if (!builtIn) return defaultStream;

    onDebug?.(
      `Default mic ("${defaultLabel}") looks like a Bluetooth device — switching to the phone's built-in mic ` +
        '("' + builtIn.label + '") so Bluetooth audio playback keeps working in the car.',
    );
    defaultStream.getTracks().forEach((track) => track.stop());
    return navigator.mediaDevices.getUserMedia({
      audio: { ...MIC_CONSTRAINTS, deviceId: { exact: builtIn.deviceId } },
    });
  } catch (err) {
    onDebug?.(`Could not switch away from the Bluetooth mic, using default: ${err.message}`);
    return defaultStream;
  }
}

/**
 * Requests mic access, streams 16kHz PCM16 chunks (base64) to onChunk, and
 * reports a rough 0..1 input level per chunk to onLevel (for a mic-activity
 * meter — confirms the mic is actually picking up sound).
 * Call the returned stop() function to release the mic and audio context.
 * Must be called from within a user-gesture handler (e.g. a button click)
 * so the permission prompt is tied to that gesture.
 */
export async function startMicCapture({ onChunk, onLevel, onDebug }) {
  const stream = await getPreferredMicStream(onDebug);

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
