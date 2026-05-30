const input = document.getElementById('inspector-input');
const results = document.getElementById('inspector-results');

let debounceTimer = null;
let retryTimer = null;

function showPlaceholder(text) {
  results.innerHTML = '';
  const sec = document.createElement('section');
  sec.className = 'inspector-section';
  const p = document.createElement('p');
  p.className = 'inspector-placeholder';
  p.textContent = text;
  sec.appendChild(p);
  results.appendChild(sec);
}

function showError(text) {
  results.innerHTML = '';
  const sec = document.createElement('section');
  sec.className = 'inspector-section';
  const p = document.createElement('p');
  p.className = 'inspector-error';
  p.textContent = text;
  sec.appendChild(p);
  results.appendChild(sec);
}

function buildTokenTable(tokens) {
  const table = document.createElement('table');
  table.className = 'token-table';
  const head = table.createTHead();
  const hr = head.insertRow();
  for (const col of ['Surface', 'POS', 'Type', 'First pos', 'Last pos', 'Decomp', 'Reading', 'Full features']) {
    const th = document.createElement('th');
    th.textContent = col;
    hr.appendChild(th);
  }
  const body = table.createTBody();
  for (const tok of tokens) {
    const row = body.insertRow();
    const addTd = (text, cls) => {
      const td = row.insertCell();
      if (cls) td.className = cls;
      td.textContent = text || '';
      return td;
    };
    addTd(tok.surface, 'col-surface');
    addTd(tok.pos);
    addTd(tok.type);
    addTd(tok.firstPos);
    addTd(tok.lastPos);
    addTd(tok.decomp, 'col-decomp');
    addTd(tok.reading);
    const featuresTd = addTd(tok.features, 'col-features');
    if (tok.features) featuresTd.title = tok.features;
  }
  return table;
}

function renderResults(data) {
  results.innerHTML = '';

  const { singlePath, nbestPaths, candidates } = data;

  // Section 1 — single best path
  const sec1 = document.createElement('section');
  sec1.className = 'inspector-section';
  const h1 = document.createElement('h2');
  h1.textContent = 'Single best path';
  sec1.appendChild(h1);
  if (singlePath.length === 0) {
    const p = document.createElement('p');
    p.className = 'inspector-placeholder';
    p.textContent = 'No tokens.';
    sec1.appendChild(p);
  } else {
    sec1.appendChild(buildTokenTable(singlePath));
  }
  results.appendChild(sec1);

  // Section 2 — n-best paths
  const sec2 = document.createElement('section');
  sec2.className = 'inspector-section';
  const h2 = document.createElement('h2');
  h2.textContent = `N-best paths (${nbestPaths.length})`;
  sec2.appendChild(h2);
  if (nbestPaths.length === 0) {
    const p = document.createElement('p');
    p.className = 'inspector-placeholder';
    p.textContent = 'No paths.';
    sec2.appendChild(p);
  } else {
    for (let i = 0; i < nbestPaths.length; i++) {
      const path = nbestPaths[i];
      const details = document.createElement('details');
      details.className = 'path-card';
      if (i === 0) details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = `Path #${i}  (cost=${path.cost})`;
      details.appendChild(summary);
      const body = document.createElement('div');
      body.className = 'path-body';
      body.appendChild(buildTokenTable(path.tokens));
      details.appendChild(body);
      sec2.appendChild(details);
    }
  }
  results.appendChild(sec2);

  // Section 3 — lemma candidates
  const sec3 = document.createElement('section');
  sec3.className = 'inspector-section';
  const h3 = document.createElement('h2');
  h3.textContent = 'Lemma candidates';
  sec3.appendChild(h3);
  if (candidates.length === 0) {
    const p = document.createElement('p');
    p.className = 'inspector-placeholder';
    p.textContent = 'No candidates.';
    sec3.appendChild(p);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'candidates-list';
    for (const cand of candidates) {
      const li = document.createElement('li');
      li.className = 'candidate-chip';
      li.textContent = cand;
      ul.appendChild(li);
    }
    sec3.appendChild(ul);
  }
  results.appendChild(sec3);
}

function analyze(text) {
  clearTimeout(retryTimer);
  if (!text.trim()) {
    showPlaceholder('Enter Korean text to analyze.');
    return;
  }
  showPlaceholder('Initializing mecab…');

  chrome.runtime.sendMessage({ type: 'mecab-inspect', text, nbest: 5 }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[lws] mecab-inspect send failed:', chrome.runtime.lastError.message);
      showError(`Failed to analyze: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (!response) {
      console.warn('[lws] mecab-inspect: empty response');
      showError('Failed to analyze: no response from background');
      return;
    }
    if (response.error) {
      if (response.error === 'NOT_READY') {
        retryTimer = setTimeout(() => analyze(input.value), 500);
        return;
      }
      console.warn('[lws] mecab-inspect error:', response.error);
      showError(`Failed to analyze: ${response.error}`);
      return;
    }
    renderResults(response);
  });
}

if (input) {
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => analyze(input.value), 200);
  });
  input.focus();
  showPlaceholder('Enter Korean text to analyze.');
}
