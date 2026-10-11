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

export function showDebugPanel() {
  document.getElementById('debug-panel')?.classList.remove('hidden');
}

export function hideDebugPanel() {
  document.getElementById('debug-panel')?.classList.add('hidden');
}

/** Wires the "Copy" button once at startup. */
export function initDebugPanel() {
  const button = document.getElementById('btn-copy-log');
  if (!button) return;
  button.addEventListener('click', async () => {
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      flashButton(button, 'Copied!');
    } catch {
      // Clipboard API unavailable/denied (common over plain http, some mobile
      // browsers) — fall back to selecting the text so the user can copy manually.
      const el = document.getElementById('debug-log');
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      flashButton(button, 'Selected — Ctrl/Cmd+C');
    }
  });
}

function flashButton(button, text) {
  const original = button.dataset.originalText || button.textContent;
  button.dataset.originalText = original;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}
