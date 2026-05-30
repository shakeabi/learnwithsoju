import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure replicas of extractNnpRuns and synthesizeMissingNnpRuns from background.js.
// background.js cannot be imported in Node (chrome.* globals at module scope),
// so we test the pure logic here. Keep these in sync with the background
// implementation.

function extractNnpRuns(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const runs = [];
  let run = null;
  for (const t of tokens) {
    const tag = (t.pos || '').split('+')[0];
    if (tag === 'NNP') {
      if (run) {
        run.surface += t.surface;
      } else {
        run = { surface: t.surface };
      }
    } else {
      if (run) { runs.push(run); run = null; }
    }
  }
  if (run) runs.push(run);
  return runs;
}

function synthesizeMissingNnpRuns(nnpRuns, existingTabs) {
  const tabWords = new Set(existingTabs.map((t) => t.word));
  const synthetic = [];
  for (const r of nnpRuns) {
    if (tabWords.has(r.surface)) continue;
    synthetic.push({
      word: r.surface,
      sections: [{
        source: 'synthetic-nnp',
        word: r.surface,
        pos: '고유명사',
        definition: `${r.surface} — Proper noun (name of a person, place, or thing). No dictionary entry found.`,
        pronunciation: r.surface,
        isSynthetic: true,
      }],
    });
  }
  return synthetic;
}

// Helper to simulate the full handleLookup tabs assembly used in background.js.
function assembleTabs(tokens, existingTabs) {
  const nnpRuns = extractNnpRuns(tokens || []);
  const syntheticTabs = nnpRuns.length > 0 ? synthesizeMissingNnpRuns(nnpRuns, existingTabs) : [];
  return [...syntheticTabs, ...existingTabs];
}

const tok = (surface, pos) => ({ surface, pos });

// --- extractNnpRuns tests ---

test('extractNnpRuns: single NNP token produces one run', () => {
  const runs = extractNnpRuns([tok('민수', 'NNP')]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].surface, '민수');
});

test('extractNnpRuns: NNP + particle produces one run from just the NNP', () => {
  const runs = extractNnpRuns([tok('김민수', 'NNP'), tok('가', 'JKS')]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].surface, '김민수');
});

test('extractNnpRuns: consecutive NNP tokens merge into one run', () => {
  // 강남구 → 강남(NNP) + 구(NNP)
  const runs = extractNnpRuns([tok('강남', 'NNP'), tok('구', 'NNP')]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].surface, '강남구');
});

test('extractNnpRuns: two NNP runs separated by a particle produce two runs', () => {
  // 김민수와 박철수 → NNP + JC + NNP
  const runs = extractNnpRuns([tok('김민수', 'NNP'), tok('와', 'JC'), tok('박철수', 'NNP')]);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].surface, '김민수');
  assert.equal(runs[1].surface, '박철수');
});

test('extractNnpRuns: no NNP tokens produces empty array', () => {
  const runs = extractNnpRuns([tok('먹', 'VV'), tok('었', 'EP'), tok('어요', 'EF')]);
  assert.deepEqual(runs, []);
});

test('extractNnpRuns: empty token list produces empty array', () => {
  assert.deepEqual(extractNnpRuns([]), []);
});

test('extractNnpRuns: null/undefined produces empty array', () => {
  assert.deepEqual(extractNnpRuns(null), []);
  assert.deepEqual(extractNnpRuns(undefined), []);
});

test('extractNnpRuns: NNP+JX compound pos tag (lead tag NNP) is treated as NNP', () => {
  const runs = extractNnpRuns([tok('강남구', 'NNP+JX')]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].surface, '강남구');
});

// --- synthesizeMissingNnpRuns tests ---

test('synthesizeMissingNnpRuns: produces synthetic tab when run not in existing tabs', () => {
  const runs = [{ surface: '김민수' }];
  const result = synthesizeMissingNnpRuns(runs, []);
  assert.equal(result.length, 1);
  const tab = result[0];
  assert.equal(tab.word, '김민수');
  assert.equal(tab.sections.length, 1);
  const section = tab.sections[0];
  assert.equal(section.source, 'synthetic-nnp');
  assert.equal(section.pos, '고유명사');
  assert.equal(section.isSynthetic, true);
  assert.ok(section.definition.includes('Proper noun'));
  assert.equal(section.pronunciation, '김민수');
});

test('synthesizeMissingNnpRuns: skips run whose word is already a tab', () => {
  const runs = [{ surface: '김치' }];
  const existingTabs = [{ word: '김치', sections: [{ source: 'kr', queryIdx: 0, itemIdx: 0 }] }];
  const result = synthesizeMissingNnpRuns(runs, existingTabs);
  assert.deepEqual(result, [], 'should not synthesize when tab already exists for that NNP');
});

test('synthesizeMissingNnpRuns: produces two synthetic tabs for two missing runs', () => {
  const runs = [{ surface: '김민수' }, { surface: '박철수' }];
  const result = synthesizeMissingNnpRuns(runs, []);
  assert.equal(result.length, 2);
  assert.equal(result[0].word, '김민수');
  assert.equal(result[1].word, '박철수');
});

// --- assembleTabs integration (mirrors handleLookup's [...syntheticTabs, ...tabs]) ---

test('all-empty case with NNP: still synthesizes (was the original trigger case)', () => {
  const tokens = [tok('민수', 'NNP')];
  const tabs = assembleTabs(tokens, []);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].word, '민수');
  assert.equal(tabs[0].sections[0].source, 'synthetic-nnp');
});

test('NNP query empty, other queries non-empty: synthetic tab is prepended at position 0', () => {
  // 김민수가 → NNP token 김민수 had no dict entry, but 가 (JKS) produced a real tab
  const tokens = [tok('김민수', 'NNP'), tok('가', 'JKS')];
  const realTab = { word: '가다', sections: [{ source: 'kr', queryIdx: 1, itemIdx: 0 }] };
  const tabs = assembleTabs(tokens, [realTab]);
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].word, '김민수', 'synthetic tab must be at position 0');
  assert.equal(tabs[0].sections[0].source, 'synthetic-nnp');
  assert.equal(tabs[1].word, '가다', 'real tab follows');
});

test('NNP has a real dict result: no synthetic tab created', () => {
  // 김치 is NNP-tagged AND KRDict returned a real entry for it
  const tokens = [tok('김치', 'NNP')];
  const realTab = { word: '김치', sections: [{ source: 'kr', queryIdx: 0, itemIdx: 0 }] };
  const tabs = assembleTabs(tokens, [realTab]);
  assert.equal(tabs.length, 1, 'only the real tab; no synthetic');
  assert.equal(tabs[0].word, '김치');
  assert.equal(tabs[0].sections[0].source, 'kr');
});

test('two NNP runs, neither in dict: two synthetic tabs prepended in order', () => {
  // 김민수와 박철수 → two NNP runs, no real tabs
  const tokens = [tok('김민수', 'NNP'), tok('와', 'JC'), tok('박철수', 'NNP')];
  const tabs = assembleTabs(tokens, []);
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].word, '김민수');
  assert.equal(tabs[1].word, '박철수');
  assert.equal(tabs[0].sections[0].source, 'synthetic-nnp');
  assert.equal(tabs[1].sections[0].source, 'synthetic-nnp');
});

test('non-NNP surface: no synthesis', () => {
  const tokens = [tok('먹', 'VV'), tok('었', 'EP'), tok('어요', 'EF')];
  const tabs = assembleTabs(tokens, []);
  assert.deepEqual(tabs, [], 'non-NNP with no real tabs stays empty');
});

test('non-NNP surface with real tabs: real tabs unaffected, no synthesis prepended', () => {
  const tokens = [tok('먹', 'VV'), tok('었', 'EP'), tok('어요', 'EF')];
  const realTab = { word: '먹다', sections: [{ source: 'kr', queryIdx: 0, itemIdx: 0 }] };
  const tabs = assembleTabs(tokens, [realTab]);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].word, '먹다');
  assert.equal(tabs[0].sections[0].source, 'kr');
});
