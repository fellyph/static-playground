# Static Playground

Edit a WordPress site in Playground, save a complete checkpoint to GitHub, and publish its rendered pages to Spacefast. The public website needs no PHP server or database.

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

## Edit, checkpoint, publish

1. Edit in WordPress Playground, manually or using its WebMCP tools.
2. From Playground's Export menu, choose **Download as ZIP**.
3. Import the ZIP locally:

   ```sh
   npm run snapshot:import -- /absolute/path/to/site.zip
   npm run build
   npm run validate
   ```

4. Commit `snapshots/site.zip` and `snapshots/site.json` together and push to `main`. Git LFS stores the archive; Git records each checkpoint's checksum and metadata.
5. GitHub Actions rebuilds and validates the checkpoint, then publishes only `dist` to Spacefast.

The importer validates ZIP paths, CRCs, database header, export manifest, and archive size, then restores the site and checks SQLite integrity before replacing the checkpoint. WordPress downloads use an exact official release URL because the CLI's numeric version resolver can select a newer release candidate. Import and build both verify the running WordPress and PHP versions against the requested checkpoint. Interrupted imports are caught by the archive/metadata checksum check on build. V1 accepts current root-level Playground ZIP exports up to 250 MiB compressed / 1 GiB expanded.

Blueprint steps run against an isolated, temporary WordPress runtime. The original archive is never mounted writable or modified. Treat snapshots as trusted executable site source: installed plugins and themes run during restoration. Only use checkpoints from trusted editors.

After import, WP-CLI performs serialization-aware replacement of the old site URL and browser scope in the temporary database, including escaped JSON URLs, while preserving GUIDs. This is necessary because the importer alone does not translate browser scope URLs into the CLI's loopback origin. The original ZIP remains unchanged. Automatic updates and cron are disabled in the build runtime; archive operations use one worker because their temporary files must stay in the same worker filesystem.

## GitHub Actions setup

Configure repository variables:

- `PRODUCTION_URL`: e.g. `https://your-site.spacefast.com` (use the actual URL assigned to your Space).
- `SPACEFAST_SPACE`: the existing Space ID or slug.

Configure repository secret `SPACEFAST_TOKEN` with a Spacefast `ci_deploy` token. Create it using `sf api-keys create --name "CI publish" --preset ci_deploy` after `sf login`; store the value directly in GitHub Secrets. Do not commit the token or paste it into issue text. An authenticated MCP connection and CLI authentication are separate; CI still needs its own publishing credential.

The workflow runs unit tests and a generated-fixture browser test, builds the committed checkpoint, and uploads static output and reports. Pull requests never receive the publishing secret. The separate deployment job publishes on `main`, serializes releases, and skips commits superseded by the current branch head. Failed builds do not deploy; deployment errors fail the job. The deployment artifact records commit, checkpoint checksum, version, and live URL.

Before destination variables are configured, CI validates using `https://fixture.example` and explicitly skips deployment. After both variables are set, a missing/invalid token fails deployment.

The committed checkpoint is **Southbound Surf Crew**, exported from the saved Playground site `confident-classic-lake` on September 14, 2026. It restores WordPress 7.1 / PHP 8.3, the `southbound` block theme, and homepage ID 6. It includes the original starter pages and post; the draft privacy page stays unpublished. Unsplash images and Google Fonts remain external dependencies. The ZIP contains the actual saved site's complete `wp-content`, SQLite database, `wp-config.php`, and format-2 export manifest. Its checksum is recorded in `snapshots/site.json`. The generated acceptance fixture remains separate under `.cache/fixture`.

For local deployment, set `SPACEFAST_TOKEN` in your environment and run `npm run publish`. The command revalidates the static output and requires its production URL to match the destination configuration.

## What is exported

WordPress supplies a route inventory: homepage, published pages and posts, public custom post types, taxonomy and author/date archives, pagination, and multipage posts. Add unlinked custom routes to `additionalRoutes` in the configuration. Wget downloads those routes; HTML/CSS parsers discover their assets, including responsive images, CSS imports, and fonts. An ES module parser discovers static module imports and literal dynamic imports. Internal URLs become site-relative paths; canonical and social URLs use the configured production origin.

Only public pages and discovered assets are emitted. PHP, ZIP backups, databases, admin/REST endpoints, dotfiles, and local query-string page URLs are rejected. Password-protected posts are excluded from inventory and rendered queries. Build-time filters suppress admin bars, comment submission, pingbacks, and discovery links for feeds/REST/oEmbed. A static sitemap, robots file, and simple 404 page are generated. The static 404 intentionally does not preserve a theme's server-side search form.

Native forms, search, commerce, accounts, and other server-dependent features are not supported. HTML forms cause the build to fail with an actionable error. External asset dependencies are reported and retained; they still depend on their external host. Arbitrary JavaScript-generated URLs, fetch calls, nonliteral dynamic imports, or plugin endpoints require an export adaptation. Static validation is not proof that every plugin's runtime behavior is supported; the browser tests verify the included fixture.

## Verification and recovery

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

The fixture lives under `.cache/fixture`, separate from your checkpoint. Tests create uploaded images, nested pages, blog pagination, and database-backed Site Editor styles/template parts. They compare desktop/mobile WordPress and static screenshots, stop WordPress before testing static navigation, verify unpublished content is absent, then restore, edit, checkpoint, and rebuild a second time. Reports and screenshots remain under `.cache/fixture/reports`.

To inspect the fixture build with the normal CLI:

```sh
SITE_CONFIG=.cache/fixture/site.config.json SNAPSHOT_DIR=.cache/fixture/snapshots npm run build
```

Restore editing by importing `snapshots/site.zip` through Playground's **Import ZIP**. Recover an earlier revision by checking it out, running `git lfs pull`, and importing that revision's ZIP. Roll back production by reverting to the earlier checkpoint commit and pushing to `main`.

## Runtime compatibility

Playground CLI is pinned to 3.1.53: the inspected 3.1.54 npm package omitted its SQLite bundle. A narrow, checked postinstall patch binds the 3.1.53 ESM HTTP listener explicitly to `127.0.0.1`; that release otherwise advertises loopback while listening on all interfaces. Startup verifies the bound address. Review/remove this patch only when upgrading to a verified upstream release. Patched transitive versions of `qs`, `js-yaml`, and `esbuild` are locked via overrides.

Public interface: `snapshot:import`, `build`, `validate`, `publish`, `test`, and `test:e2e`. Advanced testing overrides: `SITE_CONFIG`, `SNAPSHOT_DIR`, `OUTPUT_DIR`, and `REPORT_DIR`.
