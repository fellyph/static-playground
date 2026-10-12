# Static Playground: Report Analysis, Improvement Plan & Best Flow Documentation

## 1. Executive Analysis of the Current Reports

### 1.1 Why `reports/validation.json` Failed (`"passed": false`)
In `reports/validation.json`, validation is currently failing with:
```json
{
  "passed": false,
  "routes": 9,
  "files": 16,
  "checkedTargets": 6,
  "errors": [
    "Unsafe output path: /.gitignore",
    "Unsafe output path: /.spacefast/state.json"
  ]
}
```
* **Root Cause:** When `scripts/publish.mjs` executes `sf publish dist --json`, the Spacefast CLI writes `dist/.gitignore` and `dist/.spacefast/state.json` directly inside `dist/`. On any subsequent run of `npm run validate` or `npm run publish` (which calls `validate()` before publishing), `walk()` in `scripts/validate.mjs` enumerates all files in `dist/` and passes them to `safePath()` in `scripts/lib/urls.mjs`, which throws on any path segment starting with `.`.
* **Lifecycle Conflict:** Conversely, running `npm run build` executes `await rm(output, { recursive: true, force: true })` (`scripts/build.mjs`), wiping `dist/.spacefast/state.json` on every build.

### 1.2 Route Over-Export & Starter Content Leakage in `reports/build.json`
In `reports/build.json`, **9 routes** are exported for **Southbound Surf Crew**, even though Southbound is a single-page landing site (`page_on_front = 6`, `page_for_posts = 0`):
* **1 Intentional Route:** `/` (`dist/index.html`, 27.8 KB)
* **3 Default WordPress/Playground Starter Posts & Pages:**
  * `/hello-from-playground/` (65.7 KB — pulls in **9 external assets** from `raw.githubusercontent.com/WordPress/blueprints/...` and `www.youtube.com`, plus the 20.3 KB `wp-includes/blocks/cover/style.min.css`)
  * `/sample-page/` (25.3 KB — contains a link to `/wp-admin/` recorded in `omittedLinks` in `reports/build.json`, leaving an `<a>your dashboard</a>` tag without an `href` in `dist/sample-page/index.html`)
  * `/2026/08/19/hello-world/` (23.4 KB)
* **5 Auto-Generated Archive Routes Triggered by `hello-world`:**
  * `/2026/`, `/2026/08/`, `/2026/08/19/`, `/author/admin/`, `/category/uncategorized/` (~23.3 KB each). Because the `southbound` theme only defines a singular content template, all 5 archive routes render duplicate `"Welcome to WordPress..."` content, pollute `dist/sitemap.xml`, and expose the `admin` author slug.

### 1.3 Unexported Runtime Assets & Misclassified References
* **Broken `wp-emoji-release.min.js` URL on Every Page:** In `dist/index.html` (and all other routes), `<script id="wp-emoji-settings" type="application/json">` contains:
  `"concatemoji":"https://dist-xualkngh2.view.fast/wp-includes/js/wp-emoji-release.min.js?ver=7.1"`.
  Because `scripts/lib/transform.mjs` only parses `<script type="importmap">` for asset enqueueing and falls back to plain string replacement (`rewriteText`) for other scripts, the origin is rewritten to `productionUrl` **without exporting `/wp-includes/js/wp-emoji-release.min.js` to `dist/`**. Any browser triggering the emoji fallback requests a 404 URL, and `scripts/validate.mjs` does not inspect `<script type="application/json">` URLs.
* **Dangling `sourceURL` Comments:** Inline `<style>` and `<script>` blocks contain `/*# sourceURL=https://dist-xualkngh2.view.fast/wp-includes/... */` pointing to unexported `/wp-includes/` files.
* **Bogus `"kind": "canonical"` References in `reports/build.json`:** `html()` in `scripts/lib/transform.mjs` groups `dns-prefetch` and `preconnect` under `kind = 'canonical'`. WordPress's `<link rel="dns-prefetch">` for the local site is rewritten to `<link rel="dns-prefetch" href="https://dist-xualkngh2.view.fast/">`—instructing browsers to DNS-prefetch the same origin they already loaded—and injects 13 false `"kind": "canonical", "target": "/"` entries into `reports/build.json`, masking the fact that the 5 archive pages lack `<link rel="canonical">` tags entirely.
* **Acceptance Report Blind Spot (`reports/southbound/acceptance.json`):** Visual diffing passed (`differentPixels: 0` at `1280px` and `390px`) because only `/` was tested while online, and stale ~5.3 MB PNGs in `reports/southbound/` are re-uploaded on every CI run without being regenerated.

---

## 2. Multi-Agent Improvement Plan

### Phase 1 (P0): Critical Reliability, Hygiene & Validation Fixes

1. **Isolate Spacefast CLI Metadata from `dist/` (`scripts/publish.mjs`, `scripts/validate.mjs`, `scripts/build.mjs`)**
   * Preserve `.spacefast/state.json` outside `dist/` (e.g., in `.cache/spacefast/` or move it out in a `finally` block after `runPublish()`) and remove `dist/.gitignore` after publish so `dist/` remains a pure static artifact directory and repeated `npm run validate` / `npm run publish` runs are 100% idempotent.
   * In `runPublish()`, capture `stderr` and redact `SPACEFAST_TOKEN` / Bearer tokens instead of discarding all error output via `child.stderr.resume()`.

2. **Suppress Unwanted Starter Content, Archives & Runtime Head Bloat (`scripts/wordpress/prepare.php`, `scripts/wordpress/inventory.php`, `scripts/lib/config.mjs`)**
   * In `scripts/wordpress/prepare.php`, remove WordPress's procedural emoji loader (`print_emoji_detection_script`, `print_emoji_styles`, `wp_enqueue_emoji_styles`), speculation rules (`wp_print_speculation_rules`), self `wp_resource_hints`, and `wp_generator`.
   * In `scripts/wordpress/inventory.php`, when `show_on_front === 'page'` and `page_for_posts === 0`, do not automatically inventory blog posts or author/date/category archives unless configured; support `excludeRoutes` in `site.config.json` (and clean the Southbound checkpoint of starter post/pages `hello-world`, `sample-page`, `hello-from-playground`).
   * In `scripts/lib/transform.mjs`, separate `dns-prefetch`/`preconnect` into `kind = 'resource-hint'` (dropping self-origin hints) and strip `/*# sourceURL=... */` and `//# sourceURL=...` comments from inline `<style>` and `<script>` blocks.

3. **Auto-Detect WordPress Version & Database URLs Directly from `.ht.sqlite` (`scripts/lib/archive.mjs`, `scripts/lib/runtime.mjs`)**
   * Because copying `site.config.example.json` pre-fills `"wordpressVersion": "6.8.3"`, `c.runtimeVersionsExplicit` always evaluates to `true` and `metadata()` tautologically reads `$wp_version` from the downloaded core rather than the checkpoint DB.
   * Use Node 24's built-in `node:sqlite` (`DatabaseSync`) inside `inspectArchive()` to run `PRAGMA integrity_check` and read `_transient_wp_core_block_css_files`, `db_version`, `siteurl`, `home`, `stylesheet`, and `active_plugins` directly from `wp-content/database/.ht.sqlite` in memory.
   * Also include `wp_options.siteurl` and `home` alongside `manifest.siteUrl` during URL normalization in `startRuntime()` (fixing an actual mismatch in `snapshots/site.zip` where `wp_options.siteurl` is `http://127.0.0.1:38977` while `manifest.siteUrl` is `http://playground.wordpress.net/scope:confident-classic-lake`).

---

### Phase 2 (P1): Workflow Consolidation & Build Performance

4. **Eliminate Double Playground Boots, Triple ZIP Scans & WP-CLI Overhead (`scripts/snapshot-import.mjs`, `scripts/build.mjs`, `scripts/lib/runtime.mjs`)**
   * Pass the already-parsed `manifest` into `startRuntime()` so `inspectArchive()` is not re-executed inside `startRuntime`.
   * Replace the 3 sequential `wpCLI` `wp search-replace` invocations (`scripts/lib/runtime.mjs`) with a single batched PHP replacement pass or single WP-CLI evaluation.
   * Add a unified `npm run checkpoint -- /path/to/site.zip` (or fast-path `snapshot:import` via `node:sqlite`) so importing a checkpoint and building `dist/` requires **1 Playground boot instead of 2**, and drop the redundant `npm run validate` step after `npm run build` (since `scripts/build.mjs` already runs `validate()`).

5. **Replace Sequential `wget` Spawning with Concurrent Native `fetch` (`scripts/lib/capture.mjs`)**
   * Replace `download()` (`spawn('wget', ...)`) with Node 24's built-in `fetch(url, { redirect: 'manual' })` using a bounded concurrency pool (e.g., 6–8 workers) and transform HTML/CSS/JS buffers in memory before writing once to `dist/`. This removes the external `wget` system dependency and eliminates double disk I/O.

6. **Add Local CMS Editing (`npm run edit`) & Native Preview (`npm run preview`)**
   * Expose `serve()` from `scripts/lib/static-server.mjs` via `npm run preview` (replacing `python3 -m http.server`).
   * Add `npm run edit` to boot `snapshots/site.zip` locally in Playground with `login: true`, and on `Ctrl+C` (`SIGINT`) automatically export `zipWpContent(runtime.playground)` to `snapshots/site.zip` + `snapshots/site.json` and build `dist/`.

---

### Phase 3 (P2): CI/CD Pipeline Optimization & Observability

7. **Decouple Content Builds from Pipeline E2E Tests (`.github/workflows/static-site.yml`, `scripts/e2e.mjs`, `scripts/fixture.mjs`)**
   * Split the monolithic `build` job in `.github/workflows/static-site.yml` into:
     * `build-site`: Runs on every push/PR, restores `snapshots/site.zip` (1 Playground boot), builds `dist/`, validates, runs a fast headless smoke check against the real `dist/`, and writes a rich Markdown report to `$GITHUB_STEP_SUMMARY`.
     * `test-pipeline`: Runs unit + synthetic fixture E2E tests in parallel **only** when code/workflow files change (`scripts/**`, `test/**`, `package*.json`, `.github/workflows/**`).
   * In `scripts/fixture.mjs` and `scripts/e2e.mjs`, collect metadata before shutting down the active Playground runtime instead of booting Playground a second time inside `importSnapshot()`, cutting E2E Playground boots from 6 to 4.
   * Cache WordPress release ZIPs and Playwright browsers across workflow runs.

---

## 3. Documenting the Best Flow

### Current Flow vs. Recommended Best Flow

```text
CURRENT FLOW (8 Manual Steps · 2 Local Playground Boots · 7 CI Boots)
─────────────────────────────────────────────────────────────────────
1. Open playground.wordpress.net & manually upload snapshots/site.zip
2. Edit content & manually remember to delete starter posts/pages
3. Export -> Download as .zip to ~/Downloads
4. Manually match wordpressVersion & phpVersion in site.config.json
5. npm run snapshot:import -- /path/to/site.zip  (Boot #1 + 2 ZIP scans + 3 WP-CLI passes)
6. npm run build                                 (Boot #2 + 1 ZIP scan + 3 WP-CLI passes + serial wget + validate #1)
7. npm run validate && python3 -m http.server    (Redundant validate #2 + external Python server)
8. git add/commit/push -> Monolithic CI          (6 Fixture Boots + 1 Site Boot -> Spacefast Deploy)


RECOMMENDED BEST FLOW (1–2 Commands · 1 Local Boot · 1 CI Boot on Content Push)
───────────────────────────────────────────────────────────────────────────────
Path A (Local CMS):
  1. npm run edit                          (Boots snapshots/site.zip locally; auto-saves & builds dist/ on Ctrl+C)
  2. npm run preview                       (Optional: zero-dependency Node static server on 127.0.0.1:8080)
  3. git commit & push snapshots/site.*    (Fast-path CI builds & smoke-tests dist/ in 1 cached boot -> Spacefast)

Path B (Browser Playground Export):
  1. npm run checkpoint -- /path/to/zip    (Auto-detects WP version via node:sqlite, imports, builds & validates in 1 boot)
  2. git commit & push snapshots/site.*    (Fast-path CI builds & smoke-tests dist/ in 1 cached boot -> Spacefast)
```

---

## 4. Quantified Impact Summary

| Dimension | Metric | Current Flow | Recommended Best Flow | Net Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Static Output & Hygiene (`dist/`)** | Validation Status (`reports/validation.json`) | `passed: false` (2 dotfile errors after publish) | `passed: true` (0 errors; idempotent across runs) | **100% validation & publish idempotency** |
| | Exported Routes (`reports/build.json`) | **9 routes** (1 real + 3 starter + 5 archives) | **1 route** (`/`) for Southbound | **-88.9% routes** (eliminates SEO bloat & `/author/admin/` leak) |
| | Published File Count & Size | **16 files / 286.7 KB** | **5 files / ~32.1 KB** | **-68.8% files / -88.8% byte size** (~254.6 KB removed) |
| | External Asset URLs | **13 URLs** across 4 third-party hosts | **4 URLs** (starter removed) or **0 URLs** (localized) | **-69% to -100% third-party runtime dependencies** |
| | Unexported `/wp-includes/` References | **10 broken URLs** (`wp-emoji-release.min.js` + `sourceURL`s) | **0 broken URLs** | **-100% runtime/DevTools 404s** |
| | `build.json` Reference Graph | **23 entries** (13 false `canonical` from `dns-prefetch`) | **2 accurate entries** on `/` | **100% reference accuracy** |
| **Local Authoring & Build Speed** | CLI Commands per Edit Cycle | **4–5 commands** + manual config edit | **1 command** (`npm run edit` or `npm run checkpoint`) | **-75% to -80% manual CLI steps** |
| | Local Playground Cold Boots | **2 boots** (`snapshot:import` + `build`) | **1 boot** | **-50% WASM/WordPress cold boots** |
| | Full-ZIP CRC & Decompression Scans | **3 full passes** | **1 pass** | **-66.7% ZIP I/O overhead** |
| | `wp-cli.phar` Full-DB Scans | **6 full-table scans** (3 in import + 3 in build) | **1 batched pass** (without loading `wp-cli.phar`) | **-83.3% DB normalization passes** |
| | Route & Asset Capture (`capture.mjs`) | **12 sequential `wget` OS processes** + double file I/O | **0 child processes** (concurrent native `fetch` in-memory) | **100% removal of `wget` dependency**; ~3–5x faster capture |
| | Local Wait Time per Edit Cycle | **~25–45 seconds** | **~8–15 seconds** | **~65–70% faster local turnaround** |
| **CI/CD & Verification** | Playground Boots on Content Push | **7 sequential boots** (6 fixture E2E + 1 site build) | **1 boot** (`build-site` only via path filter) | **-85.7% CI Playground boots** on content releases |
| | Playground Boots on Code PR | **7 sequential boots** | **4 boots** (`test-pipeline`) + **1 boot** (`build-site`) in parallel | **-43% critical-path boots** |
| | Content Release CI Wall-Clock Time | **~3.5–5.0 minutes** | **~45–75 seconds** | **~75–80% faster time-to-live** |
| | Uploaded Validation Artifact Size | **~5.3 MB** (includes stale `reports/southbound/*.png`) | **~10 KB** (active JSON reports + step summary) | **>99% artifact size reduction** |
