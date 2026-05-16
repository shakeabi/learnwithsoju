# Contributing

Thanks for taking a look. The extension itself is intentionally small and build-step-free — most contributions should be straightforward.

## Layout

```
extension/      Chrome MV3 extension (this is what gets loaded as unpacked)
  vendor/         Pre-built artifacts: mecab-ko WASM + dict
tests/          node:test suite — run with `npm test`
docs/           Integration plans, third-party attribution, original spec
```

## Local development

```bash
git clone <this-repo>
cd learnwithsoju

# Install the test harness's only dev dependency (@xmldom/xmldom)
npm install

# Run tests
npm test

# Load the extension into Chrome
#  → chrome://extensions
#  → enable Developer mode
#  → Load unpacked → pick the `extension/` folder
```

After editing extension code, click the circular reload arrow on the extension's card in `chrome://extensions` and refresh any open pages to pick up the changes.

## What does and doesn't need a build step

The extension itself ships pre-built — no bundler, no transpiler at runtime. `npm install` exists only for the Node test harness.

The vendored artifacts under `extension/vendor/mecab-ko/` are the **mecab-ko-wasm** Korean morphological analyzer (built from a fork at <https://github.com/abishake/mecab-ko> with a `from_bytes` constructor we added) plus the gzipped mecab-ko-dic dictionary files. See [`docs/MECAB_INTEGRATION.md`](docs/MECAB_INTEGRATION.md) for the fork's build flow. The rebuild isn't required for routine development — the artifacts are committed.

## Testing

```bash
npm test          # runs all node:test suites
```

Tests live under `tests/`. Pure modules (lemmatizer, api, parsers, cache, grammar-glosses) have unit tests. Files that depend on the DOM, chrome.* APIs, or mecab itself (background.js, content.js) are exercised via manual loading in Chrome.

When adding new pure logic, please add tests. For UI changes, a brief description of how to manually verify in `chrome://extensions` is enough.

## Style

- ES modules everywhere.
- No dependencies in the shipped extension. Dev dependencies (test runner, XML parser for parsers tests) are fine.
- Code comments explain the *why*; identifiers carry the *what*. Keep one-liner comments unless an invariant or workaround needs more space.
- No emojis in source files.

## API keys

The extension never bundles API keys — they're entered by the user in the options page and stored via `chrome.storage.sync`. Never commit a key, even in tests or fixtures. When a test needs to verify request shape, use a placeholder like `'TEST_KEY'`.

## License

Contributions are licensed under the [MIT License](LICENSE) of the project. By submitting a PR, you confirm you have the right to release your changes under that license.
