# Firefox build & AMO submission

This doc covers loading `learnwithsoju` in Firefox for development,
producing a distributable `.zip` for Mozilla Add-ons (AMO), and
known gotchas in the Chrome ↔ Firefox port.

The extension is delivered as **one** `manifest.json` that works in
both browsers. Each browser silently ignores fields it does not
understand, so we do not maintain two manifests or run a build step
that swaps them out. See [Why one manifest](#why-one-manifest) below
for the field-by-field rationale.

---

## 1. Load the extension in Firefox for development

Firefox supports MV3 from version 109; the polished service-worker
implementation lands in 121. The manifest's `strict_min_version` is
`121.0` so AMO will only offer it to FF 121+, but the temporary load
flow below works on any 109+.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select **`extension/manifest.json`** (or any file inside `extension/`).
4. The extension is now loaded. Open `about:addons` → the gear icon
   next to *learnwithsoju* → **Preferences** to paste your KRDict API
   key (or click the toolbar icon to open the popup).

Temporary add-ons are removed when Firefox restarts — re-run the
above each session, or use the **Firefox Developer Edition** /
**Nightly** which let you set `xpinstall.signatures.required = false`
in `about:config` to install unsigned `.zip` builds permanently.

To debug the service worker: `about:debugging` → the extension's
**Inspect** button → the same DevTools window you use in Chrome.

---

## 2. Build a distributable .zip for AMO submission

```sh
npm run package:firefox
```

This invokes `scripts/build-firefox.sh`, which:

1. Reads the version from `extension/manifest.json`.
2. Runs `web-ext lint` if `web-ext` is on `PATH` (skipped with a note
   otherwise — install with `npm i -g web-ext`).
3. Zips the **contents** of `extension/` (not the folder itself) into
   `dist/learnwithsoju-firefox-<version>.zip`. `manifest.json` must
   sit at the root of the archive; AMO rejects a zip that contains a
   top-level wrapper directory.
4. Prints the first ~20 entries of the resulting zip so you can
   eyeball the layout.

For Chrome the parallel script is `npm run package:chrome` (output:
`dist/learnwithsoju-chrome-<version>.zip`). `npm run package` runs both.

`dist/` is gitignored.

---

## 3. Validate the build

### Local lint with web-ext (recommended)

```sh
npm i -g web-ext
web-ext lint --source-dir extension
```

`web-ext lint` flags manifest issues, missing icons, dangerous CSP,
and the most common AMO reviewer complaints. The build script also
runs this automatically when `web-ext` is installed.

### AMO web validator

If you'd rather not install Node tooling globally, the Developer Hub
runs the same validator on upload — submit the zip as a draft and
let AMO surface any issues.

### Smoke-test in a real Firefox

After `npm run package:firefox`:

1. Unzip the build to a temp dir (e.g. `/tmp/lws-firefox`).
2. Load the unzipped dir as a temporary add-on (Section 1).
3. Confirm: popup opens, options page opens, hover on a Korean word
   produces a popup, YouTube + Netflix dual-subs engage on a video
   with a Korean caption track.

---

## 4. Submit to Mozilla Add-ons (AMO)

Prerequisite: you have a Firefox Account and have completed Developer
Hub onboarding at <https://addons.mozilla.org/developers/>.

1. Run `npm run package:firefox`. Note the output path.
2. Sign in at <https://addons.mozilla.org/developers/>.
3. Click **Submit a New Add-on**.
4. Choose **On this site** for distribution (AMO-listed).
5. Upload `dist/learnwithsoju-firefox-<version>.zip`. The validator
   runs server-side; address any warnings.
6. **Source-code disclosure** — AMO requires submission of the
   buildable source for any minified, obfuscated, machine-generated,
   or otherwise non-human-readable code in the package. Our JS is
   shipped as-is (no bundler, no minifier), but the mecab-ko WASM
   blobs in `extension/vendor/mecab-ko/` are compiled binaries.
   Provide:
   - **Repo URL**: the public learnwithsoju repo.
   - **Build instructions for the WASM**: link to the
     `mecab-ko-wasm` fork at the SHA pinned in
     [`docs/MECAB_INTEGRATION.md`](MECAB_INTEGRATION.md), with the
     fork's README as the build recipe. (The fork repo must be
     pushed and publicly accessible before submitting.)
7. Fill out the listing fields from
   [`docs/store-listings/mozilla-amo.md`](store-listings/mozilla-amo.md)
   (name, summary, description, categories, support URL, license).
8. Submit for review. Mozilla's queue is usually a few days for new
   listings; subsequent updates are often auto-approved.

---

## 5. Why one manifest

Each row notes what each browser does with the field. Chrome silently
ignores unknown top-level keys; Firefox silently ignores unknown keys
inside `background`, so the dual-fielding strategy is safe.

| Field                                  | Chrome MV3                       | Firefox MV3                              |
| -------------------------------------- | -------------------------------- | ---------------------------------------- |
| `manifest_version: 3`                  | required                         | required                                 |
| `background.service_worker`            | required (the SW entry point)    | used on FF 121+; ignored on 109–120      |
| `background.scripts`                   | ignored                          | used on every FF version (event-page)    |
| `background.type: "module"`            | enables ES modules in the SW     | enables ES modules in the event page     |
| `browser_specific_settings.gecko.id`   | ignored                          | required for AMO; identifies the add-on  |
| `browser_specific_settings.gecko.strict_min_version` | ignored             | enforced by AMO during install           |
| `host_permissions`                     | identical                        | identical                                |
| `web_accessible_resources` (MV3 array) | identical                        | identical                                |
| `content_scripts`                      | identical                        | identical                                |
| `action.default_popup`                 | identical                        | identical                                |
| `options_page`                         | identical                        | identical                                |
| `content_security_policy.extension_pages` | identical (incl. `wasm-unsafe-eval`) | identical                          |

Background-script consequence: on Firefox 109–120 the same
`background.js` runs as a persistent event page (it can register
listeners at top level the same way). On Firefox 121+ and on Chrome
MV3 it runs as a service worker. `chrome.runtime.onStartup` /
`chrome.runtime.onInstalled` listeners fire in both shapes, so the
existing mecab warm-up code in `background.js` works unchanged.

---

## 6. Known differences between Chrome and Firefox builds

- **Service-worker lifetime** — Chrome MV3 kills the SW after ~30s
  idle. Firefox 121+ uses the same idle-eviction model but with
  slightly different timing; Firefox 109–120 keeps the event page
  alive longer (persistent until the browser unloads it). The cache
  warmers in `background.js` are idempotent so the lifetime
  difference does not change correctness.
- **Storage quotas** — both use `chrome.storage.local` (Firefox aliases
  `browser.storage.local` to the same object via the polyfill). FF's
  default quota for `unlimitedStorage` permission matches Chrome's.
- **`chrome.tabs.sendMessage` to a content script on a special page**
  (e.g. `about:blank`, `about:debugging`) — Firefox throws, Chrome
  silently returns. The popup code handles missing replies as
  "extension disabled here" already, so the user-visible behaviour
  is the same.
- **Caption-network interception on YouTube / Netflix** — the
  `MAIN`-world page-hook uses `fetch` / `XMLHttpRequest` monkey-patches,
  which work identically in both engines.

If you find any other divergence, append it here.

---

## 7. Troubleshooting

- **"Could not load manifest"** when picking `extension/manifest.json`
  from `about:debugging` → check `browser_specific_settings.gecko.id`
  is present and well-formed (`name@domain` or a UUID-in-braces).
- **"Service worker registration failed"** on Firefox < 121 → expected;
  Firefox falls through to `background.scripts` and runs the script
  as an event page. If `background.scripts` is missing, the extension
  will silently have no background context.
- **"Reading manifest: Warning processing background.service_worker:
  An unexpected property was found"** on old Firefox — informational
  only; Firefox ignored the unknown field and used `background.scripts`.
- **Hover popup never appears** → open `about:debugging` → Inspect
  the content-script console (the page's own DevTools). The
  extension logs `[lws] …` for every lookup; check whether the
  message arrived and whether `chrome.runtime.sendMessage` resolved.
- **`web-ext lint` fails with "JS_STRICT_MODE"-style errors** →
  usually a transient lint rule update; cross-check against the AMO
  validator on upload before considering it a real issue.
- **AMO rejects the zip with "manifest.json not found at root"** →
  the zip wraps the `extension/` folder. The build script avoids
  this by `cd`-ing into `extension/` before running `zip`; check
  you ran the script rather than zipping by hand.
- **AMO source-code submission step asks "is any code minified?"** →
  answer **no** for the JS (we ship sources verbatim), **yes** for
  the `vendor/mecab-ko/*.wasm` / `*.gz` artefacts, and link the
  upstream fork for build instructions (Section 4 step 6).
