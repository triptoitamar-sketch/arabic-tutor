// Verify this against https://ai.google.dev/gemini-api/docs/live before relying on it —
// Google revises native-audio model ids/preview dates periodically.
export const NATIVE_AUDIO_MODEL_ID = 'gemini-live-2.5-flash-native-audio';

export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;

// How much audio to batch into one sendRealtimeInput call.
export const MIC_CHUNK_MS = 200;

export const FIRESTORE_COLLECTION = 'lessons';
export const FIRESTORE_DOC_ID = 'latest';

export const LOCAL_STORAGE_API_KEY = 'arabicTutor.geminiApiKey';

export const SESSION_ENDED_TRIGGER = 'session ended';

// Reconnect attempts after an unexpected WebSocket close, with backoff (ms).
export const RECONNECT_BACKOFF_MS = [2000, 5000, 10000];

// How long to wait for the model's end-of-lesson summary transcript before
// giving up and saving a placeholder.
export const SUMMARY_TIMEOUT_MS = 10000;
