import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lemmaCandidates, inflectStem } from '../extension/lemmatizer.js';

// Helper to build a token list quickly. Mirrors the shape returned by
// mecab-ko-wasm: { surface, pos, lemma?, features? }.
const tok = (surface, pos, lemma, features) => ({ surface, pos, lemma, features });

test('verb stem (VV) becomes stem + 다', () => {
  // 먹었어요 → 먹/VV + 었/EP + 어요/EF
  const tokens = [tok('먹', 'VV'), tok('었', 'EP'), tok('어요', 'EF')];
  const candidates = lemmaCandidates(tokens, '먹었어요');
  assert.equal(candidates[0], '먹다');
  assert.ok(candidates.includes('먹었어요'), 'surface should be present as fallback');
});

test('adjective stem from Inflect decomposition resolves to the dictionary form', () => {
  // 예뻐요 is the conjugated form of 예쁘다 (예쁘 + 어요). mecab returns it
  // as a single VA+EC token whose lemma column is just the reading;
  // the real stem (예쁘) is only in the Inflect decomposition at index 7.
  const tokens = [tok(
    '예뻐요', 'VA+EC', '예뻐요',
    'VA+EC,*,F,예뻐요,Inflect,VA,EC,예쁘/VA/*+어요/EC/*',
  )];
  const candidates = lemmaCandidates(tokens, '예뻐요');
  assert.equal(candidates[0], '예쁘다');
  assert.ok(candidates.includes('예뻐요'), 'surface should be a fallback candidate');
});

test('verb stem from Inflect decomposition: 걸려 → 걸리다', () => {
  // The original motivating case: 걸려 (걸리 + 어, contracted).
  const tokens = [tok(
    '걸려', 'VV+EC', '걸려',
    'VV+EC,*,F,걸려,Inflect,VV,EC,걸리/VV/*+어/EC/*',
  )];
  const candidates = lemmaCandidates(tokens, '걸려');
  assert.equal(candidates[0], '걸리다');
});

test('verb stem from Inflect decomposition: 봐요 → 보다, 돼요 → 되다, 해야 → 하다', () => {
  for (const [surface, features, expected] of [
    ['봐요', 'VV+EC,*,F,봐요,Inflect,VV,EC,보/VV/*+아요/EC/*', '보다'],
    ['돼요', 'VV+EC,*,F,돼요,Inflect,VV,EC,되/VV/*+어요/EC/*', '되다'],
    ['해야', 'VV+EC,*,F,해야,Inflect,VV,EC,하/VV/*+아야/EC/*', '하다'],
  ]) {
    const tokens = [tok(surface, 'VV+EC', surface, features)];
    assert.equal(lemmaCandidates(tokens, surface)[0], expected, `${surface} → ${expected}`);
  }
});

test('Inflect with multi-morpheme decomposition still takes the first stem', () => {
  // 가까와 is an irregular form of 가깝다 with a 4-morpheme decomposition.
  const tokens = [tok(
    '가까와', 'VA+EC+VX+EC', '가까와',
    'VA+EC+VX+EC,*,F,가까와,Inflect,VA,EC,가깝/VA/*+어/EC/*+오/VX/*+아/EC/*',
  )];
  const candidates = lemmaCandidates(tokens, '가까와');
  assert.equal(candidates[0], '가깝다');
});

test('non-Inflect features (decomposition = *) fall through to lemma/surface', () => {
  // 먹/VV from 먹었어요 — features end in `,*,*,*,*`, so inflectStem is null.
  const tokens = [tok('먹', 'VV', '먹', 'VV,*,T,먹,*,*,*,*')];
  const candidates = lemmaCandidates(tokens, '먹');
  assert.equal(candidates[0], '먹다');
});

test('compound XSV verb in Inflect form: 예약해야 → 예약하다 first', () => {
  // Real mecab output for 예약해야: NNG + XSV+EC(Inflect=하/XSV/*+아야/EC/*).
  // The compound 예약하다 is the most specific candidate; bare 예약 and
  // standalone 하다 follow as fallbacks.
  const tokens = [
    tok('예약', 'NNG', '예약', 'NNG,행위,T,예약,*,*,*,*'),
    tok('해야', 'XSV+EC', '해야', 'XSV+EC,*,F,해야,Inflect,XSV,EC,하/XSV/*+아야/EC/*'),
  ];
  const candidates = lemmaCandidates(tokens, '예약해야');
  assert.equal(candidates[0], '예약하다');
  assert.ok(candidates.includes('예약'));
  assert.ok(candidates.includes('하다'), '하 + XSV should produce 하다, not 해야다');
  assert.ok(!candidates.includes('해야다'));
  assert.ok(candidates.includes('예약해야'));
});

test('inflectStem: returns null when features is missing, empty, or non-Inflect', () => {
  assert.equal(inflectStem(null), null);
  assert.equal(inflectStem(undefined), null);
  assert.equal(inflectStem(''), null);
  assert.equal(inflectStem('VV,*,T,먹,*,*,*,*'), null);
  // Fewer than 8 fields → null
  assert.equal(inflectStem('VV,*,T,먹'), null);
});

test('inflectStem: extracts the leading stem from the decomposition column', () => {
  assert.equal(
    inflectStem('VV+EC,*,F,걸려,Inflect,VV,EC,걸리/VV/*+어/EC/*'),
    '걸리',
  );
  assert.equal(
    inflectStem('VA+EC,*,F,예뻐요,Inflect,VA,EC,예쁘/VA/*+어요/EC/*'),
    '예쁘',
  );
});

test('inflectStem: returns null for Compound-type tokens (NNG with decomposition)', () => {
  // mecab-ko-dic stores 오랜만 as NNG with a Compound breakdown in column 7.
  // Without the type=Inflect gate we'd return 오랜 here and the lemmatizer
  // would query KRDict for 오랜 instead of 오랜만.
  assert.equal(
    inflectStem('NNG,*,T,오랜만,Compound,NNG,NNG,오랜/NNG/*+만/NNG/*'),
    null,
  );
  // Other non-Inflect types should also return null even if column 7 has
  // content (defensive — covers anything else mecab-ko-dic might store).
  assert.equal(
    inflectStem('NNG,*,T,한국말,Compound,NNP,NNG,한국/NNP/*+말/NNG/*'),
    null,
  );
});

test('NNG with Compound decomposition: surface lemma stays intact', () => {
  // 오랜만이에요 → 오랜만/NNG (Compound) + 이/VCP + 에요/EF. The NNG token's
  // feature column 7 has 오랜/NNG/*+만/NNG/*, but inflectStem must not use
  // that as the stem — the NNG's own surface is the right lemma.
  const tokens = [
    tok('오랜만', 'NNG', '오랜만', 'NNG,*,T,오랜만,Compound,NNG,NNG,오랜/NNG/*+만/NNG/*'),
    tok('이', 'VCP', '이', 'VCP,*,F,이,*,*,*,*'),
    tok('에요', 'EF', '에요', 'EF,*,F,에요,*,*,*,*'),
  ];
  const candidates = lemmaCandidates(tokens, '오랜만이에요');
  assert.equal(candidates[0], '오랜만');
  // The pre-fix bug pushed 오랜 instead — make sure it doesn't reappear.
  assert.ok(!candidates.includes('오랜'));
  assert.ok(candidates.includes('이다'));
});

test('noun (NNG) used directly as lemma', () => {
  const tokens = [tok('학교', 'NNG'), tok('에서', 'JKB')];
  const candidates = lemmaCandidates(tokens, '학교에서');
  assert.equal(candidates[0], '학교');
  assert.ok(candidates.includes('학교에서'));
});

test('noun + plural marker + particle: noun comes first, particle/marker skipped', () => {
  const tokens = [tok('친구', 'NNG'), tok('들', 'XSN'), tok('과', 'JKB')];
  const candidates = lemmaCandidates(tokens, '친구들과');
  assert.equal(candidates[0], '친구');
  // XSN (noun-suffix) should not produce its own candidate; particle JKB is skipped
  assert.ok(!candidates.includes('들'));
  assert.ok(!candidates.includes('과'));
});

test('compound noun split by mecab — full surface leads, parts follow', () => {
  // 한국말 → 한국/NNP + 말/NNG. KRDict has both 한국말 (compound) and 한국
  // (just "Korea"). The user almost always wants the compound when they
  // hover the whole word, so the full surface goes first.
  const tokens = [tok('한국', 'NNP'), tok('말', 'NNG')];
  const candidates = lemmaCandidates(tokens, '한국말');
  assert.deepEqual(candidates, ['한국말', '한국', '말']);
});

test('compound NNG+NNG: 반말 → 반말 first (was matching 반 alone before)', () => {
  // 반말 → 반/NNG + 말/NNG. KRDict has both 반 (half) and 반말 (informal
  // speech). The compound is what the user hovered.
  const tokens = [tok('반', 'NNG'), tok('말', 'NNG')];
  const candidates = lemmaCandidates(tokens, '반말');
  assert.equal(candidates[0], '반말');
  assert.ok(candidates.includes('반'));
  assert.ok(candidates.includes('말'));
});

test('compound NNG+NNG: 무조건 → 무조건 first (was matching 무 alone before)', () => {
  // 무조건 → 무/NNG + 조건/NNG when mecab doesn't recognize the whole as MAG.
  const tokens = [tok('무', 'NNG'), tok('조건', 'NNG')];
  const candidates = lemmaCandidates(tokens, '무조건');
  assert.equal(candidates[0], '무조건');
  assert.ok(candidates.includes('무'));
  assert.ok(candidates.includes('조건'));
});

test('noun + plural marker (no particle): 친구들 → 친구들 first', () => {
  // 친구/NNG + 들/XSN. Both are noun-like (no particle), so the full
  // surface is the leading candidate. KRDict probably has no entry for
  // "친구들" specifically, but trying it costs little and lets us catch
  // anything that happens to be indexed as a plural lexeme.
  const tokens = [tok('친구', 'NNG'), tok('들', 'XSN')];
  const candidates = lemmaCandidates(tokens, '친구들');
  assert.equal(candidates[0], '친구들');
  assert.ok(candidates.includes('친구'));
});

test('compound NNG+XSV: 공부하다 is the first candidate', () => {
  // 공부하다 → 공부/NNG + 하/XSV + 다/EF.
  // The compound (most specific) leads; bare 공부 and standalone 하다 follow.
  const tokens = [tok('공부', 'NNG'), tok('하', 'XSV'), tok('다', 'EF')];
  const candidates = lemmaCandidates(tokens, '공부하다');
  assert.equal(candidates[0], '공부하다');
  assert.ok(candidates.includes('공부'));
  assert.ok(candidates.includes('하다'));
});

test('compound NNG+XSV in inflected surface: 어색하려고 → 어색하다 first', () => {
  // 어색하려고 → 어색/NNG + 하/XSV + 려고/EC.
  // Previously emitted [어색, 하다, 어색하려고]; "어색" had no KRDict entry
  // and "하다" hit, so the popup showed the wrong headword. The compound
  // is the right answer.
  const tokens = [tok('어색', 'NNG'), tok('하', 'XSV'), tok('려고', 'EC')];
  const candidates = lemmaCandidates(tokens, '어색하려고');
  assert.equal(candidates[0], '어색하다');
  assert.ok(candidates.includes('어색'));
  assert.ok(candidates.includes('하다'));
  assert.ok(candidates.includes('어색하려고'));
});

test('compound XR+XSA: 깨끗하다 — XR alone is not a candidate', () => {
  // 깨끗/XR + 하/XSA + 다/EF — root + adjective-deriving suffix.
  const tokens = [tok('깨끗', 'XR'), tok('하', 'XSA'), tok('다', 'EF')];
  const candidates = lemmaCandidates(tokens, '깨끗하다');
  assert.equal(candidates[0], '깨끗하다');
  // XR by itself isn't a real word; it should not appear as a candidate.
  assert.ok(!candidates.includes('깨끗'));
  // The XSA-derived 하다 is still a fallback candidate.
  assert.ok(candidates.includes('하다'));
});

test('compound MM+NNB+XSV (한잔해): full noun-phrase prefix combines with the verb-deriving suffix', () => {
  // 한잔해 → 한/MM + 잔/NNB + 해/XSV+EC (Inflect = 하/XSV/*+어/EF/*)
  // Without the wider prefix rule we used to only produce "하다" — the
  // 한 / 잔 part fell off because MM and NNB weren't in the base set.
  const tokens = [
    tok('한', 'MM'),
    tok('잔', 'NNB'),
    tok('해', 'XSV+EC', '해', 'XSV+EC,*,F,해,Inflect,XSV,EC,하/XSV/*+어/EC/*'),
  ];
  const candidates = lemmaCandidates(tokens, '한잔해');
  assert.equal(candidates[0], '한잔하다');
  // The standalone "하다" is still a fallback.
  assert.ok(candidates.includes('하다'));
});

test('NNG followed by something other than XSV/XSA does not produce a compound', () => {
  // 학교에서 → 학교/NNG + 에서/JKB. No compound — JKB is a particle.
  const tokens = [tok('학교', 'NNG'), tok('에서', 'JKB')];
  const candidates = lemmaCandidates(tokens, '학교에서');
  assert.equal(candidates[0], '학교');
  // No accidental "학교에서다" or similar.
  for (const c of candidates) assert.ok(!c.endsWith('에서다'));
});

test('merged POS tags split on `+`, leading tag determines role', () => {
  // 갔/VV+EP — leading tag is VV; treat as verb stem
  const tokens = [tok('갔', 'VV+EP'), tok('습니다', 'EF')];
  const candidates = lemmaCandidates(tokens, '갔습니다');
  assert.equal(candidates[0], '갔다');
});

test('loanword (SL) is treated as a noun', () => {
  const tokens = [tok('Google', 'SL')];
  const candidates = lemmaCandidates(tokens, 'Google');
  assert.equal(candidates[0], 'Google');
});

test('numeral (SN) is treated as a noun', () => {
  const tokens = [tok('2024', 'SN'), tok('년', 'NNB')];
  const candidates = lemmaCandidates(tokens, '2024년');
  assert.equal(candidates[0], '2024');
});

test('particle-only / ending-only token lists fall through to surface', () => {
  const tokens = [tok('을', 'JKO')];
  const candidates = lemmaCandidates(tokens, '을');
  assert.deepEqual(candidates, ['을']);
});

test('empty / null tokens still yield the surface as a candidate', () => {
  assert.deepEqual(lemmaCandidates([], '사람'), ['사람']);
  assert.deepEqual(lemmaCandidates(null, '사람'), ['사람']);
  assert.deepEqual(lemmaCandidates(undefined, '사람'), ['사람']);
});

test('empty surface and empty tokens → empty list', () => {
  assert.deepEqual(lemmaCandidates([], ''), []);
  assert.deepEqual(lemmaCandidates([], null), []);
});

test('candidates are deduplicated, insertion order preserved', () => {
  // Verb stem 먹 plus a token whose lemma is also 먹다 — candidate should
  // appear once.
  const tokens = [tok('먹', 'VV'), tok('먹', 'VV')];
  const candidates = lemmaCandidates(tokens, '먹');
  // Dedupe: 먹다 appears once even though two VV tokens; surface 먹 is fallback
  assert.equal(candidates.filter((c) => c === '먹다').length, 1);
});

test('noun.lemma takes priority over noun.surface when both exist', () => {
  // Hypothetical: surface and lemma differ (rare for nouns but possible)
  const tokens = [tok('학교들', 'NNG', '학교')];
  const candidates = lemmaCandidates(tokens, '학교들');
  assert.equal(candidates[0], '학교');
});

test('verb stem already ending in 다 is not double-suffixed', () => {
  // Defensive: if mecab returned a stem already ending in 다, don't append
  // another 다 (would produce 먹다다)
  const tokens = [tok('먹다', 'VV', '먹다')];
  const candidates = lemmaCandidates(tokens, '먹다');
  assert.ok(!candidates.includes('먹다다'));
  assert.equal(candidates[0], '먹다');
});
