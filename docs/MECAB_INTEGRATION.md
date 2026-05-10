# mecab-ko-wasm integration plan

Status of the mecab-ko-wasm work as of the last session. Read this first when picking it back up.

## Decision summary

- **Goal:** real morpheme-level POS tagging in the extension to replace the suffix-strip lemmatizer in `extension/lemmatizer.js`. Unlocks correct lemmas for irregular verbs/adjectives and is a prerequisite for the future grammar-pattern matcher and decomposition feature.
- **Strategy:** fork `hephaex/mecab-ko`, add a `from_bytes` constructor path so the WASM can accept dict data from JavaScript at runtime, build a custom `mecab-ko-wasm` from the fork, vendor it into our extension.
- **Dict packaging:** ship 3 dict files (`sys.dic`, `matrix.bin`, `entries.bin`) as gzipped assets in `extension/vendor/mecab-ko/`. Service worker fetches at first init, gunzips via Chrome's built-in `DecompressionStream`, hands bytes to the WASM constructor. ~15 MB compressed, ~50 MB after decompression in JS memory.
- **Why not `char.bin`/`unk.bin`:** `UnknownHandler::korean_default()` in `mecab-ko-core/src/unknown.rs` is hardcoded — the Korean character categories and unknown-word entries are Rust constants, not loaded from disk.

## What's done (last session)

### Phase A — toolchain ✓

- Rust 1.95 (`rustup update stable` — wasm-pack required ≥ 1.88).
- `wasm32-unknown-unknown` target installed.
- wasm-pack 0.14.0 installed via `cargo install wasm-pack --locked`.
- Fork cloned and verified: `/home/abishake/projects/mecab-ko-fork/`. Origin still points at `https://github.com/hephaex/mecab-ko.git`. Should be renamed to `upstream` before pushing our changes anywhere; we'll add a new `origin` for our fork's git host when we publish.

### Phase B — dict build prerequisites ✓

- `mecab-ko-dict-builder` Rust binary compiles cleanly:
  - `cd /home/abishake/projects/mecab-ko-fork/rust && cargo build --release -p mecab-ko-dict-builder`
  - Output at `rust/target/release/mecab-ko-dict-builder`
- mecab-ko-dic source CSVs downloaded:
  - `/home/abishake/projects/mecab-ko-dic-src/mecab-ko-dic-2.1.1-20180720.tar.gz`
  - 48 MB compressed, 75 files / 229 MB uncompressed.
- Mini-dict for early Phase C iteration is already in the fork:
  - `/home/abishake/projects/mecab-ko-fork/rust/test-fixtures/mini-dict/`
  - Contains `entries.bin` (2.3 KB), `sys.dic` (1 KB), `matrix.bin` (6.5 KB), `entries.csv` (1.9 KB)
  - 21 common Korean words. Sufficient for verifying the `from_bytes` plumbing without building the full dict.

## What's next

### Phase C — Rust source changes (3-5 hours)

Add `from_bytes` plumbing in `mecab-ko-fork/rust/`. The lower-level pieces already exist; only the wiring is missing.

Files / functions to add:

| Layer | What to add | Wraps |
|---|---|---|
| `mecab-ko-dict/src/trie/backend.rs` | `pub fn from_vec(bytes: Vec<u8>) -> Self` | `Trie::from_vec` (already exists) |
| `mecab-ko-dict/src/matrix/mod.rs` | `pub fn from_bytes(bytes: &[u8]) -> Result<Self>` | `DenseMatrix::from_bin_bytes` (already exists, line 197 of `matrix/dense.rs`) |
| `mecab-ko-dict/src/dictionary.rs` | `fn load_entries_bin_from_bytes(data: &[u8]) -> Result<Vec<DictEntry>>` | mostly copy of `load_entries_bin` (line 508) — replace `std::fs::read(path)` with `data` |
| `mecab-ko-dict/src/dictionary.rs` | new struct `pub struct DictBytes<'a> { trie, matrix, entries }` |  |
| `mecab-ko-dict/src/dictionary.rs` | `impl SystemDictionary { pub fn from_bytes(b: DictBytes<'_>) -> Result<Self> }` | wires the three above |
| `mecab-ko-core/src/tokenizer.rs` | `pub fn from_dict_bytes(b: DictBytes<'_>) -> Result<Self>` | wraps `SystemDictionary::from_bytes` |
| `mecab-ko-wasm/src/lib.rs` | new JS-facing constructor `Mecab::with_dict_bytes(trie: Uint8Array, matrix: Uint8Array, entries: Uint8Array)` | wraps `Tokenizer::from_dict_bytes` |

**Edge case to read first:** `entries.bin` v2 format (magic `MKE2`) currently dispatches to `load_entries_bin_v2` which uses `LazyEntries::from_file`. For the bytes path, we either (a) only support v1 (`MKED` magic) which is what we'll build, or (b) add `LazyEntries::from_bytes`. Pick (a) for first cut; verify the dict-builder produces v1 by default.

**Iteration loop:** test against the mini-dict via a Rust unit test in `mecab-ko-core` (load DictBytes from `rust/test-fixtures/mini-dict/*.bin`, tokenize "안녕", verify `["안녕"]`).

### Phase D — build WASM, smoke-test (1 hour)

```bash
cd /home/abishake/projects/mecab-ko-fork/rust/crates/mecab-ko-wasm
wasm-pack build --target web --release --out-dir pkg-web
```

Adapt `learnwithsoju/docs/mecab-browser-smoketest.html` to point at `pkg-web/`, supply mini-dict bytes, verify tokenization in browser.

### Phase E — extension integration (2-3 hours)

1. Build the **real** mecab-ko-dic from the source CSVs we already downloaded:

   ```bash
   cd /home/abishake/projects/mecab-ko-dic-src
   tar xzf mecab-ko-dic-2.1.1-20180720.tar.gz
   /home/abishake/projects/mecab-ko-fork/rust/target/release/mecab-ko-dict-builder \
     --input ./mecab-ko-dic-2.1.1-20180720 \
     --output ./dict-built
   ```

2. Gzip the three output `.bin` files: `gzip -9 sys.dic matrix.bin entries.bin`.
3. Vendor into `learnwithsoju/extension/vendor/mecab-ko/`:
   - `mecab_ko_wasm_bg.wasm`
   - `mecab_ko_wasm_bg.js`
   - `sys.dic.gz`, `matrix.bin.gz`, `entries.bin.gz`
4. Add to `manifest.json` `web_accessible_resources` (or load via `chrome.runtime.getURL` from the SW directly).
5. Update `extension/background.js`:
   - On first `lookup` message, lazy-init: fetch the 3 `.gz` files, pipe through `DecompressionStream('gzip')`, `WebAssembly.instantiateStreaming` for the wasm, then `new Mecab.with_dict_bytes(trie, matrix, entries)`.
   - Keep current heuristic lemmatizer as a fallback during the (possibly slow) first-init phase, OR show "Initializing dictionary..." in the popup.
6. Replace `extension/lemmatizer.js` with a mecab-aware version. Interface stays `lemmaCandidates(surface) => string[]`. Rules:
   - For each token from `mecab.tokenize(surface)`:
     - if `tag` starts with `VV`/`VA`/`VX`/`VCN`/`VCP`: lemma = `<token.lemma || token.surface>` + `다`
     - if `tag` starts with `NN`/`NR`/`NP`/`SL`/`SH`: lemma = `<token.lemma || token.surface>`
     - particles (`JK*`, `JX`) and endings (`E*`) → skip
   - Return ordered candidates: deepest content morpheme first, then surface as fallback.

### Phase F — real-text testing (1 hour)

Hover the following on real Korean pages and verify the lemma resolves:

- `먹었어요` → `먹다` (regular verb past tense)
- `갔습니다` → `가다` (irregular ㄹ contraction)
- `예뻐요` → `예쁘다` (irregular ㅡ deletion)
- `학교에서` → `학교` (noun + particle)
- `친구들과` → `친구` (noun + plural + particle)
- `공부하다` → already lemma form

Each of these *fails* with the current suffix-strip lemmatizer. If mecab gives the right answer for all of them, Phase F is done.

## Extension's `package.json` should NOT change

The mecab work happens in a separate Rust workspace. The extension stays build-step-free at runtime — we just vendor the resulting WASM + dict files. The Node test harness in `package.json` is unaffected.

## Useful paths

| Path | What |
|---|---|
| `/home/abishake/projects/learnwithsoju/` | The extension repo (this repo). |
| `/home/abishake/projects/mecab-ko-fork/` | Working clone of `hephaex/mecab-ko`. Phase C edits go here. |
| `/home/abishake/projects/mecab-ko-fork/rust/test-fixtures/mini-dict/` | Pre-built mini-dict for Phase C testing. |
| `/home/abishake/projects/mecab-ko-dic-src/mecab-ko-dic-2.1.1-20180720.tar.gz` | mecab-ko-dic source CSVs for the full Phase E build. |
| `/home/abishake/projects/learnwithsoju/docs/mecab-browser-smoketest.html` | Existing browser smoke test — adapt for our fork in Phase D. |
