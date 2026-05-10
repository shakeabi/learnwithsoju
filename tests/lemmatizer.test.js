import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lemmaCandidates } from '../extension/lemmatizer.js';

// Helper to build a token list quickly. Mirrors the shape returned by
// mecab-ko-wasm: { surface, pos, lemma? }.
const tok = (surface, pos, lemma) => ({ surface, pos, lemma });

test('verb stem (VV) becomes stem + 다', () => {
  // 먹었어요 → 먹/VV + 었/EP + 어요/EF
  const tokens = [tok('먹', 'VV'), tok('었', 'EP'), tok('어요', 'EF')];
  const candidates = lemmaCandidates(tokens, '먹었어요');
  assert.equal(candidates[0], '먹다');
  assert.ok(candidates.includes('먹었어요'), 'surface should be present as fallback');
});

test('adjective stem (VA) becomes stem + 다', () => {
  // Single merged token VA+EC: lemma "예뻐요" given as the lemma field
  const tokens = [tok('예뻐요', 'VA+EC', '예뻐요')];
  const candidates = lemmaCandidates(tokens, '예뻐요');
  // Lead tag is VA → push lemma + 다
  assert.equal(candidates[0], '예뻐요다');
  assert.ok(candidates.includes('예뻐요'), 'surface should be a fallback candidate');
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
