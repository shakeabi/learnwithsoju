# Lemmatization

`lemmatizer.js` is the single most accuracy-critical pure module in
the extension. The popup is only useful if the candidate it picks
for KRDict is the form a human would look up — and human Korean
speakers don't look up 예약해야 in the dictionary, they look up
예약하다. Getting this right takes more than just "stem off the
ending."

Related reading:
- [lookup-pipeline.md](lookup-pipeline.md) — where the candidate
  list flows next (top 5 parallel KRDict, group by word, render)
- [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md) — the
  `tokenize_nbest` fork and n-best searcher

---

## What mecab gives us

Each `tokenize` call returns an array of token objects:

```js
{ surface: '걸려', pos: 'VV+EC', lemma: '걸려', reading: null,
  features: 'VV+EC,*,F,걸려,Inflect,VV,EC,걸리/VV/*+어/EC/*',
  start: 0, end: 2 }
```

The `pos` field carries Sejong-style POS tags, sometimes joined
with `+` for fused morphemes (`VV+EC`, `XSV+EF`, ...). The
lemmatizer always looks at the lead tag (before the first `+`).

The `features` field is the raw mecab-ko-dic CSV row:

```
pos , semantic , jongseong , reading , type     , first_pos , last_pos , decomposition
```

For `type=Inflect` tokens (irregular conjugations stored whole —
걸려, 예뻐요, 봐요, 해야), the `decomposition` column carries the
real morpheme breakdown like `걸리/VV/*+어/EC/*`. The `lemma` column
for these tokens is just a clone of the surface — looking up `걸려`
in KRDict is a waste of bandwidth. The actual stem `걸리` lives
only in the decomposition.

`inflectStem(features)` is the helper that pulls the first stem
out:

```js
inflectStem('VV+EC,*,F,걸려,Inflect,VV,EC,걸리/VV/*+어/EC/*')  // '걸리'
inflectStem('VV,*,T,먹,*,*,*,*')                                // null (decomposition = '*')
inflectStem(null) || inflectStem('VV,*,T,먹')                   // null (missing or short)
```

The "type=Inflect" gate matters — without it, we'd try to pull a
stem out of every token whose features column has 8 fields, which
is almost all of them, and we'd start corrupting non-Inflect cases.

---

## Candidate ordering rules, with examples

The function `lemmaCandidates(tokens, surface)` walks tokens and
pushes candidates into a de-duplicated, order-preserving list. The
list is returned to the caller in priority order — `background.js`
fires the top 5 (`KRDICT_PARALLEL_CAP = 5`) in parallel and the
grouping algorithm assembles tabs.

`lemmaCandidatesFromNbest(paths, surface)` wraps this: runs
`lemmaCandidates` over each path in cost order (paths returned by
`Mecab.tokenize_nbest`, `NBEST_N = 5`) and merges the union with
insertion-order de-dup. The 1-best path's candidates stay first;
any extra candidates surfaced by lower-cost alternative parses are
appended after.

The push order for a single path is:

1. **Surface-first promotion** — if `tokens.length > 1` AND every
   token's lead tag is in `COMPOUND_NOUN_TAGS` (NNG NNP NR NP XSN),
   push the surface BEFORE walking the individual pieces. This is
   the pure-noun-compound case (sets `multiPrimary` — see below).
2. **Compound-prefix accumulator** — walk left to right; accumulate
   the surface of every COMPOUND_PREFIX_TAG token (NNG NNP NNB NR
   NP MM XR XSN) into `prefix`. When you hit an XSV or XSA token,
   push `prefix + stem + '다'` where `stem` is the Inflect-extracted
   stem if any, otherwise the token's lemma or surface (with a
   trailing `다` stripped first).

   Anything OTHER than COMPOUND_PREFIX_TAGS / COMPOUND_DERIV_TAGS
   resets the accumulator (so a stray particle doesn't fold into
   the prefix). After the first XSV/XSA, we break — only the first
   compound is emitted.

   The prefix tag set is intentionally wider than NOUN_LEAD_TAGS.
   MM (determiners like 한, 두, 새), NNB (bound nouns like 잔,
   번, 적), and XR (roots like 깨끗, 행복) all need to participate
   as prefix so determiner+bound-noun+verb-deriving-suffix
   compounds resolve.
3. **Per-token push** — walk left to right; for each token:
   - Compute `decompStem = inflectStem(features)`, and
     `stem = decompStem || lemma || surface`.
   - If lead tag is in VERB_LEAD_TAGS:
     - **Ambiguous-ㄹ guard** (see below): when lead tag is in
       AMBIGUOUS_L_TAGS (VV or VA) AND `decompStem` is a single
       syllable AND `surface` is a *different* single syllable,
       push `surface + '다'` first, then `decompStem + '다'` as a
       fallback. VCP/VCN/VX/XSV/XSA always fall through to the
       normal path.
     - Otherwise push `stem` (or `stem + '다'` if it doesn't
       already end in 다).
   - If lead tag is in NOUN_LEAD_TAGS, push `stem` as-is.
   - Otherwise skip — particles, endings, and pure-suffix tokens
     aren't dictionary headwords on their own.

   Note: XR and NNB on their own — without a following XSV/XSA —
   aren't standalone candidates. The per-token loop skips them
   (they're not in NOUN_LEAD_TAGS or VERB_LEAD_TAGS). They only
   participate when the compound-prefix accumulator picks them up.
4. **Surface fallback** — always push the trimmed surface at the
   end. Catches anything the per-token logic skipped (e.g.
   punctuation-only surface, multi-word inputs).

---

## Why the Inflect gate matters

Earlier versions ran `inflectStem` unconditionally and pulled the
first-slash-prefix out of whatever was at index 7 of the features
column. For NNG tokens, that column is typically `*`, so this
returned `null` — fine. But for tokens with `type=Compound`
(different from `Inflect`) the decomposition column also carries a
structure:

```
오랜만 → features = 'NNG,*,T,오랜만,Compound,NNG,*,오래/NNG/*+ㄴ/JX/*+만/NNG/*'
```

Without the Inflect gate, we'd extract `오래` as the "stem" and
push it as the primary noun candidate — but the user hovered
`오랜만` and wants that whole word. `inflectStem` is now type-
gated: it returns the extracted stem ONLY when the type column
equals `Inflect`, falling through to `lemma || surface` for
everything else.

This split is what makes both pure-noun-compound rules safe to
apply at once: the surface-first rule pushes the whole compound
first, and the per-token loop's NNG path then uses the lemma (the
canonical noun form), not the Inflect-extracted prefix.

---

## The ambiguous-ㄹ guard

Even when the Inflect gate fires correctly (`type === 'Inflect'`),
mecab-ko-dic occasionally picks an etymological analysis that
gives a misleading stem. Reproducible case: hovering `가볼게요`
("I'll try going" / "I'll go and see"). mecab returns two tokens:

```
가/VV     features=… type=Inflect … decomposition=갈/VV/*
볼게요/EC+VX+EF
```

The surface IS `가`, but the dictionary's decomposition column
claims the underlying stem is `갈` (treating `가` as a contracted
form of `갈다` via phantom ㄹ-deletion). `inflectStem` faithfully
extracts `갈`, the per-token loop pushes `갈다` ("to grind"),
KRDict happily returns that — and the learner gets the wrong word.

The guard: when the lead tag is in `AMBIGUOUS_L_TAGS` (`{VV, VA}`)
AND `decompStem` is a single syllable AND `surface` is ALSO a
single syllable AND they differ, the per-token loop pushes
`surface + '다'` FIRST and keeps `decompStem + '다'` as a fallback.
Rationale:

- For irregular conjugations the surface is multi-syllable (`봐요`,
  `해야`, `걸려`, `예뻐요`) — the guard's length check skips them.
- For single-syllable ambiguities (`가`/`갈`, `사`/`살`, `나`/`날`,
  `자`/`잘`), the surface itself is overwhelmingly the more common
  dictionary form in everyday Korean. Pushing it first means
  KRDict's first-hit-wins logic returns 가다 / 사다 / 나다 / 자다
  — almost always the right answer.
- The rarer reading still gets a fair shot via the fallback push,
  so a genuine 갈다 / 살다 query (when surface really IS that
  stem) still resolves correctly because mecab returns surface=`갈`
  with stem=`갈` — no length mismatch, guard doesn't fire, normal
  path.

**Why VCP/VCN are excluded from `AMBIGUOUS_L_TAGS`:** The copula
이다 and negative copula 아니다 are the *only* valid lemmas for
VCP and VCN tokens — the surface form is never the dictionary
headword. For example, `그거였어요` parses to `였/VCP+EP` with
Inflect decomp stem `이`. Surface=`였`, stem=`이` — both single
syllables, different. The old guard (before scoping to VV/VA)
fired and pushed `였다` before `이다`, producing a nonsense lemma.
Gating on `AMBIGUOUS_L_TAGS` prevents the guard from ever touching
VCP/VCN/VX/XSV/XSA tokens.

Tests in `tests/lemmatizer.test.js` cover five cases: 가 fires the
guard (VV), 사 fires the guard (VV), 봐요 (multi-syllable) doesn't,
갈 with matching stem doesn't, and 였/VCP doesn't fire the guard
(이다 appears before 였다 or 였다 is absent).

---

## Two pure-noun-compound rules, both load-bearing

There are two rules in `lemmatizer.js` that interact with pure
noun compounds:

1. **Surface-first push** — if every token is in
   COMPOUND_NOUN_TAGS, push the surface FIRST.
2. **inflectStem gating** — `inflectStem` returns null unless
   `type === 'Inflect'`.

You might be tempted to think the surface-first push alone is
enough — just push the whole compound and we're done. But without
the Inflect gate, the per-token loop will then call `inflectStem`
on each NNG token's features and (for any noun with a Compound
decomposition like 오랜만) pull a sub-stem out and push it as a
higher-priority candidate than the noun itself. The Inflect gate
is what keeps Compound-type nouns' lemmas (not their pieces)
coming through the per-token loop.

Both rules together are necessary. The lemmatizer test suite has a
case explicitly named for this (`'compound XSV verb in Inflect form:
예약해야 → 예약하다 first'`).

---

## Proper-noun synthesis (NNP fallback)

Lives in `background.js`, not `lemmatizer.js`, but conceptually
part of the candidate-resolution story. If both `tabs` and
`unrelated` are empty after the parallel KRDict + OpenDict
fallback, `synthesizeProperNounEntry` scans the 1-best token path
for any token whose leading Sejong tag is `NNP` (proper noun).
When found, a single synthetic tab is injected with
`source: 'synthetic-nnp'`, `pos: '고유명사'`, and a canned
definition telling the user it's a proper noun. The whole surface
is used as the entry word.

Without this fallback, hovering a proper noun (person name, brand,
place) that's not in KRDict produces "No definition found", which
is unhelpful — the user already knows the word's a name; what they
want is confirmation that mecab classified it as such.

---

## The XR / NNB / MM-alone-isn't-a-candidate rule

The per-token loop in `lemmaCandidates` only pushes tokens whose
lead tag is in VERB_LEAD_TAGS or NOUN_LEAD_TAGS. XR, NNB, MM are
NOT in either set, even though they participate in the compound-
prefix accumulator (which IS in COMPOUND_PREFIX_TAGS). This is
intentional:

- `깨끗` (XR) alone isn't a dictionary word — `깨끗하다` is.
- `잔` (NNB) alone isn't typically what a learner wants to look up
  when they hovered `한잔하다`.
- `한` (MM) alone is too low-frequency standalone to be a useful
  fallback.

If you ever need to look up XR/NNB/MM standalone (e.g. for a
debugging feature), add a separate code path — don't widen the
per-token rule.

---

## The Sejong POS tags the lemmatizer cares about

| Family    | Tag                  | Meaning                          |
| --------- | -------------------- | -------------------------------- |
| Nouns     | NNG                  | Common noun                      |
|           | NNP                  | Proper noun                      |
|           | NNB                  | Bound noun (의존명사)               |
|           | NR                   | Numeral                          |
|           | NP                   | Pronoun                          |
| Pre-noun  | MM                   | Determiner (관형사)                 |
| Verbs     | VV                   | Verb                             |
|           | VA                   | Adjective ("descriptive verb")   |
|           | VX                   | Auxiliary verb / adjective       |
|           | VCN                  | Negative copula (아니다)            |
|           | VCP                  | Copula (이다)                      |
| Suffixes  | XPN                  | Noun-prefixing                   |
|           | XSN                  | Noun-forming                     |
|           | XSV                  | Verb-forming                     |
|           | XSA                  | Adjective-forming                |
|           | XR                   | Root                             |
| Endings   | EP                   | Pre-final ending                 |
|           | EF                   | Final ending                     |
|           | EC                   | Connecting ending                |
|           | ETN                  | Nominalizing ending              |
|           | ETM                  | Modifier ending                  |
| Particles | JKS                  | Subject                          |
|           | JKC                  | Complement                       |
|           | JKO                  | Object                           |
|           | JKG                  | Possessive                       |
|           | JKB                  | Adverbial                        |
|           | JKV                  | Vocative                         |
|           | JKQ                  | Quotative                        |
|           | JX                   | Auxiliary (topic, also, only, …) |
|           | JC                   | Connective                       |
| Symbols   | SL                   | Foreign / Latin                  |
|           | SH                   | Hanja                            |
|           | SN                   | Numeral characters               |
|           | SF/SE/SS/SP/SO/SW/SY | Punctuation                      |

---

## The surface-first signal as a multiPrimary trigger

When the surface-first rule fires (rule #1 above), the resulting
candidates array starts with the surface itself. The lemma chain
then goes on to push the individual nouns:

```
candidates(반말) = ['반말', '반', '말']
```

The background fires the top 5 in parallel. For pure-noun
compounds, EVERY constituent that came back with data is a
legitimate "primary" answer for a learner — they hovered "파티원들"
and the dictionary entries for 파티, 원, AND any 파티원-prefixed
compounds are all relevant. The group-by-word algorithm then
naturally surfaces them as separate tabs.

The historical `multiPrimary` boolean signaled this to the popup
renderer, which used to special-case the noun-compound path. With
the group-by-word grouping algorithm (`pickTabsAndUnrelated`), the
boolean is incidental — the same tabbing emerges from the merge
naturally.
