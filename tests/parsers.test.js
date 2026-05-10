import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import {
  parseKrdictXml,
  parseOpendictXml,
  filterTranslations,
  gradeToStars,
  gradeToTooltip,
  posToEnglish,
  posToShortform,
} from '../extension/parsers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

test('parseKrdictXml: parses single entry with translations', () => {
  const xml = fixture('krdict-sample.xml');
  const entries = parseKrdictXml(xml, DOMParser);
  assert.equal(entries.length, 1);

  const e = entries[0];
  assert.equal(e.word, '먹다');
  assert.equal(e.pronunciation, '먹따');
  assert.equal(e.pos, '동사');
  assert.equal(e.grade, '초급');
  assert.equal(e.senses.length, 2);

  const sense1 = e.senses[0];
  assert.match(sense1.definition, /음식/);
  assert.equal(sense1.translations.length, 1);
  assert.equal(sense1.translations[0].trans_word, 'to eat');
  assert.match(sense1.translations[0].trans_dfn, /ingest/);
});

test('parseKrdictXml: handles multi-entry response', () => {
  const xml = fixture('krdict-multi.xml');
  const entries = parseKrdictXml(xml, DOMParser);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => e.word), ['가다', '학교', '난해하다']);
  assert.deepEqual(entries.map((e) => e.pos), ['동사', '명사', '형용사']);
  assert.equal(entries[1].origin, '學校');
});

test('parseKrdictXml: empty response yields empty array', () => {
  const entries = parseKrdictXml(fixture('krdict-empty.xml'), DOMParser);
  assert.deepEqual(entries, []);
});

test('parseKrdictXml: error response yields empty array (caller handles error separately)', () => {
  const entries = parseKrdictXml(fixture('krdict-error.xml'), DOMParser);
  assert.deepEqual(entries, []);
});

test('parseKrdictXml: tolerates null/empty input', () => {
  assert.deepEqual(parseKrdictXml('', DOMParser), []);
  assert.deepEqual(parseKrdictXml(null, DOMParser), []);
  assert.deepEqual(parseKrdictXml(undefined, DOMParser), []);
});

test('parseKrdictXml: tolerates malformed XML', () => {
  const result = parseKrdictXml('<not really xml<<<', DOMParser);
  // We don't crash; we either return [] or an array (depending on parser leniency).
  assert.ok(Array.isArray(result));
});

test('parseKrdictXml: pulls examples out of nested <example> wrappers, dedupes, preserves order', () => {
  const entries = parseKrdictXml(fixture('krdict-with-examples.xml'), DOMParser);
  assert.equal(entries.length, 1);
  const senses = entries[0].senses;
  assert.equal(senses.length, 2);
  // Sense 1: three examples (two sentences + one phrase), in source order.
  assert.deepEqual(senses[0].examples, [
    '아침에 밥을 먹었어요.',
    '그 식당에서 김치찌개를 먹었어요.',
    '맛있게 먹다',
  ]);
  // Sense 2: one example.
  assert.deepEqual(senses[1].examples, ['아버지는 담배를 먹지 않으세요.']);
});

test('parseKrdictXml: senses without <example> get an empty examples array', () => {
  const entries = parseKrdictXml(fixture('krdict-sample.xml'), DOMParser);
  for (const e of entries) {
    for (const s of e.senses) {
      assert.deepEqual(s.examples, []);
    }
  }
});

test('parseKrdictXml: missing optional fields default to empty string', () => {
  const xml = `<?xml version="1.0"?><channel><total>1</total><item><word>x</word></item></channel>`;
  const entries = parseKrdictXml(xml, DOMParser);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].word, 'x');
  assert.equal(entries[0].pronunciation, '');
  assert.equal(entries[0].pos, '');
  assert.equal(entries[0].grade, '');
  assert.equal(entries[0].origin, '');
  assert.deepEqual(entries[0].senses, []);
});

test('parseOpendictXml: parses sample, surfaces multilingual translations', () => {
  const entries = parseOpendictXml(fixture('opendict-sample.xml'), DOMParser);
  assert.equal(entries.length, 2);

  const school = entries[0];
  assert.equal(school.word, '학교');
  assert.equal(school.pos, '명사');
  assert.equal(school.origin, '學校');
  assert.equal(school.senses.length, 1);
  assert.match(school.senses[0].definition, /학습하는 곳/);
  // Multiple translation_info blocks come back in source order
  assert.equal(school.senses[0].translations.length, 2);
  assert.equal(school.senses[0].translations[0].trans_word, 'school');
  assert.equal(school.senses[0].translations[0].language_type, '영어');
  assert.equal(school.senses[0].translations[1].language_type, '중국어');

  const ai = entries[1];
  assert.equal(ai.word, '인공지능');
  assert.equal(ai.origin, '人工知能');
  assert.match(ai.senses[0].translations[0].trans_word, /artificial intelligence/);
});

test('parseOpendictXml: empty/null/error input returns []', () => {
  assert.deepEqual(parseOpendictXml('', DOMParser), []);
  assert.deepEqual(parseOpendictXml(null, DOMParser), []);
  assert.deepEqual(parseOpendictXml(undefined, DOMParser), []);
});

test('parseOpendictXml: tolerates missing translation_info', () => {
  const xml = `<?xml version="1.0"?><channel><total>1</total><item><word>x</word><sense><definition>d</definition><pos>명사</pos></sense></item></channel>`;
  const entries = parseOpendictXml(xml, DOMParser);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pos, '명사');
  assert.deepEqual(entries[0].senses[0].translations, []);
});

test('parseOpendictXml: falls back from <language_type> to <trans_lang> if API switches', () => {
  const xml = `<?xml version="1.0"?><channel><total>1</total><item><word>x</word><sense><translation_info><trans_word>w</trans_word><trans_lang>영어</trans_lang></translation_info></sense></item></channel>`;
  const entries = parseOpendictXml(xml, DOMParser);
  assert.equal(entries[0].senses[0].translations[0].language_type, '영어');
});

test('filterTranslations: picks English by 영어 or English keyword', () => {
  const trs = [
    { trans_word: 'school', language_type: '영어' },
    { trans_word: '学校', language_type: '중국어' },
    { trans_word: 'gakkō', language_type: 'Japanese' },
  ];
  const en = filterTranslations(trs, 'en');
  assert.equal(en.length, 1);
  assert.equal(en[0].trans_word, 'school');
});

test('filterTranslations: arbitrary language strings work as a regex source', () => {
  const trs = [
    { language_type: '영어' },
    { language_type: '독일어' }, // German
  ];
  assert.equal(filterTranslations(trs, '독일').length, 1);
});

test('filterTranslations: handles non-array input safely', () => {
  assert.deepEqual(filterTranslations(null, 'en'), []);
  assert.deepEqual(filterTranslations(undefined, 'en'), []);
});

test('gradeToStars: maps Korean grade labels', () => {
  assert.equal(gradeToStars('초급'), '★★★');
  assert.equal(gradeToStars('중급'), '★★');
  assert.equal(gradeToStars('고급'), '★');
});

test('gradeToStars: maps English equivalents (case-insensitive)', () => {
  assert.equal(gradeToStars('Beginner'), '★★★');
  assert.equal(gradeToStars('intermediate'), '★★');
  assert.equal(gradeToStars('ADVANCED'), '★');
});

test('gradeToStars: returns empty string for unknown / missing values', () => {
  assert.equal(gradeToStars(''), '');
  assert.equal(gradeToStars(null), '');
  assert.equal(gradeToStars(undefined), '');
  assert.equal(gradeToStars('mystery'), '');
});

test('gradeToTooltip: maps each grade to a descriptive tooltip', () => {
  assert.match(gradeToTooltip('초급'), /Beginner/);
  assert.match(gradeToTooltip('중급'), /Intermediate/);
  assert.match(gradeToTooltip('고급'), /Advanced/);
  // Includes the localized grade label too so monolingual readers see it
  assert.match(gradeToTooltip('초급'), /초급/);
});

test('gradeToTooltip: empty / null / unknown', () => {
  assert.equal(gradeToTooltip(''), '');
  assert.equal(gradeToTooltip(null), '');
  assert.equal(gradeToTooltip(undefined), '');
  // Unknown values pass through as-is (better than disappearing)
  assert.equal(gradeToTooltip('weird'), 'weird');
});

test('posToEnglish: maps the major KRDict POS strings', () => {
  const cases = [
    ['명사', 'Noun'],
    ['동사', 'Verb'],
    ['형용사', 'Adjective'],
    ['부사', 'Adverb'],
    ['관형사', 'Determiner'],
    ['대명사', 'Pronoun'],
    ['조사', 'Particle'],
    ['감탄사', 'Interjection'],
    ['수사', 'Numeral'],
  ];
  for (const [ko, en] of cases) {
    assert.equal(posToEnglish(ko), en);
  }
});

test('posToEnglish: handles spaced and unspaced bound-noun variants', () => {
  assert.equal(posToEnglish('의존 명사'), 'Bound Noun');
  assert.equal(posToEnglish('의존명사'), 'Bound Noun');
  assert.equal(posToEnglish('보조 동사'), 'Auxiliary Verb');
  assert.equal(posToEnglish('보조동사'), 'Auxiliary Verb');
});

test('posToEnglish: covers the affix family (접사, 접두사, 접미사)', () => {
  assert.equal(posToEnglish('접사'), 'Affix');
  assert.equal(posToEnglish('접두사'), 'Prefix');
  assert.equal(posToEnglish('접미사'), 'Suffix');
});

test('posToEnglish: phrase-level POS (mainly OpenDict)', () => {
  assert.equal(posToEnglish('명사구'), 'Noun Phrase');
  assert.equal(posToEnglish('동사구'), 'Verb Phrase');
  assert.equal(posToEnglish('형용사구'), 'Adjective Phrase');
  assert.equal(posToEnglish('부사구'), 'Adverb Phrase');
});

test('posToEnglish: idiom / proverb POS', () => {
  assert.equal(posToEnglish('관용구'), 'Idiom');
  assert.equal(posToEnglish('속담'), 'Proverb');
});

test('posToEnglish: unknown values pass through unchanged', () => {
  assert.equal(posToEnglish('unknown-tag'), 'unknown-tag');
  assert.equal(posToEnglish('verbal-noun'), 'verbal-noun');
});

test('posToEnglish: empty / null', () => {
  assert.equal(posToEnglish(''), '');
  assert.equal(posToEnglish(null), '');
  assert.equal(posToEnglish(undefined), '');
});

test('posToEnglish: trims surrounding whitespace before lookup', () => {
  assert.equal(posToEnglish('  명사  '), 'Noun');
});

test('posToShortform: English abbreviations for common POS', () => {
  assert.equal(posToShortform('명사', 'en'), 'n.');
  assert.equal(posToShortform('동사', 'en'), 'v.');
  assert.equal(posToShortform('형용사', 'en'), 'adj.');
  assert.equal(posToShortform('부사', 'en'), 'adv.');
  assert.equal(posToShortform('관형사', 'en'), 'det.');
  assert.equal(posToShortform('수사', 'en'), 'num.');
  assert.equal(posToShortform('의존 명사', 'en'), 'b. n.');
  assert.equal(posToShortform('보조 동사', 'en'), 'aux. v.');
  assert.equal(posToShortform('접사', 'en'), 'aff.');
  assert.equal(posToShortform('접두사', 'en'), 'pref.');
  assert.equal(posToShortform('접미사', 'en'), 'suff.');
  assert.equal(posToShortform('명사구', 'en'), 'n. phr.');
  assert.equal(posToShortform('동사구', 'en'), 'v. phr.');
  assert.equal(posToShortform('관용구', 'en'), 'idiom');
  assert.equal(posToShortform('속담', 'en'), 'prov.');
});

test('posToShortform: Korean compact form when lang=ko', () => {
  assert.equal(posToShortform('명사', 'ko'), '명');
  assert.equal(posToShortform('동사', 'ko'), '동');
  assert.equal(posToShortform('형용사', 'ko'), '형');
  assert.equal(posToShortform('의존 명사', 'ko'), '의명');
  assert.equal(posToShortform('명사구', 'ko'), '명구');
  assert.equal(posToShortform('관용구', 'ko'), '관용');
});

test('posToShortform: defaults to English when lang is omitted', () => {
  assert.equal(posToShortform('명사'), 'n.');
});

test('posToShortform: unknown values pass through, empty in/empty out', () => {
  assert.equal(posToShortform('mystery', 'en'), 'mystery');
  assert.equal(posToShortform('', 'en'), '');
  assert.equal(posToShortform(null, 'en'), '');
  assert.equal(posToShortform(undefined, 'en'), '');
});
