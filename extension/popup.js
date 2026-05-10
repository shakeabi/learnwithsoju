const KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  ENABLED: 'enabled',
};

const enabledToggle = document.getElementById('enabled-toggle');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const openOptionsBtn = document.getElementById('open-options');

async function load() {
  const data = await chrome.storage.sync.get([KEYS.KRDICT_KEY, KEYS.ENABLED]);
  enabledToggle.checked = data[KEYS.ENABLED] !== false;

  if (!data[KEYS.KRDICT_KEY]) {
    statusDot.className = 'dot warn';
    statusText.textContent = 'API key not set';
  } else if (data[KEYS.ENABLED] === false) {
    statusDot.className = 'dot';
    statusText.textContent = 'Disabled';
  } else {
    statusDot.className = 'dot ok';
    statusText.textContent = 'Active';
  }
}

enabledToggle.addEventListener('change', async () => {
  await chrome.storage.sync.set({ [KEYS.ENABLED]: enabledToggle.checked });
  load();
});

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

load();
