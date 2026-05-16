/**
 * Lemmatizer — given a Korean surface form (어절) and a list of mecab-ko
 * tokens for that surface, return ordered dictionary-form candidates to
 * try against KRDict.
 *
 * Token shape (from mecab-ko-wasm `Mecab.tokenize(surface)`):
 *   { surface, pos, lemma?, reading?, features?, start, end }
 *
 * `pos` carries Sejong POS tags, sometimes merged with `+` for fused
 * morphemes (e.g. `VV+EP`, `XSV+EF`). We split on `+` and look at the
 * leading tag to decide what role each morpheme plays.
 *
 * The `features` field is the raw mecab-ko-dic CSV row:
 *   `pos,semantic,jongseong,reading,type,first_pos,last_pos,decomposition`
 *
 * For Inflect-type tokens (irregular conjugations where the dictionary
 * stores the conjugated form whole — `걸려`, `예뻐요`, `봐요`, `해야`),
 * the `decomposition` column at index 7 carries the actual morpheme
 * breakdown like `걸리/VV/*+어/EC/*`. We pull the first morpheme's stem
 * out of that — `lemma` itself is just a clone of the reading, so it
 * would otherwise give us `걸려` instead of `걸리`.
 *
 * Strategy
 * --------
 *   1. Walk tokens left-to-right, collect content morphemes.
 *      - Verb / adjective stems (VV, VA, VX, VCN, VCP, XSV, XSA): append `다`
 *        to the stem to form the lemma. Use the Inflect decomposition when
 *        present, otherwise the `lemma`/surface.
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
 * Pull the first morpheme's stem out of an Inflect-type feature string.
 *
 * Format of the decomposition column (index 7): `stem/POS/sense+stem/POS/sense+...`.
 * For `걸려` features = `VV+EC,*,F,걸려,Inflect,VV,EC,걸리/VV/*+어/EC/*`,
 * this returns `걸리`. For non-Inflect tokens (where index 7 is `*`),
 * returns `null`.
 *
 * @param {string | null | undefined} features
 * @returns {string | null}
 */
export function inflectStem(features) {
  if (!features) return null;
  const parts = features.split(',');
  if (parts.length < 8) return null;
  const decomp = parts[7];
  if (!decomp || decomp === '*') return null;
  // Take everything before the first '/' of the first '+'-separated chunk.
  const firstPlus = decomp.indexOf('+');
  const firstChunk = firstPlus === -1 ? decomp : decomp.slice(0, firstPlus);
  const firstSlash = firstChunk.indexOf('/');
  if (firstSlash <= 0) return null;
  return firstChunk.slice(0, firstSlash);
}

/**
 * @param {Array<{surface: string, pos: string, lemma?: string, features?: string}>} tokens
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
      // Prefer the Inflect decomposition stem when available (irregulars).
      // Otherwise fall through to lemma/surface — which is correct for
      // already-split tokens (e.g. 먹/VV from 먹었어요).
      const stem = inflectStem(t.features) || t.lemma || t.surface || '';
      if (!stem) continue;
      if (VERB_LEAD_TAGS.has(tag)) {
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
