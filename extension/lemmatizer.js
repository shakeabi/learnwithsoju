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
 * leading tag to decide what role each morpheme plays. See
 * `grammar/grammar-glosses.md` for the full tag reference and constant-set
 * membership table.
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

const LWS_NBEST_DIAG = true;

const VERB_LEAD_TAGS = new Set(['VV', 'VA', 'VX', 'VCN', 'VCP', 'XSV', 'XSA']);
// Tags eligible for the ambiguous-ㄹ guard. VCP (copula) and VCN are
// intentionally excluded: their lemma is always 이다 / 아니다, never the
// surface form, so pushing surface+다 first would be wrong.
const AMBIGUOUS_L_TAGS = new Set(['VV', 'VA']);
const NOUN_LEAD_TAGS = new Set(['NNG', 'NNP', 'NR', 'NP', 'SL', 'SH', 'SN']);
// Tags that can appear in the noun-phrase prefix before an XSV/XSA suffix.
// Wider than NOUN_LEAD_TAGS — includes MM (관형사 / determiners like 한, 두,
// 새), NNB (bound nouns like 잔, 번, 적), and XR (roots like 깨끗, 행복).
// Without these, compounds like `한잔하다` (`한`/MM + `잔`/NNB + `해`/XSV+EF)
// fall through to just `하다`.
const COMPOUND_PREFIX_TAGS = new Set(['NNG', 'NNP', 'NNB', 'NR', 'NP', 'MM', 'XR', 'XSN']);
const COMPOUND_DERIV_TAGS = new Set(['XSV', 'XSA']);
// When *every* token in the surface is one of these, the surface is almost
// always a compound noun mecab split into pieces (반말 → 반+말, 무조건 → 무+조건,
// 한국어 → 한국+어). The full compound is what the learner hovered, so we try
// it first as the lemma candidate. Particles/endings/verbs would break this
// invariant, so the regular lemma-first chain kicks in instead.
const COMPOUND_NOUN_TAGS = new Set(['NNG', 'NNP', 'NR', 'NP', 'XSN']);

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
 * this returns `걸리`. For non-Inflect tokens (regular verbs, plain nouns,
 * compound nouns), returns `null` so callers fall back to `t.lemma` /
 * `t.surface`.
 *
 * The gate on `type === 'Inflect'` (index 4) is critical. mecab-ko-dic
 * also populates the decomposition column for `Compound`-type entries —
 * 오랜만 / 한국말 / 파티원들 are stored as NNGs with a Compound breakdown
 * like `오랜/NNG/*+만/NNG/*`. Without this gate we'd extract `오랜` and
 * treat that as the noun's stem instead of letting the surface 오랜만
 * stand as the lemma. Type=Inflect specifically marks the irregular verb
 * conjugations this helper was built for (걸려, 봐요, 돼요, 해야).
 *
 * @param {string | null | undefined} features
 * @returns {string | null}
 */
export function inflectStem(features) {
  if (!features) return null;
  const parts = features.split(',');
  if (parts.length < 8) return null;
  // Only Inflect tokens decompose. Compound nouns / regular forms keep
  // their surface as the lemma.
  if (parts[4] !== 'Inflect') return null;
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

  // Compound-noun-first: when every token is noun-like (no particles,
  // no inflection, no verb stems), the surface is almost certainly a
  // compound noun. Push it before the individual pieces so KRDict's
  // first-hit-wins query order returns the compound (e.g. "반말") rather
  // than the first sub-noun (e.g. "반").
  if (Array.isArray(tokens) && tokens.length > 1 && surface) {
    const allNounLike = tokens.every((t) => {
      const tag = leadTag(t.pos || '');
      return tag && COMPOUND_NOUN_TAGS.has(tag);
    });
    if (allNounLike) push(String(surface).trim());
  }

  if (Array.isArray(tokens)) {
    // Compound noun-phrase + XSV/XSA → push the whole compound first.
    //
    //   어색하려고  → 어색/NNG  + 하/XSV  + 려고/EC      ⇒  어색하다
    //   예약해야    → 예약/NNG + 해야/XSV+EC (Inflect)   ⇒  예약하다
    //   한잔해     → 한/MM    + 잔/NNB  + 해/XSV+EF     ⇒  한잔하다
    //   깨끗하다    → 깨끗/XR  + 하/XSA  + 다/EF         ⇒  깨끗하다
    //
    // We accumulate the surface of every CONTENT_PREFIX_TAG token until we
    // hit an XSV/XSA — anything else (particle, verb stem, ending) resets
    // the accumulator. This is wider than the previous NNG/NNP/XR-only rule
    // so determiner+bound-noun compounds like 한잔하다 work.
    let prefix = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const tag = leadTag(t.pos || '');
      if (COMPOUND_PREFIX_TAGS.has(tag)) {
        prefix += t.surface || '';
      } else if (COMPOUND_DERIV_TAGS.has(tag) && prefix) {
        const derivStem = inflectStem(t.features) || t.lemma || t.surface || '';
        if (derivStem) {
          const clean = derivStem.endsWith('다') ? derivStem.slice(0, -1) : derivStem;
          push(prefix + clean + '다');
        }
        break;
      } else {
        prefix = '';
      }
    }

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const tag = leadTag(t.pos || '');
      // Prefer the Inflect decomposition stem when available (irregulars
      // like 봐요 → 보, 해야 → 하, 걸려 → 걸리). Otherwise fall through
      // to lemma/surface — which is correct for already-split tokens
      // (e.g. 먹/VV from 먹었어요).
      const decompStem = inflectStem(t.features);
      const tSurface = String(t.surface || '');
      const stem = decompStem || t.lemma || tSurface || '';
      if (!stem) continue;
      if (VERB_LEAD_TAGS.has(tag)) {
        // Ambiguous-ㄹ guard (VV/VA only): when the decomposition's stem is a
        // single syllable AND the surface is a different single syllable,
        // mecab-ko-dic has picked an unusual etymological analysis
        // (surface 가 → stem 갈 via phantom ㄹ-deletion, surface 사
        // → stem 살, etc.). The surface itself is the much more common
        // dictionary form in everyday text. Push surface+다 first;
        // keep the Inflect stem as a fallback so the rarer reading
        // still surfaces if the surface lemma isn't in KRDict.
        // Gated on AMBIGUOUS_L_TAGS so VCP/VCN are never affected —
        // the copula's lemma is always 이다, not the surface form.
        if (AMBIGUOUS_L_TAGS.has(tag) &&
            decompStem && tSurface && decompStem !== tSurface
            && decompStem.length === 1 && tSurface.length === 1) {
          push(tSurface + '다');
          push(decompStem + '다');
        } else {
          push(stem.endsWith('다') ? stem : stem + '다');
        }
      } else if (NOUN_LEAD_TAGS.has(tag)) {
        push(stem);
      }
      // XR / NNB / MM on their own — without a following XSV/XSA — aren't
      // standalone lemma candidates; the per-token loop skips them.
      // Particles, endings, and other non-content tags are skipped.
    }
  }

  // Surface fallback handles compound nouns mecab split apart and any
  // word the dictionary indexes whole (e.g. 컴퓨터, 한국말).
  if (surface) push(String(surface).trim());

  return out;
}

/**
 * Merge candidates across the N-best parses returned by
 * `Mecab.tokenize_nbest(surface, n)`. Each path is the same token-array
 * shape `lemmaCandidates` already understands; we run that helper per
 * path in cost order and de-dup the union (insertion-order preserved,
 * so the 1-best path's candidates stay first — exactly what the
 * lemma-first KRDict query order needs).
 *
 * @param {Array<{tokens: any[], cost?: number}>} paths
 * @param {string} surface
 * @returns {string[]}
 */
export function lemmaCandidatesFromNbest(paths, surface) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(paths)) {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (!path || !Array.isArray(path.tokens)) continue;
      const pathCands = lemmaCandidates(path.tokens, surface);
      if (LWS_NBEST_DIAG) {
        console.log(`[lws-nbest] path ${i} candidates: [${pathCands.join(', ')}]`);
      }
      for (const cand of pathCands) {
        if (cand && !seen.has(cand)) {
          seen.add(cand);
          out.push(cand);
        }
      }
    }
  }
  if (out.length === 0 && surface) {
    const s = String(surface).trim();
    if (s) out.push(s);
  }
  if (LWS_NBEST_DIAG) {
    console.log(`[lws-nbest] merged (deduped): [${out.join(', ')}]`);
  }
  return out;
}
