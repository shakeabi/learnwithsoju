<script lang="ts">
  import { settings, setSetting } from '$lib/storage.svelte';

  let statusText = $state('');
  let statusKind = $state<'' | 'ok' | 'err'>('');
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(text: string, kind: '' | 'ok' | 'err' = '') {
    statusText = text;
    statusKind = kind;
    if (statusTimer) clearTimeout(statusTimer);
    if (text && kind) {
      statusTimer = setTimeout(() => {
        if (statusText === text) {
          statusText = '';
          statusKind = '';
        }
      }, 4000);
    }
  }

  // The Save button persists both keys atomically. The KRDict key is the
  // hot path (every lookup), so we surface success/error inline rather than
  // saving on every keystroke.
  async function save() {
    try {
      await setSetting('krdictApiKey', settings.value.krdictApiKey.trim());
      await setSetting('opendictApiKey', settings.value.opendictApiKey.trim());
      setStatus('Saved.', 'ok');
    } catch (err) {
      console.warn('[lws] options ApiKeySection: save failed', err);
      setStatus(`Save failed: ${(err as Error).message || err}`, 'err');
    }
  }

  // Live test against the KRDict API — same query options.js used previously.
  async function testKrdict() {
    const key = settings.value.krdictApiKey.trim();
    if (!key) {
      setStatus('Enter a KRDict key first.', 'err');
      return;
    }
    setStatus('Testing…', '');
    try {
      const url = new URL('https://krdict.korean.go.kr/api/search');
      url.searchParams.set('key', key);
      url.searchParams.set('q', '사람');
      url.searchParams.set('part', 'word');
      url.searchParams.set('translated', 'y');
      url.searchParams.set('trans_lang', '1');
      // KRDict requires num >= 10; sending 1 gets an "invalid num" error.
      url.searchParams.set('num', '10');
      const res = await fetch(url.toString());
      const text = await res.text();
      if (/<error[\s>]/i.test(text)) {
        const codeMatch = text.match(/<error_code>(.*?)<\/error_code>/);
        const msgMatch = text.match(/<message>(.*?)<\/message>/);
        setStatus(`Error ${codeMatch ? codeMatch[1] : '?'}: ${msgMatch ? msgMatch[1] : 'unknown'}`, 'err');
        return;
      }
      if (/<item[\s>]/i.test(text)) {
        setStatus('Key works ✓', 'ok');
      } else {
        setStatus('Got a response but no items — key may still be valid.', 'ok');
      }
    } catch (err) {
      setStatus(`Network error: ${(err as Error).message || err}`, 'err');
    }
  }
</script>

<section class="card">
  <h2>API keys</h2>
  <p class="hint">
    Both APIs are free. The same NIKL account can register both.
    Keys are stored locally in <code>chrome.storage.sync</code> and never sent anywhere except the dictionary servers themselves.
  </p>

  <label class="field">
    <span class="label">KRDict API key <span class="required">required</span></span>
    <input
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="Paste your KRDict key"
      bind:value={settings.value.krdictApiKey}
    />
    <a class="field-link" href="https://krdict.korean.go.kr/eng/openApi/openApiRegister" target="_blank" rel="noreferrer">
      Get a key →
    </a>
  </label>

  <label class="field">
    <span class="label">
      OpenDict API key
      <span class="optional">optional</span>
      <span class="experimental" title="OpenDict integration is experimental — coverage and quality may vary.">experimental</span>
    </span>
    <input
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="Paste your OpenDict key (used as fallback when KRDict has no entry)"
      bind:value={settings.value.opendictApiKey}
    />
    <a class="field-link" href="https://opendict.korean.go.kr/service/openApiRegister" target="_blank" rel="noreferrer">
      Get a key →
    </a>
    <p class="field-note">
      ⚠ OpenDict registration may require a Korean phone number for SMS verification.
      Used only when KRDict returns no result; community-edited dictionary, so quality varies.
    </p>
  </label>

  <div class="actions">
    <button type="button" class="primary" onclick={save}>Save</button>
    <button type="button" onclick={testKrdict}>Test KRDict key</button>
    <span class="status {statusKind}" aria-live="polite">{statusText}</span>
  </div>
</section>
