const MAX_LINES = 300;
let lines = [];

function render() {
  const el = document.getElementById('debug-log');
  if (!el) return;
  el.textContent = lines.join('\n');
  el.scrollTop = el.scrollHeight;
}

export function logDebug(message) {
  const time = new Date().toLocaleTimeString();
  lines.push(`[${time}] ${message}`);
  if (lines.length > MAX_LINES) lines.shift();
  render();
  console.log('[ArabicTutor]', message);
}

export function clearDebugLog() {
  lines = [];
  render();
}
