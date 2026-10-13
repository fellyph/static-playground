# Static Playground

Edit the Southbound block theme in GitHub and publish the rendered site to Spacefast through GitHub Actions. Each build restores the saved WordPress content in Playground, applies `themes/southbound`, and exports the public pages. The public website needs no PHP server or database.

## Reuse this action

The root `action.yml` accepts a caller's theme, content checkpoint, output paths,
and Spacefast destination. It supports build-only, publish-only, and combined
modes, and installs its own dependencies. See [the reusable action guide](docs/reusable-action.md)
for consumer workflows, inputs, outputs, and release instructions. This site's
workflow consumes the local action with `uses: ./`.

## Requirements

- Node.js 24 (`nvm use`), GNU Wget, Git, and Git LFS.
- A **private** GitHub repository: checkpoints include the WordPress database, including users and unpublished content.
- A Spacefast space and a publishing token for deployment.
- A single-site Playground export with pretty permalinks ending in `/`. The fixture uses WordPress 6.8.3, PHP 8.3, and Twenty Twenty-Five.

On macOS: `brew install wget git-lfs`. On Ubuntu: `sudo apt-get install wget git-lfs`.

```sh
npm ci
git lfs install --local
cp site.config.example.json site.config.json
```

Set the production HTTPS origin and Spacefast Space ID in `site.config.json`. Set the WordPress/PHP versions to those used in Playground **before importing**. Browser export manifests do not record runtime versions; the importer records the selected restore versions, active theme, installed theme/plugin versions, and SQLite integrity result. Environment variables `PRODUCTION_URL` and `SPACEFAST_SPACE` override the corresponding configuration fields.

## Edit the theme and publish

1. Edit the templates, patterns, styles, or assets under `themes/southbound`.
2. Build locally with `npm run build:theme`. The validated static site is written to `dist/`.
3. Commit the theme changes and open a pull request. GitHub Actions tests the theme in Playground and validates the static build.
4. Merge to `main`. The **Publish theme site to Spacefast** workflow publishes that build to the configured Space. You can also use **Actions → Publish theme site to Spacefast → Run workflow** on `main`.

You do not need to update the snapshot for theme-only edits. `build:theme` replaces
the theme inside a disposable Playground, including removing files deleted from
the source. It retains the saved site's content, uploads, settings, and Site Editor
overrides. The checkpoint and source files are not modified. Build and deployment
reports record the source commit, checkpoint checksum, and theme checksum.

Configure the destination variables and token below before the first deployment.

The Southbound theme source lives in `themes/southbound`. Its homepage uses native
WordPress blocks in the **Front Page** template, with separate **Header** and
**Footer** template parts. Open Appearance → Editor → Design → Templates → Front
Page to edit the layout, copy, images, navigation, buttons, and Details blocks.
The editor loads the theme styles and keeps the hero image stationary while you
work; the public site retains the scroll effect. The homepage page supplies its
URL and front-page assignment; the layout is owned by the template. The original
Custom HTML layout is retained in a page revision in the migrated checkpoint.

To save the current theme into a portable editing checkpoint, run `npm run theme:sync` to restore an
isolated Playground, copy the source into it, and update the checkpoint and
metadata together. This command migrates only the original, checksum-matched
Southbound homepage and refuses unrecognized homepage content. Existing Site
Editor template overrides remain in the database and take precedence over theme
files; reset an override in the editor only when you intend to use the file version.
For a temporary ZIP without replacing the checkpoint, use
`npm run theme:sync -- --output .cache/theme-preview.zip`.

## Update content in Playground

1. Edit in WordPress Playground, manually or using its WebMCP tools.
2. From Playground's Export menu, choose **Download as ZIP**.
3. Import the ZIP locally:

   ```sh
   npm run snapshot:import -- /absolute/path/to/site.zip
   npm run build:theme
   ```

4. Commit `snapshots/site.zip` and `snapshots/site.json` together and push to `main`. Git LFS stores the archive; Git records each checkpoint's checksum and metadata.
5. GitHub Actions combines that content checkpoint with the committed theme, validates the rendered site, and publishes only `dist` to Spacefast.

Site Editor template and global-style overrides still take precedence over theme
files. Export those changes into theme source or reset the corresponding override
in the editor when you want a file edit to control that part of the site. The
snapshot-only `npm run build` remains available for reproducing an exported site.

The importer validates ZIP paths, CRCs, database header, export manifest, and archive size, then restores the site and checks SQLite integrity before replacing the checkpoint. WordPress downloads use an exact official release URL because the CLI's numeric version resolver can select a newer release candidate. Import and build both verify the running WordPress and PHP versions against the requested checkpoint. Interrupted imports are caught by the archive/metadata checksum check on build. V1 accepts current root-level Playground ZIP exports up to 250 MiB compressed / 1 GiB expanded.

Blueprint steps run against an isolated, temporary WordPress runtime. The original archive is never mounted writable or modified. Treat snapshots as trusted executable site source: installed plugins and themes run during restoration. Only use checkpoints from trusted editors.

After import, WP-CLI performs serialization-aware replacement of the old site URL and browser scope in the temporary database, including escaped JSON URLs, while preserving GUIDs. This is necessary because the importer alone does not translate browser scope URLs into the CLI's loopback origin. The original ZIP remains unchanged. Automatic updates and cron are disabled in the build runtime; archive operations use one worker because their temporary files must stay in the same worker filesystem.

## GitHub Actions setup

Configure repository variables:

- `PRODUCTION_URL`: e.g. `https://your-site.spacefast.com` (use the actual URL assigned to your Space).
- `SPACEFAST_SPACE`: the existing Space ID or slug.

Configure repository secret `SPACEFAST_TOKEN` with a Spacefast `ci_deploy` token. Create it using `sf api-keys create --name "CI publish" --preset ci_deploy` after `sf login`; store the value directly in GitHub Secrets. Do not commit the token or paste it into issue text. An authenticated MCP connection and CLI authentication are separate; CI still needs its own publishing credential.

The workflow runs unit tests, the generated-fixture browser test, and Site Editor tests against the committed theme. A theme build regression check proves that template/CSS edits absent from the snapshot reach the static output and that deleted theme files do not survive. It verifies the reusable action with a different theme in a separate caller workspace, then calls the local action in build mode and uploads the validated static output and reports. Pull requests never receive the publishing secret. The separate deployment job publishes on `main`, serializes releases, and skips commits superseded by the current branch head. Failed builds do not deploy; deployment errors fail the job. The deployment artifact records commit, checkpoint checksum, theme checksum, version, and live URL.

Before destination variables are configured, CI validates using `https://fixture.example` and explicitly skips deployment. After both variables are set, a missing/invalid token fails deployment.

The committed checkpoint is **Southbound Surf Crew**, originally exported from the saved Playground site `confident-classic-lake` on September 14, 2026. It restores WordPress 7.1 / PHP 8.3, the `southbound` block theme, and homepage ID 6. It includes the original starter pages and post; the draft privacy page stays unpublished. Unsplash images remain external dependencies; the theme fonts and their licenses are packaged locally. The ZIP contains the saved site's complete `wp-content`, SQLite database, `wp-config.php`, and format-2 export manifest. Its checksum is recorded in `snapshots/site.json`. The generated acceptance fixture remains separate under `.cache/fixture`.

For local deployment, set `SPACEFAST_TOKEN` in your environment, run `npm run build:theme`, then `npm run publish`. The command revalidates the static output and requires its production URL to match the destination configuration.

## What is exported

WordPress supplies a route inventory: homepage, published pages and posts, public custom post types, taxonomy and author/date archives, pagination, and multipage posts. Add unlinked custom routes to `additionalRoutes` in the configuration. Wget downloads those routes; HTML/CSS parsers discover their assets, including responsive images, CSS imports, and fonts. An ES module parser discovers static module imports and literal dynamic imports. Internal URLs become site-relative paths; canonical and social URLs use the configured production origin.

Only public pages and discovered assets are emitted. PHP, ZIP backups, databases, admin/REST endpoints, dotfiles, and local query-string page URLs are rejected. Password-protected posts are excluded from inventory and rendered queries. Build-time filters suppress admin bars, comment submission, pingbacks, and discovery links for feeds/REST/oEmbed. A static sitemap, robots file, and simple 404 page are generated. The static 404 intentionally does not preserve a theme's server-side search form.

Native forms, search, commerce, accounts, and other server-dependent features are not supported. HTML forms cause the build to fail with an actionable error. External asset dependencies are reported and retained; they still depend on their external host. Arbitrary JavaScript-generated URLs, fetch calls, nonliteral dynamic imports, or plugin endpoints require an export adaptation. Static validation is not proof that every plugin's runtime behavior is supported; the browser tests verify the included fixture.

## Verification and recovery

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run test:theme
npm run test:theme-build
npm run test:action
```

The fixture lives under `.cache/fixture`, separate from your checkpoint. Tests create uploaded images, nested pages, blog pagination, and database-backed Site Editor styles/template parts. They compare desktop/mobile WordPress and static screenshots, stop WordPress before testing static navigation, verify unpublished content is absent, then restore, edit, checkpoint, and rebuild a second time. Reports and screenshots remain under `.cache/fixture/reports`.

To inspect the fixture build with the normal CLI:

```sh
SITE_CONFIG=.cache/fixture/site.config.json SNAPSHOT_DIR=.cache/fixture/snapshots npm run build
```

Restore editing by importing `snapshots/site.zip` through Playground's **Import ZIP**. Recover an earlier revision by checking it out, running `git lfs pull`, and importing that revision's ZIP. Roll back production by reverting the theme or content checkpoint changes and pushing to `main`.

## Runtime compatibility

Playground CLI is pinned to 3.1.53: the inspected 3.1.54 npm package omitted its SQLite bundle. A narrow, checked postinstall patch binds the 3.1.53 ESM HTTP listener explicitly to `127.0.0.1`; that release otherwise advertises loopback while listening on all interfaces. Startup verifies the bound address. Review/remove this patch only when upgrading to a verified upstream release. Patched transitive versions of `qs`, `js-yaml`, and `esbuild` are locked via overrides.

Public interface: `snapshot:import`, `theme:sync`, `build:theme`, `build`, `validate`, `publish`, `test`, `test:e2e`, `test:theme`, `test:theme-build`, and `test:action`. The theme test verifies Site Editor save/reload, native block validation, responsive layout, and hero motion in an isolated Chromium/Playground instance after applying the local theme source. The theme build test verifies source edits, deletions, and checkpoint preservation. Advanced testing overrides: `SITE_CONFIG`, `SNAPSHOT_DIR`, `OUTPUT_DIR`, `REPORT_DIR`, and `TEST_SNAPSHOT` (theme test ZIP).
