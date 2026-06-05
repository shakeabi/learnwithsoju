import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGrammar,
  grammarTailForms,
} from '../extension/core/grammar-match.js';

/** @param {string} surface @param {string} pos */
function tok(surface, pos) {
  return { surface, pos };
}

test('grammarTailForms: verb stem + suffix tail', () => {
  const tokens = [tok('먹', 'VV'), tok('었', 'EP'), tok('어요', 'EF')];
  assert.deepEqual(grammarTailForms(tokens), ['었', '어요']);
});

test('resolveGrammar: past polite merges EP + EF (었 + 어요)', () => {
  const tokens = [tok('먹', 'VV'), tok('었', 'EP'), tok('어요', 'EF')];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'past-polite');
  assert.equal(matches[0].display, '~았/었어요');
  assert.equal(matches[0].surface, '었어요');
  assert.ok(Array.isArray(matches[0].fundamentals));
  assert.equal(matches[0].fundamentals.length, 3);
});

test('resolveGrammar: polite present when 어요 is one token', () => {
  const tokens = [tok('하', 'VV'), tok('여요', 'EF')];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'polite-present');
  assert.equal(matches[0].surface, '여요');
});

test('resolveGrammar: polite present when split 어 + 요', () => {
  const tokens = [tok('먹', 'VV'), tok('어', 'EF'), tok('요', 'EF')];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'polite-present');
  assert.equal(matches[0].surface, '어요');
});

test('resolveGrammar: confirming 죠 as single token', () => {
  const tokens = [tok('하', 'VV'), tok('죠', 'EF')];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'confirming-polite');
  assert.match(matches[0].display, /죠/);
});

test('resolveGrammar: confirming 지 + 요 merges into one pattern', () => {
  const tokens = [tok('그렇', 'VA'), tok('지', 'EF'), tok('요', 'EF')];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'confirming-polite');
  assert.equal(matches[0].surface, '지요');
});

test('resolveGrammar: ~기 때문에 multi-morpheme', () => {
  const tokens = [
    tok('먹', 'VV'),
    tok('기', 'ETN'),
    tok('때문', 'NNB'),
    tok('에', 'JKB'),
  ];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'gi-tteumune');
  assert.equal(matches[0].surface, '기때문에');
});

test('resolveGrammar: noun + particle (학교에서)', () => {
  const tokens = [tok('학교', 'NNG'), tok('에서', 'JKB')];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'eseo');
});

test('resolveGrammar: future polite 겠 + 어요', () => {
  const tokens = [tok('하', 'VV'), tok('겠', 'EP'), tok('어요', 'EF')];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'future-polite');
  assert.equal(matches[0].surface, '겠어요');
});

test('resolveGrammar: 네요 merges 네 + 요', () => {
  const tokens = [tok('예쁘', 'VA'), tok('네', 'EF'), tok('요', 'EF')];
  const matches = resolveGrammar(tokens);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'noticed-polite');
  assert.equal(matches[0].surface, '네요');
});

test('resolveGrammar: empty tokens → no matches', () => {
  assert.deepEqual(resolveGrammar([]), []);
  assert.deepEqual(resolveGrammar(null), []);
});
