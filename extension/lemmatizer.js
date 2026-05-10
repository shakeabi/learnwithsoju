/**
 * Lemmatizer — given a Korean surface form (어절) and a list of mecab-ko
 * tokens for that surface, return ordered dictionary-form candidates to
 * try against KRDict.
 *
 * Token shape (from mecab-ko-wasm `Mecab.tokenize(surface)`):
 *   { surface: string, pos: string, lemma?: string, reading?: string, start, end }
 *
 * `pos` carries Sejong POS tags, sometimes merged with `+` for fused
 * morphemes (e.g. `VV+EP`, `XSV+EF`). We split on `+` and look at the
 * leading tag to decide what role each morpheme plays.
 *
 * Strategy
 * --------
 *   1. Walk tokens left-to-right, collect content morphemes.
 *      - Verb / adjective stems (VV, VA, VX, VCN, VCP, XSV, XSA): append `다`
 *        to form the lemma.
 *      - Nouns / pronouns / numerals (NNG, NNP, NR, NP, SL, SH, SN): the
 *        morpheme itself is the lemma.
 *      - Anything else (particles JK*, endings E*, suffixes XSN, marks SF/SP):
 *        skip — these aren't dictionary headwords.
 *   2. Always include the original surface as a fallback candidate so
 *      multi-syllable nouns like 한국말 still resolve when mecab splits
 *      them into 한국 + 말.
 *   3. De-duplicate while preserving insertion order — the caller tries
 *      candidates against KRDict in this order; first hit wins.
 *
 * Pure function: takes `tokens` and `surface`, returns `string[]`. No
 * dependency on mecab itself, so this module is unit-testable in Node
 * with hand-built token arrays.
 */

const VERB_LEAD_TAGS = new Set(['VV', 'VA', 'VX', 'VCN', 'VCP', 'XSV', 'XSA']);
const NOUN_LEAD_TAGS = new Set(['NNG', 'NNP', 'NR', 'NP', 'SL', 'SH', 'SN']);

function leadTag(pos) {
  if (!pos) return '';
  const plus = pos.indexOf('+');
  return plus >= 0 ? pos.slice(0, plus) : pos;
}

/**
 * @param {Array<{surface: string, pos: string, lemma?: string}>} tokens
 * @param {string} surface
 * @returns {string[]} ordered candidate lemmas
 */
export function lemmaCandidates(tokens, surface) {
  const seen = new Set();
  const out = [];
  const push = (w) => {
    if (w && w.length > 0 && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  };

  if (Array.isArray(tokens)) {
    for (const t of tokens) {
      const tag = leadTag(t.pos || '');
      const stem = t.lemma || t.surface || '';
      if (!stem) continue;
      if (VERB_LEAD_TAGS.has(tag)) {
        // Verb/adjective stems become headwords with -다 appended.
        // Mecab returns the surface stem (e.g. 먹/VV for "먹었어요"); we add 다.
        push(stem.endsWith('다') ? stem : stem + '다');
      } else if (NOUN_LEAD_TAGS.has(tag)) {
        push(stem);
      }
      // Particles, endings, and other non-content tags are skipped.
    }
  }

  // Surface fallback handles compound nouns mecab split apart and any
  // word the dictionary indexes whole (e.g. 컴퓨터, 한국말).
  if (surface) push(String(surface).trim());

  return out;
}
