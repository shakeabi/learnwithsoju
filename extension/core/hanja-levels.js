import { HANJA_LEVEL_BY_CHAR } from './hanja-levels-data.js';

/** @typedef {0|1|2|3|4|5|6|7|8} HanjaLevelDigit */

const LEVEL_LABEL = {
  8: '8급',
  7: '7급',
  6: '6급',
  5: '5급',
  4: '4급',
  3: '3급',
  2: '2급',
  1: '1급',
  0: '특급',
};

const LEVEL_TIER = {
  8: 'beginner',
  7: 'beginner',
  6: 'beginner',
  5: 'intermediate',
  4: 'intermediate',
  3: 'advanced',
  2: 'advanced',
  1: 'advanced',
  0: 'advanced',
};

/**
 * Look up the 한국어문회 한자능력검정 급수 for a single Hanja character.
 * Returns 8 (8급, easiest) down to 0 (특급), or null when not in the list.
 *
 * @param {string | null | undefined} ch
 * @returns {HanjaLevelDigit | null}
 */
export function lookupHanjaLevel(ch) {
  if (typeof ch !== 'string' || ch.length !== 1) return null;
  const level = HANJA_LEVEL_BY_CHAR[ch];
  return level == null ? null : /** @type {HanjaLevelDigit} */ (level);
}

/**
 * CSS class suffix for color-coded level badges (8 = green … 0 = red).
 *
 * @param {HanjaLevelDigit | null | undefined} level
 * @returns {string}
 */
export function hanjaLevelClass(level) {
  if (level == null) return '';
  return `lws-hanja-level-${level}`;
}

/**
 * Compact badge text for a level digit — numeric 8…1, 特 for 특급.
 *
 * @param {HanjaLevelDigit | null | undefined} level
 * @returns {string}
 */
export function formatHanjaLevel(level) {
  if (level == null) return '';
  return level === 0 ? '特' : String(level);
}

/**
 * Tooltip for a level badge — explains that the digit is a Hanja exam level.
 *
 * @param {HanjaLevelDigit | null | undefined} level
 * @param {string | null | undefined} [character]
 * @returns {string}
 */
export function hanjaLevelTooltip(level, character) {
  if (level == null) return '';
  const label = LEVEL_LABEL[level];
  const tier = LEVEL_TIER[level];
  const levelMark = formatHanjaLevel(level);
  const base = `Hanja level ${levelMark} (${label}, ${tier})`;
  return character ? `${character} — ${base}` : base;
}

/**
 * Per-character level rows for a Hanja string (e.g. an origin field).
 *
 * @param {string} text
 * @returns {Array<{ character: string, level: HanjaLevelDigit, label: string }>}
 */
export function hanjaLevelEntries(text) {
  if (typeof text !== 'string' || !text) return [];
  /** @type {Array<{ character: string, level: HanjaLevelDigit, label: string }>} */
  const out = [];
  for (const ch of text) {
    const level = lookupHanjaLevel(ch);
    if (level == null) continue;
    out.push({ character: ch, level, label: formatHanjaLevel(level) });
  }
  return out;
}

/**
 * Chip summary — one level per Hanja character, joined with · (e.g. "4·5").
 *
 * @param {string} text
 * @returns {string}
 */
export function hanjaLevelSummary(text) {
  const labels = hanjaLevelEntries(text).map((e) => e.label);
  return labels.length ? labels.join('·') : '';
}

/**
 * Tooltip listing each character's level for a Hanja string.
 *
 * @param {string} text
 * @returns {string}
 */
export function hanjaLevelSummaryTooltip(text) {
  const entries = hanjaLevelEntries(text);
  if (!entries.length) return '';
  return entries
    .map(({ character, level }) => `${character} ${LEVEL_LABEL[level]}`)
    .join(', ');
}

/**
 * Create a level badge element for popup rendering.
 *
 * @param {Document} doc
 * @param {HanjaLevelDigit} level
 * @param {string | null | undefined} [character]
 * @returns {HTMLSpanElement}
 */
export function makeHanjaLevelBadge(doc, level, character) {
  const badge = doc.createElement('span');
  badge.className = `lws-hanja-level ${hanjaLevelClass(level)}`.trim();
  badge.textContent = formatHanjaLevel(level);
  const tip = hanjaLevelTooltip(level, character);
  badge.title = tip;
  badge.setAttribute('aria-label', tip);
  return badge;
}

/**
 * Colored level badges for a Hanja string — used on the collapsed chip.
 *
 * @param {Document} doc
 * @param {string} text
 * @returns {HTMLSpanElement | null}
 */
export function makeHanjaLevelSummaryGroup(doc, text) {
  const entries = hanjaLevelEntries(text);
  if (!entries.length) return null;
  const wrap = doc.createElement('span');
  wrap.className = 'lws-hanja-level-chip';
  entries.forEach((e, i) => {
    if (i > 0) {
      const sep = doc.createElement('span');
      sep.className = 'lws-hanja-level-sep';
      sep.textContent = '·';
      sep.setAttribute('aria-hidden', 'true');
      wrap.appendChild(sep);
    }
    wrap.appendChild(makeHanjaLevelBadge(doc, e.level, e.character));
  });
  return wrap;
}
