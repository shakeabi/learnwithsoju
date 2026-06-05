# Third-party attribution

## Vendored components

### Hanja proficiency levels (한국어문회 배정한자)

- **Path:** `extension/core/hanja-levels-data.js` (generated), `extension/core/hanja-levels.js` (lookup helpers)
- **Source:** [rycont/hanja-grade-dataset](https://github.com/rycont/hanja-grade-dataset) — CSV derived from the official 한국어문회 전국한자능력검정시험 character list (5,978 characters)
- **License:** not stated in upstream repo; data originates from 공식 학습자료 published by [사단법인 한국어문회](https://www.hanja.re.kr/). Regenerate with `npm run build:hanja-levels`.
- **Usage:** bundled char → level lookup shown next to Hanja in the popup (no network).

### mecab-ko-wasm (forked)

- **Path:** `extension/vendor/mecab-ko/mecab_ko_wasm{.js,.d.ts,_bg.wasm,_bg.wasm.d.ts}`
- **Upstream:** <https://github.com/hephaex/mecab-ko>
- **License:** MIT OR Apache-2.0 (at user's option)
- **Our changes:** added `SystemDictionary::from_bytes(DictBytes<'_>)`, `Tokenizer::from_dict_bytes`, and the JS-facing `Mecab.withDictBytes(trie, matrix, entries)` so the analyzer can be initialized in browsers from in-memory bytes (the upstream npm release expects a filesystem). Diagnosis and plan: [`MECAB_INTEGRATION.md`](MECAB_INTEGRATION.md).
- **Build:** `wasm-pack build --target web --release` from `crates/mecab-ko-wasm/` of our fork.

### mecab-ko-dic 2.1.1 (compiled binary form)

- **Path:** `extension/vendor/mecab-ko/{sys.dic,matrix.bin,entries.bin}.gz`
- **Upstream source:** <https://bitbucket.org/eunjeon/mecab-ko-dic/downloads/mecab-ko-dic-2.1.1-20180720.tar.gz>
- **License:** Apache-2.0 (per the source distribution's `COPYING` file)
- **Build:** `mecab-ko-dict-builder --compression 0` against the upstream source CSVs, gzip -9 of the resulting `.bin` files. ~22 MB compressed total; decompresses to ~90 MB at runtime.

## Runtime API attributions (no data bundled)

The extension communicates at runtime with the National Institute of Korean Language (NIKL) open dictionary APIs — users supply their own API keys.

- **KRDict** — <https://krdict.korean.go.kr/api/search>
- **OpenDict** (우리말샘, experimental fallback) — <https://opendict.korean.go.kr/api/search>
- **hangulhanja.com** — <https://hangulhanja.com/api/search> (per-character Hanja meanings; fetched on demand when the user expands the Hanja chip on a Sino-Korean entry)

## Other libraries evaluated and shelved

### Kiwi (kiwi-nlp)

- **Source:** <https://github.com/bab2min/Kiwi>
- **License:** LGPL-2.1-or-later
- **V1 status:** evaluated and shelved. Best-in-class accuracy on paper. Loading constraints in MV3 (the wasm-bindgen output uses `new Function()` which the default extension CSP forbids without `wasm-unsafe-eval`) require a sandboxed iframe + offscreen document; ~84 MB model needs to be fetched outside git. Mecab-ko's smaller dict and our fork's `from_bytes` constructor made it the better fit for V1.
