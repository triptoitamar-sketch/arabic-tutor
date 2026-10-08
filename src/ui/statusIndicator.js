const LABELS = {
  connecting: 'Connecting…',
  listening: 'Listening…',
  speaking: 'Gemini is speaking…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Connection lost — tap End Lesson',
};

export function setStatus(state) {
  const indicator = document.getElementById('status-indicator');
  const label = document.getElementById('status-label');
  indicator.dataset.state = state;
  label.textContent = LABELS[state] || state;
}
