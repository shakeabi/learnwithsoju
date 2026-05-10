# Third-party attribution

## Vendored components

### mecab-ko-wasm (forked)

- **Path:** `extension/vendor/mecab-ko/mecab_ko_wasm{.js,.d.ts,_bg.wasm,_bg.wasm.d.ts}`
- **Upstream:** <https://github.com/hephaex/mecab-ko>
- **License:** MIT OR Apache-2.0 (at user's option)
- **Our changes:** added `SystemDictionary::from_bytes(DictBytes<'_>)`, `Tokenizer::from_dict_bytes`, and the JS-facing `Mecab.withDictBytes(trie, matrix, entries)` so the analyzer can be initialized in browsers from in-memory bytes (the upstream npm release expects a filesystem). Diagnosis and plan: [`MECAB_INTEGRATION.md`](MECAB_INTEGRATION.md).
- **Build:** `wasm-pack build --target web --release` from `crates/mecab-ko-wasm/` of our fork.

### kimchi-grammar (data only)

- **Path:** `extension/vendor/kimchi-grammar/patterns.json`
- **Upstream:** <https://github.com/Alaanor/kimchi-grammar>
- **License:** Creative Commons Attribution 4.0 International (CC-BY 4.0)
- **What's included:** for each grammar point, the display name, definition slug + name + meaning + alternative-English label. Not included: example sentences, audio URLs, the full markdown explanation. The vendored JSON is generated at build time from the upstream YAMLs by `scripts/build-grammar-patterns.mjs`; it includes attribution metadata in its own header (`source`, `license`, `generated_at`).
- **Attribution:** Alaanor and contributors to kimchi-grammar.

### mecab-ko-dic 2.1.1 (compiled binary form)

- **Path:** `extension/vendor/mecab-ko/{sys.dic,matrix.bin,entries.bin}.gz`
- **Upstream source:** <https://bitbucket.org/eunjeon/mecab-ko-dic/downloads/mecab-ko-dic-2.1.1-20180720.tar.gz>
- **License:** Apache-2.0 (per the source distribution's `COPYING` file)
- **Build:** `mecab-ko-dict-builder --compression 0` against the upstream source CSVs, gzip -9 of the resulting `.bin` files. ~22 MB compressed total; decompresses to ~90 MB at runtime.

## Runtime API attributions (no data bundled)

The extension communicates at runtime with the National Institute of Korean Language (NIKL) open dictionary APIs — users supply their own API keys.

- **KRDict** — <https://krdict.korean.go.kr/api/search>
- **OpenDict** (우리말샘, experimental fallback) — <https://opendict.korean.go.kr/api/search>

## Other libraries evaluated and shelved

### Kiwi (kiwi-nlp)

- **Source:** <https://github.com/bab2min/Kiwi>
- **License:** LGPL-2.1-or-later
- **V1 status:** evaluated and shelved. Best-in-class accuracy on paper. Loading constraints in MV3 (the wasm-bindgen output uses `new Function()` which the default extension CSP forbids without `wasm-unsafe-eval`) require a sandboxed iframe + offscreen document; ~84 MB model needs to be fetched outside git. Mecab-ko's smaller dict and our fork's `from_bytes` constructor made it the better fit for V1.
