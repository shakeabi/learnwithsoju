# mecab-ko-wasm integration — done

## Summary

The extension uses a forked build of [mecab-ko-wasm](https://github.com/hephaex/mecab-ko) that we extended with a `from_bytes` constructor, plus the official mecab-ko-dic 2.1.1 dict, both vendored under `extension/vendor/mecab-ko/`. The service worker lazy-loads the WASM and gunzips the dict on first hover; subsequent hovers reuse the in-memory tokenizer.

End-to-end flow:

```
hover Korean word in page
    │
content.js  ──── chrome.runtime.sendMessage({type:'lookup', surface}) ───▶
                                                                          │
                                                                  background.js
                                                                          │
   ┌──────────────────────────────────────────────────────────────────────┘
   │
   ▼
ensureMecab()  ── first call only ──▶  init WASM + fetch+gunzip 3 dict files
                                       (~1–2s on first hover, 0ms after)
   │
   ▼
mecab.tokenize(surface) → POS-tagged morpheme tokens
   │
   ▼
lemmaCandidates(tokens, surface) → ordered candidate dictionary forms
   │
   ▼
KRDict / OpenDict lookup, popup render (unchanged)
```

## What was done across the four phases

### Phase A — toolchain

- Rust 1.95, wasm-pack 0.14, wasm32-unknown-unknown target installed.

### Phase B — dict source data + builder

- Downloaded `mecab-ko-dic-2.1.1-20180720.tar.gz` (48 MB) → `/home/abishake/projects/mecab-ko-dic-src/`
- Built `mecab-ko-dict-builder` from our fork.
- Output: `sys.dic` (16 MB), `matrix.bin` (20 MB), `entries.bin` (54 MB) raw, gzipped to 9.3 / 2.5 / 9.7 MB respectively.

### Phase C — Rust source changes (in our fork)

Edited in `/home/abishake/projects/mecab-ko-fork/`:

- `mecab-ko-dict/src/trie/backend.rs` — added `TrieBackend::from_vec(Vec<u8>)`
- `mecab-ko-dict/src/matrix/mod.rs` — added `ConnectionMatrix::from_bin_bytes(&[u8])`
- `mecab-ko-dict/src/dictionary.rs` — added `pub struct DictBytes<'a>`, `SystemDictionary::from_bytes`, `parse_entries_bin_v1` / `_v2_eager` / `load_entries_bin_from_bytes`
- `mecab-ko-dict/src/lib.rs` — re-exported `DictBytes`
- `mecab-ko-core/src/tokenizer.rs` — added `Tokenizer::from_dict_bytes` + a unit test against the mini-dict that loads bytes off disk
- `mecab-ko-core/src/lib.rs` — re-exported `DictBytes` so wasm crate doesn't need to depend on `mecab-ko-dict` directly
- `mecab-ko-wasm/src/lib.rs` — added `Mecab::withDictBytes(trie, matrix, entries)` JS-facing constructor

The new `Tokenizer::from_dict_bytes` test passes on the mini-dict — verified the byte path works end-to-end at the Rust level.

### Phase D — WASM build + Node smoke test

- `wasm-pack build --target web --release` → 145 KB WASM + JS glue
- `wasm-pack build --target nodejs --release` for the Node verification path
- Smoke test on full mecab-ko-dic (~90 MB raw bytes through `Mecab.withDictBytes`): init in ~860 ms, tokenizes correctly:
  - `먹었어요` → `먹/VV` + `었/EP` + `어요/EF`
  - `예뻐요` → `예뻐요/VA+EC`
  - `학교에서` → `학교/NNG` + `에서/JKB`
  - `한국말` → `한국/NNP` + `말/NNG`
- Browser test page also written: `mecab-ko-fork/rust/crates/mecab-ko-wasm/examples/from-bytes.html`. Serve with `python3 -m http.server 8000` from the `rust/` dir, open `http://localhost:8000/crates/mecab-ko-wasm/examples/from-bytes.html`.

### Phase E — extension integration

Files changed in this repo:

- `extension/manifest.json` — added `content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"` (required for WASM in MV3 service workers)
- `extension/vendor/mecab-ko/` — new directory, holds:
  - `mecab_ko_wasm{.js,.d.ts,_bg.wasm,_bg.wasm.d.ts}` (built from our fork)
  - `sys.dic.gz`, `matrix.bin.gz`, `entries.bin.gz` (compiled mecab-ko-dic, gzip -9)
- `extension/background.js` — imports `init`, `Mecab` from the vendored module; `ensureMecab()` lazy-init that fetches + gunzips dict files via Chrome's built-in `DecompressionStream`; `lemmasFor(surface)` calls `mecab.tokenize` then `lemmaCandidates`. Falls back gracefully to surface-only candidates if mecab fails to init.
- `extension/core/lemmatizer.js` — rewritten to take mecab tokens. Walks tags by lead POS (`VV`/`VA`/`VX` → stem + 다, `NN*` → noun-as-lemma, particles/endings skipped); always includes surface as fallback. Pure function, fully unit-tested.
- `tests/lemmatizer.test.js` — rewritten for the new token-based signature. 15 cases covering verb stems, adjective stems, nouns, compound nouns, merged POS tags (`VV+EP`), particles/endings skipped, dedup, and the "stem already ends in 다" defensive case.
- `docs/THIRD-PARTY.md` — added mecab-ko-wasm and mecab-ko-dic attribution.
- `README.md` — features section and architecture diagram updated; Lemmatization section rewritten for the new approach.

## Phase F — manual real-text testing (left for the user)

Load the extension into Chrome (`chrome://extensions` → enable Developer mode → Load unpacked → pick `extension/`), reload any open Korean page, and verify:

| Surface form | Expected lemma | Why this matters |
|---|---|---|
| `먹었어요` | `먹다` | Regular verb past tense |
| `갔습니다` | `가다` (or `갔다` fallback) | Irregular ㄹ contraction |
| `예뻐요` | `예쁘다` (or `예뻐` fallback) | Irregular ㅡ deletion |
| `학교에서` | `학교` | Noun + particle |
| `친구들과` | `친구` | Noun + plural marker + particle |
| `공부하다` | `공부하다` or `공부` | Compound verb |
| `한국말` | `한국말` or `한국` | Compound noun mecab splits |

Also sanity-check the first-hover latency (~1–2 s on first hover, instant after) and verify the popup chain works (lemma chip, EN/KR toggle, stars, tabs, hanja link, etc.) on real KRDict responses.

## Build flow for future updates

If you ever need to rebuild the vendored WASM or dict:

```bash
# WASM (after editing our fork in /home/abishake/projects/mecab-ko-fork)
cd /home/abishake/projects/mecab-ko-fork/rust/crates/mecab-ko-wasm
wasm-pack build --target web --release --out-dir pkg-web
cp pkg-web/{mecab_ko_wasm.js,mecab_ko_wasm.d.ts,mecab_ko_wasm_bg.wasm,mecab_ko_wasm_bg.wasm.d.ts} \
   /home/abishake/projects/learnwithsoju/extension/vendor/mecab-ko/

# Dict (after editing dict-builder, or to refresh against newer mecab-ko-dic)
cd /home/abishake/projects/mecab-ko-dic-src
/home/abishake/projects/mecab-ko-fork/rust/target/release/mecab-ko-dict-builder \
  --input ./mecab-ko-dic-2.1.1-20180720 --output ./dict-built --compression 0
cd dict-built && for f in sys.dic matrix.bin entries.bin; do gzip -9k -c "$f" > "$f.gz"; done
cp {sys.dic,matrix.bin,entries.bin}.gz \
   /home/abishake/projects/learnwithsoju/extension/vendor/mecab-ko/
```

## Useful paths

| Path | What |
|---|---|
| `/home/abishake/projects/learnwithsoju/extension/vendor/mecab-ko/` | Vendored artifacts shipped with the extension. |
| `/home/abishake/projects/mecab-ko-fork/` | Our fork of hephaex/mecab-ko. Origin still points at upstream; rename to `upstream` when publishing our fork to a new remote. |
| `/home/abishake/projects/mecab-ko-dic-src/` | mecab-ko-dic source CSVs + built `dict-built/` directory. |
