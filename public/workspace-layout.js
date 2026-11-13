/* Optional distraction-free workspace. Never changes accounts, permissions or data. */
window.toggleWorkspaceMode = function toggleWorkspaceMode() {
  const app = document.getElementById('app');
  const button = document.getElementById('workspaceModeButton');
  if (!app || !button) return;
  const expanded = app.classList.toggle('focus-mode');
  button.setAttribute('aria-pressed', String(expanded));
  button.setAttribute('aria-label', expanded ? 'Mostrar menú del panel' : 'Expandir espacio de trabajo');
  button.textContent = expanded ? '⤡ Mostrar menú' : '⤢ Expandir';
};
