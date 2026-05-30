// Standalone notepad page. The user pastes Korean text into a
// textarea, hits "Add to notepad" (or Ctrl/Cmd+Enter), and the text
// lands as plain text in the target div. content.js — embedded by
// notepad.html below this script — wraps every Korean run in a
// `.lws-word` span via its mutation observer, and the regular hover
// popup machinery takes over. No persistence: paste is ephemeral.

const input = document.getElementById('notepad-input');
const target = document.getElementById('notepad-target');
const addBtn = document.getElementById('notepad-add');
const clearBtn = document.getElementById('notepad-clear');

function commit() {
  const text = input.value;
  if (!text) return;
  // textContent — content.js's mutation observer picks up the new text
  // node and wraps Korean runs in `.lws-word` spans, making them
  // hoverable. Use pre-wrap whitespace so paragraph breaks survive.
  target.textContent = text;
}

if (addBtn) addBtn.addEventListener('click', commit);

if (clearBtn) clearBtn.addEventListener('click', () => {
  input.value = '';
  target.textContent = '';
  input.focus();
});

// Ctrl/Cmd+Enter in the textarea also commits, since clicking a
// button after every paste gets old fast.
if (input) input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    commit();
  }
});

// Autofocus the textarea so the user can paste immediately on landing.
if (input) input.focus();
