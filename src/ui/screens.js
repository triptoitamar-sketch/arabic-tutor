const idle = document.getElementById('screen-idle');
const lesson = document.getElementById('screen-lesson');
const ended = document.getElementById('screen-ended');
const endedTitle = document.getElementById('ended-title');
const endedSummary = document.getElementById('ended-summary');

function hideAll() {
  idle.classList.add('hidden');
  lesson.classList.add('hidden');
  ended.classList.add('hidden');
}

export function showIdle() {
  hideAll();
  idle.classList.remove('hidden');
}

export function showLesson() {
  hideAll();
  lesson.classList.remove('hidden');
}

export function showEnded({ summary, saved }) {
  hideAll();
  endedTitle.textContent = saved ? 'Lesson saved' : 'Lesson ended (save may have failed)';
  endedSummary.textContent = summary || 'No summary captured for this lesson.';
  ended.classList.remove('hidden');
}

export function setIdleHint(text) {
  document.getElementById('idle-hint').textContent = text;
}

export function setStartEnabled(enabled) {
  document.getElementById('btn-start').disabled = !enabled;
}

export function openSettings() {
  document.getElementById('settings-panel').classList.remove('hidden');
}

export function closeSettings() {
  document.getElementById('settings-panel').classList.add('hidden');
}
