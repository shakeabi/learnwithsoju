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
