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

test('compound XSV verb in Inflect form: 예약해야 → 예약, 하다, 예약해야', () => {
  // Real mecab output for 예약해야: NNG + XSV+EC(Inflect=하/XSV/*+아야/EC/*)
  const tokens = [
    tok('예약', 'NNG', '예약', 'NNG,행위,T,예약,*,*,*,*'),
    tok('해야', 'XSV+EC', '해야', 'XSV+EC,*,F,해야,Inflect,XSV,EC,하/XSV/*+아야/EC/*'),
  ];
  const candidates = lemmaCandidates(tokens, '예약해야');
  assert.equal(candidates[0], '예약');
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

test('compound noun split by mecab — noun parts surface, full word as fallback', () => {
  // 한국말 → 한국/NNP + 말/NNG
  const tokens = [tok('한국', 'NNP'), tok('말', 'NNG')];
  const candidates = lemmaCandidates(tokens, '한국말');
  assert.deepEqual(candidates, ['한국', '말', '한국말']);
});

test('compound verb (공부하다 in surface form): noun + verb-suffix + ending', () => {
  // 공부하다 → 공부/NNG + 하/XSV + 다/EF
  const tokens = [tok('공부', 'NNG'), tok('하', 'XSV'), tok('다', 'EF')];
  const candidates = lemmaCandidates(tokens, '공부하다');
  // Noun 공부 first, then XSV-stem 하 → 하다, then surface fallback
  assert.equal(candidates[0], '공부');
  assert.ok(candidates.includes('하다'));
  assert.ok(candidates.includes('공부하다'));
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
