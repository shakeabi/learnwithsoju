# Third-party attribution

## V1 status

This V1 release has **no vendored third-party code**. The lemmatizer in `extension/lemmatizer.js` is original heuristic code in this repo.

The extension communicates at runtime with the National Institute of Korean Language (NIKL) open dictionary APIs:

- **KRDict** — <https://krdict.korean.go.kr/api/search>
- **OpenDict** (우리말샘, experimental fallback) — <https://opendict.korean.go.kr/api/search>

No NIKL data is bundled in this repository; users supply their own API keys.

## Future vendored components

When V2 swaps in a real morphological analyzer, attribution will be added here. Candidates evaluated:

### mecab-ko-wasm

- **Source:** <https://github.com/hephaex/mecab-ko>
- **npm:** <https://www.npmjs.com/package/mecab-ko-wasm>
- **License:** MIT OR Apache-2.0 (at user's option)
- **V1 status:** evaluated and shelved. The published npm release ships the analyzer engine (~86 KB WASM) without `mecab-ko-dic` embedded; `new Mecab()` errors at runtime with `Dictionary error: Invalid dictionary format: Dictionary directory not found`.

**Diagnosis (verified against the Rust source on main):** the issue is structural, not a packaging slip. In `rust/crates/mecab-ko-core/src/tokenizer.rs`:

  - `Tokenizer::new()` calls `SystemDictionary::load_default()` which reads from `MECAB_DICDIR` env var or a filesystem path.
  - `Tokenizer::with_dict(path)` exists but takes `AsRef<Path>` — still a filesystem path, useless in WASM where there is no real fs.
  - No `from_bytes` constructor. No `embed_dict` / `bundle_dict` Cargo feature. No JS-facing way to hand the engine a dict at runtime.
  - `mecab-ko-core/Cargo.toml` features: `default = ["zstd"]`, plus `simd`, `async`, `hot-reload-v2` — none embed-related.

**To adopt for the browser this would need upstream code changes:**

  1. Add `SystemDictionary::from_bytes(&[u8]) -> Result<Self>` in `mecab-ko-dict` (or write the dict files into a virtual FS at runtime).
  2. Surface a JS-facing constructor in `mecab-ko-wasm` that accepts `Uint8Array`.
  3. Pre-compile `mecab-ko-dic` into the binary format the loader expects.
  4. Either `include_bytes!` it into the WASM (~50 MB binary, manageable with zstd) or ship the dict as a separate WAR asset and load it post-init.

Estimated 1–2 days of focused work — not half a day. Defer until grammar/lemmatization quality becomes the limiting factor.

### Kiwi (kiwi-nlp)

- **Source:** <https://github.com/bab2min/Kiwi>
- **npm:** <https://www.npmjs.com/package/kiwi-nlp>
- **License:** LGPL-2.1-or-later (the WASM module). The extension's own code stays MIT; LGPL applies to the kiwi WASM module shipped alongside.
- **V1 status:** evaluated and shelved. Best-in-class accuracy. Loading constraints in MV3 (the wasm-bindgen output uses `new Function()` which the default extension CSP forbids) require a sandboxed iframe + offscreen document; ~84 MB model needs to be fetched outside git.
