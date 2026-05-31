<script lang="ts">
  import SiteToggleRow from './SiteToggleRow.svelte';
  import AdapterSection from './AdapterSection.svelte';
  import LinksRow from './LinksRow.svelte';
  import KofiBanner from './KofiBanner.svelte';

  type Site = { tab: any; host: string; protocol: string; href: string };

  let site = $state<Site | null>(null);
  let showSite = $state(false);

  // Resolve the active tab's hostname. Tries tab.url first (works when
  // activeTab grant is in effect); falls back to messaging the content
  // script (which always knows its own location.hostname). Returns null
  // if both sources fail (e.g. chrome:// page with no content script).
  async function resolveActiveSite(): Promise<Site | null> {
    let tab: any;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs?.[0];
    } catch (err) {
      console.log('[lws] popup resolveActiveSite: tabs.query failed', err);
      return null;
    }
    if (!tab) {
      console.log('[lws] popup resolveActiveSite: no active tab');
      return null;
    }
    if (tab.url) {
      try {
        const u = new URL(tab.url);
        return { tab, host: u.hostname.toLowerCase(), protocol: u.protocol, href: tab.url };
      } catch { /* fall through */ }
    }
    // Fallback: ask the content script directly.
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'lws-site-info' });
      if (reply && reply.host) {
        return {
          tab,
          host: String(reply.host).toLowerCase(),
          protocol: reply.protocol || 'https:',
          href: reply.href || '',
        };
      }
    } catch (err) {
      console.log('[lws] popup resolveActiveSite: content-script fallback failed', err);
    }
    return null;
  }

  $effect(() => {
    (async () => {
      const s = await resolveActiveSite();
      if (!s) return;
      if (s.protocol !== 'http:' && s.protocol !== 'https:') {
        console.log('[lws] popup: non-http(s) protocol', s.protocol);
        return;
      }
      if (!s.host) return;
      site = s;
      showSite = true;
    })();
  });
</script>

<header>
  <span class="brand">learnwithsoju</span>
</header>

{#if showSite && site}
  <SiteToggleRow host={site.host} />
  <AdapterSection host={site.host} tab={site.tab} href={site.href} />
{/if}

<LinksRow />
<KofiBanner />
