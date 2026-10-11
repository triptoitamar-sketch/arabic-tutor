import './style.css';
import { hasApiKey, getApiKey, setApiKey } from './storage/apiKeyStore.js';
import { getLatestSummary, saveSummary, isFirebaseConfigured } from './persistence/lessonStore.js';
import { buildSystemInstruction } from './tutor/systemPrompt.js';
import { LiveTutorSession } from './live/liveSession.js';
import { setStatus } from './ui/statusIndicator.js';
import { logDebug, clearDebugLog, showDebugPanel, hideDebugPanel, initDebugPanel } from './ui/debugLog.js';
import * as screens from './ui/screens.js';

function setMicLevel(level) {
  const fill = document.getElementById('mic-meter-fill');
  if (fill) fill.style.width = `${Math.min(100, Math.round(level * 400))}%`;
}

let activeSession = null;
let wakeLock = null;

function refreshIdleScreen() {
  const ready = hasApiKey();
  screens.setStartEnabled(ready);
  screens.setIdleHint(ready ? 'Ready when you are.' : 'Add your Gemini API key in Settings to begin.');
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('Wake lock unavailable:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

async function startLesson() {
  screens.setStartEnabled(false);
  clearDebugLog();
  showDebugPanel(); // visible immediately, before the connection even opens
  screens.showLesson();
  const apiKey = getApiKey();
  try {
    if (!isFirebaseConfigured()) {
      logDebug(
        '⚠️ Firebase is NOT configured yet (src/config/firebaseConfig.js still has REPLACE_ME placeholders). ' +
          'Lesson summaries cannot be saved or loaded until you set up a real Firebase project — see the README\'s ' +
          '"Firebase project" section. The lesson itself will still work.',
      );
    }
    logDebug('Fetching previous lesson summary from Firestore…');
    const lastSummary = await getLatestSummary();
    logDebug(lastSummary ? `Found previous summary: "${lastSummary.slice(0, 100)}"` : 'No previous summary (first lesson, or Firestore read failed/not configured yet).');
    const systemInstruction = buildSystemInstruction(lastSummary);

    activeSession = new LiveTutorSession({
      apiKey,
      systemInstruction,
      onStatusChange: setStatus,
      onDebug: logDebug,
      onMicLevel: setMicLevel,
    });

    // Must be awaited from within this click-handler call stack so the mic
    // permission prompt is tied to the user's tap.
    await activeSession.start();
    await requestWakeLock();
  } catch (err) {
    console.error('Failed to start lesson:', err);
    logDebug(`❌ Failed to start: ${err.message}`);
    alert('Could not start the lesson — check the debug log on screen for details.');
    activeSession = null;
    refreshIdleScreen();
    screens.showIdle();
  }
}

async function endLesson() {
  if (!activeSession) return;
  const endButton = document.getElementById('btn-end');
  endButton.disabled = true;

  const summary = await activeSession.endLesson();
  const summaryText = summary || 'Lesson ended; no summary was captured.';
  if (!isFirebaseConfigured()) {
    logDebug('⚠️ Not saving — Firebase still not configured (see warning above / README).');
  } else {
    logDebug('Saving summary to Firestore…');
  }
  const saved = await saveSummary(summaryText);
  logDebug(saved ? 'Summary saved.' : '⚠️ Summary save failed (see console for details).');

  activeSession.teardown();
  activeSession = null;
  releaseWakeLock();

  endButton.disabled = false;
  screens.showEnded({ summary: summaryText, saved });
}

function initSettings() {
  const input = document.getElementById('api-key-input');

  document.getElementById('btn-settings').addEventListener('click', () => {
    input.value = getApiKey() || '';
    screens.openSettings();
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    screens.closeSettings();
  });

  document.getElementById('btn-save-key').addEventListener('click', () => {
    const value = input.value.trim();
    if (value) {
      setApiKey(value);
      refreshIdleScreen();
      screens.closeSettings();
    }
  });
}

function init() {
  initSettings();
  initDebugPanel();
  refreshIdleScreen();
  screens.showIdle();

  document.getElementById('btn-start').addEventListener('click', startLesson);
  document.getElementById('btn-end').addEventListener('click', endLesson);
  document.getElementById('btn-restart').addEventListener('click', () => {
    hideDebugPanel();
    refreshIdleScreen();
    screens.showIdle();
  });
}

init();
