# Reusable WordPress theme → Spacefast action

The root `action.yml` is a composite action. It installs its own locked Node.js
dependencies and renders a caller's block theme using a saved Playground content
checkpoint. The caller does not need this project's scripts or `package.json`.
Ubuntu runners with Node.js 24 and Wget are supported; the action installs Node
and installs Wget with `apt-get` when missing.

## Use from another repository

Check out the caller repository first, including Git LFS checkpoint files. Keep
the theme in a dedicated subdirectory, separate from output and report directories:

```text
themes/my-theme/       # style.css, theme.json, templates/index.html, assets, ...
snapshots/site.zip    # Complete trusted Playground export
snapshots/site.json   # Matching checksum and WordPress/PHP restore metadata
.github/workflows/publish.yml
```

After the action has a `v1` tag, a caller can use this workflow. Until then, use
the reviewed action commit SHA in place of `v1`. A SHA pin also gives consumers
an immutable version. A private action repository must grant the caller access
under Settings → Actions → General; public consumers need a public action repository.

```yaml
name: Publish WordPress theme site
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  publish:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: spacefast-production
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v5
        with:
          lfs: true
          persist-credentials: false
      - uses: fellyph/static-playground@v1
        id: site
        with:
          mode: build-and-publish
          theme-path: themes/my-theme
          theme-slug: my-theme
          snapshot-path: snapshots
          production-url: ${{ vars.PRODUCTION_URL }}
          spacefast-space: ${{ vars.SPACEFAST_SPACE }}
        env:
          SPACEFAST_TOKEN: ${{ secrets.SPACEFAST_TOKEN }}
```

Create the destination Space first. Set repository variables `PRODUCTION_URL`
(its actual HTTPS origin) and `SPACEFAST_SPACE` (its ID or slug), and store a
Spacefast `ci_deploy` token in `SPACEFAST_TOKEN`. The action updates that existing
Space. It does not change the Space's access policy.

## Inputs and outputs

All file paths are relative to `github.workspace`, including when the action is
downloaded into a separate directory. The action's implementation and dependency
paths are resolved from its own directory. Theme, checkpoint, output, and reports
must be separate subdirectories of the caller workspace; overlapping paths,
workspace roots, and paths escaping the workspace are rejected before rendering.

| Input | Default | Purpose |
| --- | --- | --- |
| `mode` | `build` | `build`, `publish`, or `build-and-publish`. |
| `theme-path` | — | Theme directory; required in modes that build. |
| `theme-slug` | Directory name | Installed WordPress stylesheet slug. |
| `snapshot-path` | `snapshots` | Directory containing `site.zip` and `site.json`. |
| `config-path` | Optional `site.config.json` | Caller export settings, such as additional routes. |
| `output-path` | `dist` | Public output; replaced during a build. |
| `report-path` | `reports` | Build, validation, and deployment JSON reports. |
| `production-url` | Required | HTTPS origin for canonical URLs. |
| `spacefast-space` | — | Existing destination; required when publishing. |

`SPACEFAST_TOKEN` is supplied through the step environment, not a command-line
argument. Build-only mode needs no token. Publishing is refused on
`pull_request` and `pull_request_target` events. Keep the token out of test jobs.

Outputs are `output-path`, `report-path`, `theme-sha256`, and `live-url`. The first
two are absolute paths. `live-url` is populated only after publishing. The action
also writes a GitHub job summary.

## Separate build and deployment jobs

This repository's `.github/workflows/static-site.yml` demonstrates the full flow:

1. Run unit, Site Editor, theme export, and caller-workspace tests.
2. Call the local action with `uses: ./` and `mode: build`.
3. Upload `dist/` and `reports/` as artifacts.
4. In the protected `production` job, download those same artifacts.
5. Call the action with `mode: publish`, the same output/report paths and production
   URL, and the publishing token. No theme source or LFS snapshot is needed in this job.

Publish-only mode revalidates the downloaded files, requires their production URL
to match the requested destination, and checks that the build report belongs to
the caller's `GITHUB_SHA`. The action does not upload or download artifacts itself.
The caller controls branch filters, tests, environments, approval rules, and release
concurrency. The supplied workflow also skips superseded commits.

## Content and theme behavior

The checkpoint supplies the WordPress/PHP versions, database, uploads, and plugins.
The action replaces the chosen theme directory inside a disposable runtime and
activates that theme. Deleted source files are removed. Only rendered public files
are published; the original checkpoint and local theme stay unchanged.

This action supports block themes with `style.css`, `theme.json`, and
`templates/index.html`. A Front Page template is optional. Parent themes for child
themes must already be installed in the checkpoint. Site Editor overrides retain
WordPress's normal precedence over theme files. Export/reset an override in the
source checkpoint if it masks an intended file change.

The action makes no site-specific content migrations. Southbound's legacy homepage
migration remains in `theme:sync`; use that command once when importing its original
HTML-based checkpoint. Other projects supply their own prepared content checkpoint.

## Publish a version of this action

1. Merge the reusable-action PR and let CI pass.
2. Keep `action.yml`, `scripts/`, `package.json`, and `package-lock.json` together.
   The action can remain in this repository. To extract a dedicated public action
   repository, copy those files plus documentation and an appropriate license;
   do not copy site checkpoints, local config, theme assets, or credentials.
3. From the intended release commit, create and push tags:

   ```sh
   git tag -a v1.0.0 -m "Reusable theme publishing action v1.0.0"
   git tag v1
   git push origin v1.0.0 v1
   gh release create v1.0.0 --generate-notes
   ```

4. Callers use `fellyph/static-playground@v1` or the dedicated repository name.
   Keep version tags immutable; advance the major `v1` tag only for compatible
   releases. Document breaking changes under a new major tag.

The PR prepares this structure; it does not create a release, change repository
visibility, or deploy a site. GitHub Marketplace listing is a separate optional step.

References: [GitHub composite actions](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action),
[Spacefast CLI](https://spacefast.com/docs/cli/).
