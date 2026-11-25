# IW Library Compare

Compares a Figma library **branch** with the **library** and publishes the result in two places from one data source:

- a **Confluence page** (what changed, for developers and QA), and
- an **entry on a changelog site** (Netlify) with a detail page that mirrors the Confluence page.

This is a separate project. It does not touch the existing changelog pipeline.

## How it works

```
Figma plugin (library file)  ──"Save library snapshot"──►  snapshots/library.json
Figma plugin (branch file)   ──"Compare & publish"─────►  snapshots/branches/<branch-key>.json
                                                              │  (push triggers the Action)
                                                              ▼
                              GitHub Action: scripts/run-comparison.js
                                 ├─ diff (matched by Figma IDs → renames show up as "changed")
                                 ├─ Confluence page  (create, or update on re-run)
                                 └─ site/data/entries/<branch-key>.json + entries.json
                                                              │  (push triggers Netlify)
                                                              ▼
                                       Changelog site: index.html + detail.html?id=<branch-key>
```

A plugin can only read the file it is open in, which is why the library and the branch each get their own snapshot.

One entry exists per branch. Comparing the same branch again updates its entry and its Confluence page instead of creating duplicates.

## Setup

### 1. GitHub repository
Create a new repository and upload the contents of this folder (keep the structure).
The workflow listens to the `main` branch; change `branches: [main]` in `.github/workflows/compare.yml` if yours differs.

Repository secrets (Settings → Secrets and variables → Actions → Secrets):

| Secret | Value |
|---|---|
| `ATLASSIAN_DOMAIN` | `interwetten.atlassian.net` |
| `ATLASSIAN_EMAIL` | your Atlassian e-mail |
| `ATLASSIAN_API_TOKEN` | API token from id.atlassian.com → Security |

Repository variables (same page → Variables):

| Variable | Value |
|---|---|
| `CONFLUENCE_SPACE_ID` | numeric space id where the pages are created |
| `CONFLUENCE_PARENT_ID` | optional: id of the page they should be created under |
| `SITE_URL` | optional: Netlify URL, adds a link to the changelog entry on the Confluence page |

Secrets are per repository, so they have to be created again here.

### 2. Netlify
New site → import the new repository. Build command: none. Publish directory: `site` (already set in `netlify.toml`).

### 3. Figma plugin
Figma desktop → Plugins → Development → Import plugin from manifest → `plugin/manifest.json`.
Open the plugin, expand **Settings** and enter the GitHub owner, repository and a fine-grained token with **Contents: Read and write** for this repository only.

## Usage

1. In the **library (main) file**: Plugin → tab *Library snapshot* → **Save library snapshot**.
   Repeat whenever the library has changed since the last snapshot.
2. In the **branch file**: Plugin → tab *Compare branch*:
   - paste the Figma link of the branch,
   - optionally enter the Jira ticket (e.g. `CXI-2132`),
   - click **Compare & publish**.
3. After one to two minutes the Confluence page and the changelog entry exist.

## What is compared

Pages, styles (color, text, effect, grid), variables (all modes), component names, descriptions, variant properties and values, and an appearance fingerprint per component (fills, strokes, radii, effects, spacing, text, style and variable bindings).

- Variant property and value renames are derived from the variant names (matched by node ID), so a renamed property or value is shown as a rename, not as removed + added.
- The appearance fingerprint tells you **that** something changed in a component, not **which** property.
- Not compared: overrides inside nested instances and prototype interactions.

## Local test

```
npm test
```

Builds sample snapshots, runs the whole pipeline in dry-run mode (no network) and checks the results. The generated Confluence markup is written to `tests/out/`.

You can also run a real snapshot pair locally in dry-run mode:

```
node scripts/run-comparison.js --dry-run --file snapshots/branches/<key>.json
```
