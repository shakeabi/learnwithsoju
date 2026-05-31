<script lang="ts">
  // Per-site disable lives in chrome.storage.local — sync is throttled
  // (write-quota, eventual-consistency w/ the cloud) and was dropping
  // per-site writes. Local is per-device, which matches the semantics:
  // "for this browser, on this site, leave me alone."
  const DISABLED_HOSTS_KEY = 'disabledHosts';

  let { host }: { host: string } = $props();
  let enabled = $state(true);

  // Hydrate from chrome.storage.local on mount, plus subscribe to changes.
  $effect(() => {
    if (!host) return;
    (async () => {
      try {
        const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
        applyFromList(data[DISABLED_HOSTS_KEY]);
      } catch (err) {
        console.warn('[lws] popup SiteToggleRow: hydrate failed', err);
      }
    })();

    const listener = (changes: any, area: string) => {
      if (area !== 'local') return;
      if (!(DISABLED_HOSTS_KEY in changes)) return;
      applyFromList(changes[DISABLED_HOSTS_KEY].newValue);
    };
    try {
      chrome.storage.onChanged.addListener(listener);
    } catch { /* ignore */ }

    return () => {
      try { chrome.storage.onChanged.removeListener(listener); } catch { /* ignore */ }
    };
  });

  function applyFromList(list: unknown) {
    const arr = Array.isArray(list) ? (list as string[]) : [];
    enabled = !arr.includes(host);
  }

  async function onToggle(e: Event) {
    if (!host) return;
    const wantsEnabled = (e.currentTarget as HTMLInputElement).checked;
    enabled = wantsEnabled;
    try {
      const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
      const list: string[] = Array.isArray(data[DISABLED_HOSTS_KEY]) ? data[DISABLED_HOSTS_KEY] : [];
      const set = new Set(list);
      if (wantsEnabled) set.delete(host);
      else set.add(host);
      const next = Array.from(set).sort();
      await chrome.storage.local.set({ [DISABLED_HOSTS_KEY]: next });
    } catch (err) {
      console.warn('[lws] popup SiteToggleRow: write failed', err);
    }
  }
</script>

<div class="row">
  <label class="switch">
    <input type="checkbox" autocomplete="off" checked={enabled} onchange={onToggle} />
    <span class="slider"></span>
  </label>
  <span class="row-label">Enable on <span class="site-host">{host}</span></span>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }

  .row-label {
    font-size: 13px;
  }

  .site-host {
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    word-break: break-all;
  }

  .switch {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 22px;
    flex: 0 0 auto;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    inset: 0;
    background: var(--border);
    border-radius: 999px;
    transition: 0.18s;
    cursor: pointer;
  }

  .slider::before {
    content: "";
    position: absolute;
    width: 18px;
    height: 18px;
    left: 2px;
    top: 2px;
    background: white;
    border-radius: 50%;
    transition: 0.18s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }

  .switch input:checked + .slider {
    background: var(--accent);
  }

  .switch input:checked + .slider::before {
    transform: translateX(16px);
  }
</style>
