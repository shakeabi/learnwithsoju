/**
 * Grammar pattern matcher.
 *
 * Given the surrounding sentence text and the character range of the hovered
 * word, finds kimchi-grammar patterns whose regex hits inside or adjacent to
 * the hovered word, and returns deduped match info for the popup.
 *
 * The patterns DB is the JSON produced by `scripts/build-grammar-patterns.mjs`
 * — each entry has `id`, `name`, `defs`, and a `re` regex source string. The
 * regex is built from the pattern's display name (`고 있다`, `(으)로서`, etc.)
 * with vowel-harmony alternation and optional fragments handled.
 *
 * Match is best-effort:
 *   - Verb conjugation contractions (하 + 여 → 해, 되 + 어요 → 돼요) defeat
 *     the regex on some patterns. Those simply won't match.
 *   - Single-character "patterns" like 요, 부, 지 are excluded by a min-name
 *     length filter to keep the popup useful.
 *   - We only return patterns whose match position overlaps the hovered word's
 *     range (± 1 char) so unrelated particles in the rest of the sentence
 *     don't surface as hints for the current word.
 *
 * Pure module: takes data, returns data. No DOM, no chrome.*.
 *
 * @typedef {{ id: string, name: string, type: string, defs: Array<{slug:string,name:string,alt?:string,meaning:string}>, re: string }} Pattern
 * @typedef {{ source?: string, license?: string, generated_at?: string, patterns: Pattern[] }} PatternsDb
 * @typedef {{ pattern: Pattern, matched: string, start: number, end: number }} MatchResult
 */

const MIN_NAME_HANGUL_CHARS = 2;

/**
 * Compile a pattern's regex source. Cached on the pattern object via a
 * non-enumerable WeakMap-like marker (we don't mutate the input directly
 * because patterns may come from a JSON parse that's frozen).
 */
const COMPILED = new WeakMap();
function compileRegex(pattern) {
  if (COMPILED.has(pattern)) return COMPILED.get(pattern);
  let re = null;
  try {
    re = new RegExp(pattern.re, 'g');
  } catch {
    re = null;
  }
  COMPILED.set(pattern, re);
  return re;
}

function countHangul(s) {
  let n = 0;
  for (const ch of s || '') {
    const c = ch.codePointAt(0);
    if (
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0x3131 && c <= 0x318e) ||
      (c >= 0x1100 && c <= 0x11ff)
    ) {
      n++;
    }
  }
  return n;
}

/**
 * @param {Pattern} p
 * @returns {boolean} whether the pattern is "useful enough" to consider as
 *   a grammar hint. Single-char names (요, 부, 지, 고) are too noisy.
 */
export function isUsefulPattern(p) {
  if (!p || !p.name) return false;
  if (countHangul(p.name) < MIN_NAME_HANGUL_CHARS) return false;
  return true;
}

/**
 * Find pattern matches in the sentence that overlap (or are adjacent to)
 * the hovered word's character range.
 *
 * @param {PatternsDb} db
 * @param {string} sentenceText
 * @param {{ start: number, end: number }} hoverRange  character offsets within sentenceText
 * @param {{ maxResults?: number, adjacency?: number }} [opts]
 * @returns {MatchResult[]}
 */
export function findMatches(db, sentenceText, hoverRange, opts = {}) {
  const out = [];
  if (!db || !Array.isArray(db.patterns) || !sentenceText || !hoverRange) return out;
  const { maxResults = 5, adjacency = 1 } = opts;
  const seenIds = new Set();
  const lo = hoverRange.start - adjacency;
  const hi = hoverRange.end + adjacency;

  for (const pattern of db.patterns) {
    if (!isUsefulPattern(pattern)) continue;
    if (seenIds.has(pattern.id)) continue;
    const re = compileRegex(pattern);
    if (!re) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sentenceText))) {
      const start = m.index;
      const end = m.index + m[0].length;
      // Overlap test (including ±adjacency tolerance)
      if (end >= lo && start <= hi) {
        out.push({ pattern, matched: m[0], start, end });
        seenIds.add(pattern.id);
        break; // one hit per pattern is enough
      }
      // Avoid zero-width infinite loops if the pattern matches empty string
      if (m[0].length === 0) re.lastIndex++;
    }
    if (out.length >= maxResults) break;
  }

  // Order results by start position, then by name length descending so the
  // longer / more specific patterns appear first when several match.
  out.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return countHangul(b.pattern.name) - countHangul(a.pattern.name);
  });

  return out.slice(0, maxResults);
}

/**
 * Compute the hovered word's character range within the extracted sentence.
 * Returns null when the surface can't be located.
 *
 * @param {string} sentenceText
 * @param {string} surface
 * @returns {{ start: number, end: number } | null}
 */
export function locateSurface(sentenceText, surface) {
  if (!sentenceText || !surface) return null;
  const idx = sentenceText.indexOf(surface);
  if (idx < 0) return null;
  return { start: idx, end: idx + surface.length };
}
