/**
 * Pure helpers for talking to the KRDict and OpenDict APIs.
 *
 * No fetch, no chrome.*, no DOM. Only URL construction and response inspection
 * so this module is fully unit-testable in Node.
 */

export const KRDICT_ENDPOINT = 'https://krdict.korean.go.kr/api/search';
export const OPENDICT_ENDPOINT = 'https://opendict.korean.go.kr/api/search';

// Both APIs require num >= 10 (and <= 100). 10 is the default and the minimum.
export const MIN_NUM = 10;

/**
 * @param {string} query
 * @param {string} apiKey
 * @param {{ num?: number, transLang?: string }} [options]
 * @returns {string} fully built request URL
 */
export function buildKrdictUrl(query, apiKey, options = {}) {
  if (!query) throw new Error('buildKrdictUrl: query required');
  if (!apiKey) throw new Error('buildKrdictUrl: apiKey required');
  const num = clampNum(options.num);
  const url = new URL(KRDICT_ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', query);
  url.searchParams.set('part', 'word');
  url.searchParams.set('translated', 'y');
  url.searchParams.set('trans_lang', options.transLang || '1');
  url.searchParams.set('num', String(num));
  url.searchParams.set('sort', 'dict');
  return url.toString();
}

/**
 * Build a search URL for the OpenDict (우리말샘) API.
 *
 * OpenDict is the larger, community-edited NIKL dictionary; we use it as a
 * fallback when KRDict has no entry. Unlike KRDict it does not gate
 * translations behind a `translated`/`trans_lang` pair — translation data
 * (when present) ships inside `<translation_info>` blocks tagged with
 * `<language_type>`, and we filter at parse time.
 *
 * @param {string} query
 * @param {string} apiKey
 * @param {{ num?: number, reqType?: 'xml' | 'json' }} [options]
 * @returns {string} fully built request URL
 */
export function buildOpendictUrl(query, apiKey, options = {}) {
  if (!query) throw new Error('buildOpendictUrl: query required');
  if (!apiKey) throw new Error('buildOpendictUrl: apiKey required');
  const num = clampNum(options.num);
  const url = new URL(OPENDICT_ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', query);
  url.searchParams.set('req_type', options.reqType || 'xml');
  url.searchParams.set('num', String(num));
  url.searchParams.set('part', 'word');
  url.searchParams.set('sort', 'dict');
  return url.toString();
}

function clampNum(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return MIN_NUM;
  if (n < MIN_NUM) return MIN_NUM;
  if (n > 100) return 100;
  return Math.floor(n);
}

/**
 * Lightweight check whether an XML response contains usable items.
 * Used so we can fall through to the next lemma candidate / dictionary
 * without doing a full DOMParser pass in the service worker (which has no DOM).
 *
 * @param {string | null | undefined} xml
 * @returns {boolean}
 */
export function looksEmpty(xml) {
  if (!xml) return true;
  if (/<error[\s>]/i.test(xml)) return true;
  const totalMatch = xml.match(/<total>(\d+)<\/total>/);
  if (totalMatch && Number(totalMatch[1]) === 0) return true;
  return !/<item[\s>]/i.test(xml);
}

/**
 * Extract one `<word>...</word>` per top-level `<item>` block from a KRDict /
 * OpenDict XML response, in document order. Used by the service worker (no
 * DOM) to drive the per-query grouping algorithm in `handleLookup` — we need
 * the headword of each entry to bucket them by `word`, but the full parse
 * (with senses, translations, etc.) stays in the content script where
 * DOMParser is available.
 *
 * Returns `[]` for empty / error responses. An item without a `<word>` child
 * contributes an empty string so itemIdx-based references from the caller's
 * grouping plan stay aligned with the parsed entries on the content side.
 *
 * @param {string | null | undefined} xml
 * @returns {string[]}
 */
export function extractItemWords(xml) {
  if (!xml) return [];
  const out = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const w = /<word>([\s\S]*?)<\/word>/.exec(m[1]);
    out.push(w ? w[1].trim() : '');
  }
  return out;
}

/**
 * Group one query's headword list into ordered, deduped buckets keyed by
 * `word`. Each bucket records every itemIdx that produced that word so the
 * grouping plan stays aligned with the parsed entries on the content side.
 * First-occurrence order of distinct words is preserved.
 *
 * @param {string[]} words
 * @returns {{ word: string, indices: number[] }[]}
 */
export function groupByWord(words) {
  const map = new Map();
  for (let idx = 0; idx < words.length; idx++) {
    const w = (words[idx] || '').trim();
    if (!w) continue;
    if (!map.has(w)) map.set(w, []);
    map.get(w).push(idx);
  }
  const out = [];
  for (const [word, indices] of map) out.push({ word, indices });
  return out;
}

/**
 * The five-step result-merging algorithm. Inputs are per-query headword
 * lists (no parsed entries — just `word` strings in item order, computed
 * by `extractItemWords`). Output is a grouping plan `{tabs, unrelated}`
 * where each section carries `{source, queryIdx, itemIdx}` so the content
 * script can locate the matching parsed entry without re-grouping.
 *
 *   1. Already done by caller: per-query word lists keyed by query.
 *   2. groupByWord per query.
 *   3. Walk queries in order; each query's first not-yet-tabbed group
 *      becomes a tab. One query can contribute multiple groups when its
 *      earlier groups were already tabbed by earlier queries.
 *   4. Across-query consolidation: any later group whose word matches an
 *      existing tab folds into that tab.
 *   5. Everything left over becomes unrelated, grouped by word.
 *
 * OpenDict (when KRDict was entirely empty) is treated as one additional
 * query at the tail of the queue with source = 'od'.
 *
 * @param {{
 *   krQueries: string[],
 *   krWordsPerQuery: string[][],
 *   odQuery?: string | null,
 *   odWords?: string[],
 * }} input
 * @returns {{
 *   tabs: { word: string, sections: { source: 'kr'|'od', queryIdx: number, itemIdx: number }[] }[],
 *   unrelated: { word: string, sections: { source: 'kr'|'od', queryIdx: number, itemIdx: number }[] }[],
 * }}
 */
export function pickTabsAndUnrelated({ krQueries, krWordsPerQuery, odQuery, odWords }) {
  const groupsPerQuery = [];
  const sources = [];
  if (Array.isArray(krQueries) && krQueries.length > 0) {
    for (let i = 0; i < krQueries.length; i++) {
      groupsPerQuery.push(groupByWord(krWordsPerQuery[i] || []));
      sources.push('kr');
    }
  }
  if (odQuery && Array.isArray(odWords) && odWords.length > 0) {
    groupsPerQuery.push(groupByWord(odWords));
    sources.push('od');
  }

  const tabs = [];
  const tabByWord = new Map();
  const pickedKey = new Set();
  const keyOf = (q, w) => `${q}|${w}`;

  for (let qi = 0; qi < groupsPerQuery.length; qi++) {
    const src = sources[qi];
    for (const g of groupsPerQuery[qi]) {
      if (tabByWord.has(g.word)) continue;
      const sections = g.indices.map((itemIdx) => ({ source: src, queryIdx: qi, itemIdx }));
      const tab = { word: g.word, sections };
      tabs.push(tab);
      tabByWord.set(g.word, tab);
      for (const idx of g.indices) pickedKey.add(keyOf(qi, idx));
      break;
    }
  }

  for (let qi = 0; qi < groupsPerQuery.length; qi++) {
    const src = sources[qi];
    for (const g of groupsPerQuery[qi]) {
      const tab = tabByWord.get(g.word);
      if (!tab) continue;
      for (const itemIdx of g.indices) {
        const k = keyOf(qi, itemIdx);
        if (pickedKey.has(k)) continue;
        tab.sections.push({ source: src, queryIdx: qi, itemIdx });
        pickedKey.add(k);
      }
    }
  }

  const unrelated = [];
  const unrelByWord = new Map();
  for (let qi = 0; qi < groupsPerQuery.length; qi++) {
    const src = sources[qi];
    for (const g of groupsPerQuery[qi]) {
      if (tabByWord.has(g.word)) continue;
      for (const itemIdx of g.indices) {
        const k = keyOf(qi, itemIdx);
        if (pickedKey.has(k)) continue;
        let bucket = unrelByWord.get(g.word);
        if (!bucket) {
          bucket = { word: g.word, sections: [] };
          unrelByWord.set(g.word, bucket);
          unrelated.push(bucket);
        }
        bucket.sections.push({ source: src, queryIdx: qi, itemIdx });
        pickedKey.add(k);
      }
    }
  }

  return { tabs, unrelated };
}

/**
 * Compute a stable identity key for a parsed KRDict/OpenDict entry so that
 * duplicate entries returned by multiple queries can be detected and collapsed.
 *
 * Key form: `"${word}|${pos}|${firstDefSnippet}"` where the snippet is the
 * first 80 characters of the first sense's definition. This distinguishes:
 *   - Same word, different POS  → different key → both kept.
 *   - Same word, same POS, different first sense → different key → both kept.
 *   - Same word, same POS, same first sense → same key → duplicate dropped.
 *
 * Returns null if the key cannot be computed (caller should treat the entry as
 * unique and log the anomaly rather than silently dropping it).
 *
 * @param {{ word?: string, pos?: string, senses?: { definition?: string }[] }} entry
 * @returns {string | null}
 */
export function entryIdentity(entry) {
  try {
    const def = (entry.senses && entry.senses[0] && entry.senses[0].definition) || '';
    return `${entry.word || ''}|${entry.pos || ''}|${def.slice(0, 80)}`;
  } catch {
    return null;
  }
}

/**
 * Extract the (error_code, message) pair from an XML error response.
 * Returns null if the XML is not an error.
 *
 * @param {string | null | undefined} xml
 * @returns {{ code: string, message: string } | null}
 */
export function extractApiError(xml) {
  if (!xml || !/<error[\s>]/i.test(xml)) return null;
  const code = xml.match(/<error_code>(.*?)<\/error_code>/);
  const message = xml.match(/<message>(.*?)<\/message>/);
  return {
    code: code ? code[1] : '',
    message: message ? message[1] : '',
  };
}
