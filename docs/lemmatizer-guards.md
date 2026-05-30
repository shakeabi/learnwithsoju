# Adding a lemmatizer guard

This is the **how-to walkthrough** for adding a heuristic to
`extension/core/lemmatizer.js` when you spot a Korean word that's being
mis-lemmatized. For the *reference* description of the existing
candidate-ordering rules — including the full `inflectStem` story, the
two pure-noun-compound rules, the per-tag families, and the
proper-noun synthesis story — see [`LEMMATIZATION.md`](LEMMATIZATION.md).

The goal of this guide is that you should be able to find a mis-
lemmatized word, narrow it to a specific morphological pattern, write a
guard, and ship it with a regression test.

---

## What a guard is

A guard is a small piece of code in `lemmaCandidates()` (in
`core/lemmatizer.js`) that overrides mecab-ko-dic's default lemma
derivation for a specific morphological pattern. The guard either pushes
an extra candidate before the default one (preferred — keeps the
default as a fallback) or replaces it outright.

Guards always push the **pedagogically preferred** lemma first. Top-5
candidates are sent to KRDict in parallel, and the popup's tab-grouping
algorithm shows the first hit as the active tab, so order matters.

---

## Why guards exist

mecab-ko-dic is etymologically correct but pedagogically wrong in a few
cases:

- Single-syllable surface `가` (the verb stem of 가다 "to go") gets
  decomposed via phantom ㄹ-deletion to `갈` (the stem of 갈다 "to
  grind"). Etymologically defensible; useless for a learner.
- VCP (copula `이다`) tokens come through with the surface as the
  "stem" — e.g. surface `였` with decomp stem `이`. The default
  inflect-stem extraction would produce `였다`, which isn't a word.
- Pure noun compounds get split into pieces — `오랜만` becomes
  `오래` + `만`. Without a guard, the per-token loop pushes `오래` as
  the primary noun candidate.

Each of these patterns has a guard that pushes the right thing first
while keeping the default as a fallback for the (rare) cases where the
default really is what the user wanted.

---

## Existing guards

| Guard | Pattern | Reference commit |
|---|---|---|
| **Compound-noun-first push** | When *every* token is in `COMPOUND_NOUN_TAGS` (NNG / NNP / NR / NP / XSN), push the surface BEFORE walking pieces. | `960be52` |
| **Compound-prefix accumulator** | Walk left-to-right, accumulate prefix surface from `COMPOUND_PREFIX_TAGS` (adds MM / NNB / XR); when an XSV / XSA is hit, push `prefix + stem + 다`. | (initial) |
| **Ambiguous-ㄹ guard scoped to VV/VA** | When VV/VA token has single-syllable surface AND single-syllable decomp stem AND they differ, push `surface + 다` first. Excludes VCP / VCN so 이다 / 아니다 never get clobbered. | `5bb9e2d` |
| **Inflect gate on `inflectStem`** | `inflectStem` returns null unless `type === 'Inflect'`, so Compound-type nouns (오랜만, 한국말) keep their `lemma` instead of having sub-stems extracted. | (initial) |
| **Proper-noun NNP synthesis** | Per-NNP-run synthesis in `background.js` (not `lemmatizer.js`): for each run of consecutive NNP tokens not covered by a real dict tab, prepend a synthetic "고유명사" tab. | `b905bbc` |
| **n-best cost-delta filter** | In `background.js`: drop n-best paths whose additive cost delta from the 1-best exceeds 5000 (~10^21× less probable) before candidate derivation. | `e4bc2fa` |

Read [`LEMMATIZATION.md`](LEMMATIZATION.md) for the full per-guard
rationale and the why-VCP-is-excluded story.

---

## Anatomy of a guard — the ambiguous-ㄹ guard as a template

The ambiguous-ㄹ guard is the cleanest example of "push preferred first,
keep fallback." Here's its shape:

**1. Constant set** at the top of `lemmatizer.js`:

```js
const AMBIGUOUS_L_TAGS = new Set(['VV', 'VA']);
```

Scoping to VV / VA only — VCP / VCN / VX / XSV / XSA are excluded
because their lemma is always 이다 / 아니다 / etc., never the surface.

**2. Per-token check** inside `lemmaCandidates`'s per-token loop:

```js
if (AMBIGUOUS_L_TAGS.has(tag) &&
    decompStem && tSurface && decompStem !== tSurface
    && decompStem.length === 1 && tSurface.length === 1) {
  push(tSurface + '다');     // 가다 first
  push(decompStem + '다');   // 갈다 as fallback
} else {
  push(stem.endsWith('다') ? stem : stem + '다');
}
```

**3. Regression tests** in `tests/lemmatizer.test.js`:

- Positive case: 가/VV with Inflect stem 갈 → 가다 first.
- Positive case (different verb): 사/VV with stem 살 → 사다 first.
- Negative case (multi-syllable): 봐요 → 보다 (guard skips).
- Negative case (stems equal): 갈/VV with stem 갈 → 갈다 only (guard skips).
- Negative case (wrong POS family): 였/VCP with stem 이 → 이다 first, 였다 never (guard scoped out).

That last test is what caught the regression that motivated the VV/VA
scoping in commit `5bb9e2d` — without it, 그거였어요 was resolving to
the nonsense lemma 였다.

---

## How to add a new guard

### Step 1: identify the failure case

Find a Korean surface that's mis-lemmatized. The signal is usually
either:

- A learner hovers a word and the popup's primary tab is for a different
  word than what they expected.
- A KRDict query for the candidate returns "no entry" when the word is
  in everyday use — suggesting we're querying a non-word lemma.

Write the failure case down precisely: **surface in context** (the full
sentence helps, since context affects mecab's parse), **what we got**,
and **what we expected**.

### Step 2: inspect the mecab output via the morpheme inspector page

The extension ships with a morpheme inspector page at
`extension/pages/morpheme-inspector/morpheme-inspector.html` (also
reachable from Options → Advanced → "Open morpheme inspector"). Paste
the surface and see every mecab field for every token: `pos`, `lemma`,
`features` (including the decomposition column), `start`, `end`.

If the issue only appears in a wider context (e.g. the same surface
parses differently inside a longer sentence because adjacent tokens
change the n-best ranking), paste the full sentence and look at the
token for your target surface.

### Step 3: identify the pattern

Some questions to answer:

- **Is it a tag mismatch?** Is mecab labeling the surface as VV when it
  should be VCP, or vice versa?
- **Is it the `decomposition` column?** Compare `features.split(',')[7]`
  to what you'd expect.
- **Is it a specific irregular conjugation** the dictionary stores
  whole? (Type=Inflect; see [`LEMMATIZATION.md`](LEMMATIZATION.md) §
  "What mecab gives us".)
- **Is it a compound that should be kept whole?** Or split?
- **Is it the n-best ranking — does the 2nd or 3rd best path have the
  right answer?** If so, the fix may be upstream (cost-delta cap,
  per-path candidate ordering) rather than in `lemmatizer.js`.

The pattern should be expressible as "when token has `<tag>` AND
`<feature condition>` AND `<surface condition>`, push `<X>` first".

### Step 4: write the guard

If the pattern needs a new tag-family check, add a `const` set at the
top of `lemmatizer.js` (next to `AMBIGUOUS_L_TAGS`, `VERB_LEAD_TAGS`,
etc.) — keeps it discoverable.

Add the per-token check inside `lemmaCandidates`'s loop. **Always push
the preferred lemma first; keep the default as a fallback** unless
you're 100% sure the default is never right (rare).

Keep the guard narrow. The wider you make the condition, the more
likely it is to fire on a case you didn't anticipate.

### Step 5: write a regression test in `tests/lemmatizer.test.js`

The existing ambiguous-ㄹ tests are the template. Synthesize the mecab
output by hand (use the `tok()` helper at the top of the file) so the
test doesn't depend on a real mecab being available. Mirror the
`features` string format exactly — pos, semantic, jongseong, reading,
type, first_pos, last_pos, decomposition (comma-separated).

Cover at minimum:

- The **positive case** the guard was written for.
- A **negative case where the guard must NOT fire** — usually a tag
  outside the guard's scope, or a feature condition that doesn't hold.
- If the guard interacts with the inflect-stem path or the
  compound-prefix accumulator, a **mixed-case test** showing the two
  systems compose correctly.

### Step 6: verify

```bash
npm test
```

The full suite should still pass — your guard shouldn't have regressed
any of the existing cases. The 5 ambiguous-ㄹ tests, the
compound-noun-first tests, the Inflect-gate tests, and the VCP-protection
test are the load-bearing ones to watch.

If you can, also load the unpacked extension in Chrome (see
[`CONTRIBUTING.md`](../CONTRIBUTING.md)) and hover the original failure
case on a real page — confirm the popup now shows the right tab.

---

## Categories of guards we don't have but might need

The table below is a structured reference of test cases for *future*
guards. Each row is a surface that exposes an interesting mecab quirk;
hover it in the morpheme inspector to see what mecab produces.

### 1. 르-irregular

Stem ends in 르; before -아/어 the 르 becomes ㄹ + ㄹ (gemination) and
the surface gets ᄅ + ㅓ ending. Mecab may decompose to a single-syllable
bare stem matching a different verb.

| Surface (in context) | Correct lemma | Likely trap |
|---|---|---|
| 불러요 (calling / singing) | 부르다 | 불다 (to blow) |
| 달려요 (running) | 달리다 | (달다 = "sweet") |
| 몰라요 (don't know) | 모르다 | 몰다 (to drive) |
| 흘러요 (flowing) | 흐르다 | — |
| 눌러요 (pressing) | 누르다 | 눌다 (to scorch) |

A guard here would mirror the existing ambiguous-ㄹ guard but for
multi-syllable verbs whose 르-stem maps to a different bare-stem verb.

### 2. ㅂ-irregular

Stem ends in ㅂ; before vowel endings ㅂ becomes 우 → contracted with
the following vowel.

| Surface | Correct lemma | Note |
|---|---|---|
| 추워요 (cold) | 춥다 | usually handled |
| 더워서 (because hot) | 덥다 | usually handled |
| 즐거워 (joyful) | 즐겁다 | usually handled |
| 도와줘요 (help me) | 돕다 | 도와 is special (ㅂ→오, not 우) |
| 고와요 (pretty) | 곱다 | 고와 → same ㅂ→오 special case |

### 3. ㄷ-irregular (real ambiguity with ㄹ-stem verbs)

ㄷ-stem changes to ㄹ before vowel; collides with actual ㄹ-stem verbs.
Not a mecab bug — an inherent ambiguity. A guard should surface BOTH for
rows with two real lemmas.

| Surface | Possible lemmas | Note |
|---|---|---|
| 들어요 | 듣다 (to listen) OR 들다 (to enter / hold / cost) | both real |
| 걸어요 | 걷다 (to walk) OR 걸다 (to hang / bet) | both real |
| 물어요 | 묻다 (to ask) OR 물다 (to bite) | both real |
| 실어요 | 싣다 (to load) | single answer |
| 들어왔어요 | 들어오다 (to come in) | compound verb |

### 4. Causative / passive -이- / -히- / -리- / -기-

Suffix between stem and ending; produces a derived verb. Learner may
want both the base verb AND the derived form.

| Surface | Active (base) | Causative / passive |
|---|---|---|
| 보여요 | 보다 (to see) | 보이다 (to be shown / show) |
| 들려요 | 듣다 (to hear) | 들리다 (to be heard) |
| 먹여요 | 먹다 (to eat) | 먹이다 (to feed) |
| 입혀요 | 입다 (to wear) | 입히다 (to dress) |
| 잡혀요 | 잡다 (to catch) | 잡히다 (to be caught) |
| 웃겨요 | 웃다 (to laugh) | 웃기다 (to make laugh) |

### 5. Honorific -시-

Pre-final ending; mecab usually strips it cleanly. Trap is when it
surfaces as the lemma `〇시다`.

| Surface | Correct lemma | Wrong trap |
|---|---|---|
| 가십니다 | 가다 | 가시다 (only correct in archaic "leaves world") |
| 오십니다 | 오다 | 오시다 |
| 드십니다 | 들다 (honorific for 먹다) | 드시다 |
| 계십니다 | 있다 (or 계시다 — debatable; 계시다 IS a separate honorific lemma) | flag for review |
| 주무세요 | 자다 (or 주무시다) | 주무세다 |
| 잡수십니다 | 먹다 (or 잡수시다) | — |
| 안녕하세요 | 안녕하다 | 안녕시다 |

### 6. Aux verb chains

Two verbs joined; mecab segments correctly but learner may want the
compound meaning recognized.

| Surface | Components | Compound semantics |
|---|---|---|
| 해주다 | 하다 + 주다 | "do for someone" — directional |
| 해보다 | 하다 + 보다 | "try doing" — attempt |
| 해놓다 | 하다 + 놓다 | "do in advance" — preparatory |
| 가버렸어요 | 가다 + 버리다 | regret / finality nuance |
| 먹고 있어요 | 먹다 + 있다 (progressive) | "is eating" |
| 먹어 봤어요 | 먹다 + 보다 (experience) | "have tried eating" |
| 해야 돼요 | 하다 + 되다 (obligation) | "have to do" |

### 7. Sino-Korean compounds with shared characters

Mecab will split; need to surface both the compound AND the parts as
candidates. The existing compound-noun-first guard should already handle
most of these — verify before writing more.

| Surface | Parts | Best lemma |
|---|---|---|
| 학교 | 학 + 교 | 학교 ("school") |
| 한국어 | 한국 + 어 | 한국어; also 한국 |
| 대학생 | 대학 + 생 | 대학생; also 대학, 학생 |
| 학생회장 | 학생 + 회 + 장 | layered compound |
| 김치찌개 | 김치 + 찌개 | 김치찌개; both independent |

### 8. Numbers + counters

Native vs Sino numerals + counter noun. Mecab usually segments cleanly
but the counter alone is rarely useful, and the numeral on its own never
is.

| Surface | Mecab segments | What learner wants |
|---|---|---|
| 한 마리 | 한 + 마리 | 마리 (counter for animals) |
| 두 개 | 두 + 개 | 개 (general counter) |
| 세 명 | 세 + 명 | 명 (counter for people) |

Possible guard: filter out the numeral, only query the counter.

### 9. Negation

| Surface | Trap / desired behavior |
|---|---|
| 안 가요 | should query 가다, not 안가다 |
| 가지 않아요 | should query 가다 AND 않다 |
| 못 해요 | should query 하다, not 못하다 (debatable) |

---

## Tips

- **mecab-ko-dic already handles most irregulars** in its `decomposition`
  column. Verify with the morpheme inspector before writing a guard —
  the guard is only needed when the dic's preferred lemma is
  **pedagogically wrong**, not just an alternative.
- **The guard should fire when the dic's pick is wrong, not when it's
  unusual.** If both readings are real and roughly equally common, push
  both (e.g. 들어요 → both 듣다 AND 들다). If only one is the right
  answer in everyday use, push that one first and keep the other as a
  fallback (the ambiguous-ㄹ guard pattern).
- **Always push the preferred lemma first** — KRDict queries fire in
  parallel for the top 5 candidates, and the grouping algorithm shows
  the first hit as the active tab. Push order = display order.
- **Add a regression test that mimics the actual mecab output.** Use
  the `tok()` helper at the top of `tests/lemmatizer.test.js` and
  hand-construct the `features` string. The test exercises
  `lemmaCandidates` as a pure function, no mecab dependency.
- **Diagnostic logging**: setting `LWS_NBEST_DIAG = true` at the top of
  `core/lemmatizer.js` makes `lemmaCandidatesFromNbest` log every
  path's candidates and the final merged list. Useful when a guard
  fires correctly on one path but the merged order is still wrong
  because an earlier path pushed the bad candidate first.
- **If the issue is in n-best ranking** (the right answer is on path 2
  or 3 but mecab's 1-best is wrong), the fix may be in
  `background.js`'s `filterPathsByCost` or `pickTopNDistinct` rather
  than in `lemmatizer.js`. Don't shoehorn a guard for what is really a
  ranking issue.
