// Entry materialization + identity-based dedup. Lifted from content.js
// (pre-Task-6). The dedup rule is the f8afd99 invariant: when two queries
// return the same dictionary entry, render it once.
//
// Identity = `${word}|${pos}|${first 80 chars of first sense's definition}`.
// Conservative: a few false negatives (re-render rather than swallow) are
// preferable to a false positive (swallow a real distinct entry).

export interface MaterializedEntry {
  entry: any;
  source: string;
}

export interface MaterializedGroup {
  word: string;
  entries: MaterializedEntry[];
}

/** Compute a stable identity for an entry. Returns null on shape errors. */
export function entryIdentity(e: any): string | null {
  try {
    const def = (e.senses && e.senses[0] && e.senses[0].definition) || '';
    return `${e.word || ''}|${e.pos || ''}|${def.slice(0, 80)}`;
  } catch (err) {
    console.warn('[lws] overlay entries: identity compute failed', err);
    return null;
  }
}

/**
 * Lazy parser cache holder. Attached to the lookup payload (which is
 * passed in by reference from content.js) so tab switches don't re-walk
 * the raw XML. The DOMParser and per-source parsers live in
 * extension/core/parsers.js — we load them at module init via
 * chrome.runtime.getURL.
 */
let parsersPromise: Promise<{
  parseKrdictXml: (xml: string, DOMParser: typeof window.DOMParser) => any[];
  parseOpendictXml: (xml: string, DOMParser: typeof window.DOMParser) => any[];
}> | null = null;

function loadParsers() {
  if (parsersPromise) return parsersPromise;
  parsersPromise = (async () => {
    const url = chrome.runtime.getURL('core/parsers.js');
    const mod = await import(/* @vite-ignore */ url);
    return {
      parseKrdictXml: mod.parseKrdictXml,
      parseOpendictXml: mod.parseOpendictXml,
    };
  })();
  return parsersPromise;
}

/** Resolve a section ref (`{source, queryIdx, itemIdx}`) into the parsed entry. */
async function entryForSection(payload: any, section: { source: string; queryIdx?: number; itemIdx: number }): Promise<any | null> {
  if (!payload.__entryCache) payload.__entryCache = { kr: new Map(), od: null };
  const cache = payload.__entryCache;
  // If the cache already contains a pre-populated array for this source/index
  // (tests do this to avoid hitting the parsers dynamic import), use it
  // directly without loading the parsers module.
  if (section.source === 'od') {
    if (cache.od) return cache.od[section.itemIdx] || null;
    const { parseOpendictXml } = await loadParsers();
    cache.od = parseOpendictXml(payload.odXml, window.DOMParser);
    return cache.od[section.itemIdx] || null;
  }
  // kr source. Check cache first.
  let arr = cache.kr.get(section.queryIdx);
  if (!arr) {
    const { parseKrdictXml } = await loadParsers();
    const xml = Array.isArray(payload.krXmls) ? payload.krXmls[section.queryIdx!] : null;
    arr = parseKrdictXml(xml, window.DOMParser);
    cache.kr.set(section.queryIdx, arr);
  }
  return arr[section.itemIdx] || null;
}

/**
 * Materialize a group's sections into deduplicated entries.
 * The synthetic-nnp source bypasses dedup (each is unique by construction).
 */
export async function materializeGroup(payload: any, group: any): Promise<MaterializedGroup> {
  if (!group || !Array.isArray(group.sections)) return { word: group ? group.word : '', entries: [] };
  const entries: MaterializedEntry[] = [];
  const seen = new Set<string>();
  for (const s of group.sections) {
    if (s.source === 'synthetic-nnp') {
      entries.push({ entry: s, source: 'synthetic-nnp' });
      continue;
    }
    const e = await entryForSection(payload, s);
    if (!e) continue;
    const id = entryIdentity(e);
    if (id === null || !seen.has(id)) {
      entries.push({ entry: e, source: s.source });
      if (id !== null) seen.add(id);
    }
  }
  return { word: group.word, entries };
}
