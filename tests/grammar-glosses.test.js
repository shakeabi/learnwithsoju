import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morphemeGloss, isContentMorpheme } from '../extension/grammar-glosses.js';

test('morphemeGloss: form match takes priority over POS gloss', () => {
  assert.match(morphemeGloss('에서', 'JKB'), /from \/ at/);
  assert.equal(morphemeGloss('이', 'JKS'), 'subject marker');
});

test('morphemeGloss: POS-disambiguated forms (을/은/는 are homographs)', () => {
  // 을 as object particle (JKO) vs 을 as future-tense modifier (ETM)
  assert.equal(morphemeGloss('을', 'JKO'), 'object marker');
  assert.equal(morphemeGloss('을', 'ETM'), 'future-tense modifier');
  // 은 as topic particle vs 은 as past-tense modifier
  assert.equal(morphemeGloss('은', 'JX'), 'topic marker');
  assert.equal(morphemeGloss('은', 'ETM'), 'past-tense modifier');
  // 이 as subject particle vs copula
  assert.equal(morphemeGloss('이', 'JKS'), 'subject marker');
  assert.match(morphemeGloss('이', 'VCP'), /copula/);
});

test('morphemeGloss: POS fallback when form is unknown', () => {
  // No form match → falls through to POS_GLOSSES
  assert.equal(morphemeGloss('지짐이', 'NNG'), 'noun');
  assert.equal(morphemeGloss('걸', 'JKO'), 'object particle');
});

test('morphemeGloss: handles merged POS tags by taking lead', () => {
  // mecab merges adjacent morphemes; lead tag drives the gloss
  const gloss = morphemeGloss('습니다', 'EF');
  assert.match(gloss, /formal/);
});

test('morphemeGloss: returns empty string for unknown form + unknown POS', () => {
  assert.equal(morphemeGloss('xyz', 'UNK'), '');
  assert.equal(morphemeGloss('', ''), '');
});

test('morphemeGloss: tolerates null/undefined', () => {
  assert.equal(morphemeGloss(null, null), '');
  assert.equal(morphemeGloss(undefined, undefined), '');
});

test('morphemeGloss: covers verb endings the user actually sees', () => {
  // Smoke-test the common surface forms a learner runs into daily
  const cases = [
    ['었', 'EP'],
    ['겠', 'EP'],
    ['어요', 'EF'],
    ['습니다', 'EF'],
    ['아서', 'EC'],
    ['으면', 'EC'],
    ['어야', 'EC'],
  ];
  for (const [form, pos] of cases) {
    const gloss = morphemeGloss(form, pos);
    assert.ok(gloss.length > 0, `expected gloss for ${form}/${pos}, got empty`);
  }
});

test('isContentMorpheme: drops punctuation marks', () => {
  assert.equal(isContentMorpheme({ form: '.', pos: 'SF' }), false);
  assert.equal(isContentMorpheme({ form: ',', pos: 'SP' }), false);
  assert.equal(isContentMorpheme({ form: '!', pos: 'SF' }), false);
});

test('isContentMorpheme: keeps real morphemes', () => {
  assert.equal(isContentMorpheme({ form: '학교', pos: 'NNG' }), true);
  assert.equal(isContentMorpheme({ form: '먹', pos: 'VV' }), true);
  assert.equal(isContentMorpheme({ form: '에서', pos: 'JKB' }), true);
  assert.equal(isContentMorpheme({ form: '었', pos: 'EP' }), true);
});

test('isContentMorpheme: rejects empty/missing input', () => {
  assert.equal(isContentMorpheme(null), false);
  assert.equal(isContentMorpheme(undefined), false);
  assert.equal(isContentMorpheme({ form: '', pos: 'NNG' }), false);
  assert.equal(isContentMorpheme({ form: '학교', pos: '' }), false);
});

test('isContentMorpheme: keeps SH/SL/SN (Hanja, Latin, numerals)', () => {
  // These are content even though they share the S* prefix with punctuation
  assert.equal(isContentMorpheme({ form: 'Google', pos: 'SL' }), true);
  assert.equal(isContentMorpheme({ form: '韓國', pos: 'SH' }), true);
  assert.equal(isContentMorpheme({ form: '2024', pos: 'SN' }), true);
});
