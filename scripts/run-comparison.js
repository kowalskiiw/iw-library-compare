#!/usr/bin/env node
// Compares snapshots/library.json with a branch snapshot, then
//   1) creates/updates the Confluence page
//   2) writes the changelog entry (site/data/entries/<id>.json + entries.json)
//
// Usage (CI does this automatically):
//   node scripts/run-comparison.js                      # branch snapshots changed in the last commit
//   node scripts/run-comparison.js --file snapshots/branches/<key>.json
//   add --dry-run to skip all network calls and write the Confluence HTML to ./out
// Test options: --library <path>  --data-dir <dir>  --out <dir>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { compareSnapshots } from './lib/diff.js';
import { buildEntry, indexItem } from './lib/entry.js';
import { buildStorage, upsertPage, fetchIssue } from './lib/confluence.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) { args[k] = next; i++; } else args[k] = true;
}

const DRY = Boolean(args['dry-run']) || process.env.DRY_RUN === '1';
const LIB_PATH = args.library || 'snapshots/library.json';
const DATA_DIR = args['data-dir'] || 'site/data';
const OUT_DIR = args.out || 'out';

const env = process.env;
const atlassian = { domain: env.ATLASSIAN_DOMAIN, email: env.ATLASSIAN_EMAIL, token: env.ATLASSIAN_API_TOKEN };
const haveAtlassian = Boolean(atlassian.domain && atlassian.email && atlassian.token);
const siteUrl = env.SITE_URL || '';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

function snapshotFiles() {
  const explicit = args.file || env.SNAPSHOT_INPUT;
  if (explicit) return [explicit];
  try {
    const out = execSync('git diff --name-only HEAD~1 HEAD -- snapshots/branches', { encoding: 'utf8' }).trim();
    return out ? out.split('\n').filter((f) => f.endsWith('.json') && existsSync(f)) : [];
  } catch {
    return [];
  }
}

async function resolveTicket(key) {
  if (!key) return null;
  const k = String(key).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(k)) {
    console.warn(`   ⚠ "${key}" does not look like a Jira key — ignoring.`);
    return null;
  }
  const info = { key: k, url: atlassian.domain ? `https://${atlassian.domain}/browse/${k}` : null, summary: null, type: null };
  if (!DRY && haveAtlassian) {
    try {
      const issue = await fetchIssue({ ...atlassian, key: k });
      if (issue) Object.assign(info, issue);
    } catch (e) {
      console.warn('   ⚠ Could not look up Jira issue:', e.message);
    }
  }
  return info;
}

async function main() {
  if (!existsSync(LIB_PATH)) {
    throw new Error(`${LIB_PATH} not found. Run the plugin in the library (main) file first and click “Save library snapshot”.`);
  }
  const files = snapshotFiles();
  if (!files.length) { console.log('No branch snapshot to process.'); return; }

  const library = readJson(LIB_PATH);
  mkdirSync(join(DATA_DIR, 'entries'), { recursive: true });
  if (DRY) mkdirSync(OUT_DIR, { recursive: true });
  const indexPath = join(DATA_DIR, 'entries.json');
  let index = existsSync(indexPath) ? readJson(indexPath) : [];

  for (const file of files) {
    console.log(`▶ ${file}`);
    const branch = readJson(file);
    const diff = compareSnapshots(library, branch);
    const id = (branch.meta && branch.meta.branchKey) || null;
    const entryPath = id ? join(DATA_DIR, 'entries', `${id}.json`) : null;
    const existing = entryPath && existsSync(entryPath) ? readJson(entryPath) : null;
    const ticket = await resolveTicket(branch.meta && branch.meta.ticket);
    const entry = buildEntry({ diff, library, branch, existing, ticket });

    const title = `Library comparison: ${entry.title}`;
    const body = buildStorage(entry, { siteUrl });
    if (DRY) {
      writeFileSync(join(OUT_DIR, `confluence-${entry.id}.html`), body);
      console.log(`   dry-run: wrote ${join(OUT_DIR, `confluence-${entry.id}.html`)}`);
    } else if (haveAtlassian && env.CONFLUENCE_SPACE_ID) {
      const page = await upsertPage({
        ...atlassian,
        spaceId: env.CONFLUENCE_SPACE_ID,
        parentId: env.CONFLUENCE_PARENT_ID,
        title, body,
        pageId: entry.confluence && entry.confluence.id,
        message: 'Updated by IW Library Compare',
      });
      entry.confluence = page;
      console.log(`   Confluence: ${page.url}`);
    } else {
      console.warn('   ⚠ Confluence skipped (ATLASSIAN_* secrets or CONFLUENCE_SPACE_ID missing).');
    }

    writeJson(join(DATA_DIR, 'entries', `${entry.id}.json`), entry);
    index = [indexItem(entry), ...index.filter((e) => e.id !== entry.id)]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    writeJson(indexPath, index);

    const s = entry.summary.components;
    console.log(`   ✅ ${entry.title}: ${s.affected} changed, ${s.added} added, ${s.removed} removed — ${entry.summary.namingOnly ? 'naming-only' : 'contains non-naming changes'}`);
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
