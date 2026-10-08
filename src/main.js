import './style.css';
import { hasApiKey, getApiKey, setApiKey } from './storage/apiKeyStore.js';
import { getLatestSummary, saveSummary } from './persistence/lessonStore.js';
import { buildSystemInstruction } from './tutor/systemPrompt.js';
import { LiveTutorSession } from './live/liveSession.js';
import { setStatus } from './ui/statusIndicator.js';
import * as screens from './ui/screens.js';

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
  const apiKey = getApiKey();
  try {
    const lastSummary = await getLatestSummary();
    const systemInstruction = buildSystemInstruction(lastSummary);

    activeSession = new LiveTutorSession({
      apiKey,
      systemInstruction,
      onStatusChange: setStatus,
    });

    // Must be awaited from within this click-handler call stack so the mic
    // permission prompt is tied to the user's tap.
    await activeSession.start();
    await requestWakeLock();
    screens.showLesson();
    setStatus('listening');
  } catch (err) {
    console.error('Failed to start lesson:', err);
    alert('Could not start the lesson — check microphone permission and your API key, then try again.');
    activeSession = null;
    refreshIdleScreen();
  }
}

async function endLesson() {
  if (!activeSession) return;
  const endButton = document.getElementById('btn-end');
  endButton.disabled = true;

  const summary = await activeSession.endLesson();
  const summaryText = summary || 'Lesson ended; no summary was captured.';
  const saved = await saveSummary(summaryText);

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
  refreshIdleScreen();
  screens.showIdle();

  document.getElementById('btn-start').addEventListener('click', startLesson);
  document.getElementById('btn-end').addEventListener('click', endLesson);
  document.getElementById('btn-restart').addEventListener('click', () => {
    refreshIdleScreen();
    screens.showIdle();
  });
}

init();
