// Standalone notepad page. The user types or pastes Korean text into a
// textarea; the target div updates live (debounced 150 ms) so content.js's
// mutation observer wraps each Korean run in a `.lws-word` span and the
// hover popup machinery takes over immediately. No Add/Clear step needed.
// No persistence: the textarea is ephemeral.

const input = document.getElementById('notepad-input');
const target = document.getElementById('notepad-target');

let updateTimer = null;
if (input) {
  input.addEventListener('input', () => {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      if (target) target.textContent = input.value;
    }, 150);
  });

  // Autofocus so the user can paste immediately on landing.
  input.focus();
}
