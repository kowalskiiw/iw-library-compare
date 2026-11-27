#!/usr/bin/env node
// Two jobs, both triggered by pushes (see .github/workflows/compare.yml):
//
//  A) COMPARE  a branch snapshot (snapshots/branches/<key>.json) changed
//       → diff against snapshots/library.json
//       → create/update the Confluence page
//       → write the changelog entry (site/data/entries/<id>.json + entries.json)
//
//  B) RE-CHECK snapshots/library.json changed (someone saved a new library snapshot,
//     normally after a merge)
//       → for every entry that is still "in review": is everything it touched in the
//         library now? If yes the entry becomes "merged", its links switch to the
//         library and its Confluence page is updated.
//
// Usage:
//   node scripts/run-comparison.js                 # decide from the last commit
//   node scripts/run-comparison.js --file snapshots/branches/<key>.json
//   node scripts/run-comparison.js --recheck       # run job B explicitly
//   node scripts/run-comparison.js --republish     # rebuild every Confluence page from the stored
//                                                  # entries (no new diff), e.g. after a title/wording change
//   add --dry-run to skip all network calls (Confluence HTML is written to ./out)
// Test options: --library <path>  --data-dir <dir>  --out <dir>  --branches-dir <dir>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { compareSnapshots } from './lib/diff.js';
import { buildEntry, indexItem } from './lib/entry.js';
import { applyStatus } from './lib/status.js';
import { buildStorage, upsertPage, fetchIssue } from './lib/confluence.js';
import { entryHeadline } from '../site/assets/describe.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) { args[k] = next; i++; } else args[k] = true;
}

const env = process.env;
const DRY = Boolean(args['dry-run']) || env.DRY_RUN === '1';
const LIB_PATH = args.library || 'snapshots/library.json';
const BRANCHES_DIR = args['branches-dir'] || 'snapshots/branches';
const DATA_DIR = args['data-dir'] || 'site/data';
const OUT_DIR = args.out || 'out';
const RECHECK = Boolean(args.recheck) || env.RECHECK === 'true';
const REPUBLISH = Boolean(args.republish) || env.REPUBLISH === 'true';

const atlassian = { domain: env.ATLASSIAN_DOMAIN, email: env.ATLASSIAN_EMAIL, token: env.ATLASSIAN_API_TOKEN };
const haveAtlassian = Boolean(atlassian.domain && atlassian.email && atlassian.token);
const siteUrl = env.SITE_URL || '';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const indexPath = join(DATA_DIR, 'entries.json');
const entryPath = (id) => join(DATA_DIR, 'entries', `${id}.json`);

let failures = 0;

function changedFiles() {
  try {
    return execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' }).split('\n').filter(Boolean);
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

// Writes/updates the Confluence page. A failure is recorded and the run is marked
// as failed at the end, but the entry data is still written and committed.
async function publish(entry, message) {
  const body = buildStorage(entry, { siteUrl });
  if (DRY) {
    writeFileSync(join(OUT_DIR, `confluence-${entry.id}.html`), body);
    console.log(`   dry-run: wrote ${join(OUT_DIR, `confluence-${entry.id}.html`)}`);
    return;
  }
  if (!(haveAtlassian && env.CONFLUENCE_SPACE_ID)) {
    console.warn('   ⚠ Confluence skipped (ATLASSIAN_* secrets or CONFLUENCE_SPACE_ID missing).');
    return;
  }
  try {
    const page = await upsertPage({
      ...atlassian,
      spaceId: env.CONFLUENCE_SPACE_ID,
      parentId: env.CONFLUENCE_PARENT_ID,
      title: entryHeadline(entry), // identical to the changelog site headline
      body,
      pageId: entry.confluence && entry.confluence.id,
      message,
    });
    entry.confluence = page;
    console.log(`   Confluence: ${page.url}`);
  } catch (e) {
    failures++;
    console.error(`❌ Confluence: ${e.message}`);
  }
}

function saveEntry(entry, index) {
  writeJson(entryPath(entry.id), entry);
  const next = [indexItem(entry), ...index.filter((e) => e.id !== entry.id)]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  writeJson(indexPath, next);
  return next;
}

// ── A) compare ───────────────────────────────────────────────────────────────

async function compare(file, library, index) {
  console.log(`▶ compare ${file}`);
  const branch = readJson(file);
  const diff = compareSnapshots(library, branch);
  const id = (branch.meta && branch.meta.branchKey) || null;
  const existing = id && existsSync(entryPath(id)) ? readJson(entryPath(id)) : null;
  const ticket = await resolveTicket(branch.meta && branch.meta.ticket);
  const entry = buildEntry({ diff, library, branch, existing, ticket });
  applyStatus(entry, library, branch, existing);

  await publish(entry, 'Updated by IW Library Compare');
  const next = saveEntry(entry, index);

  const s = entry.summary.components;
  console.log(`   ✅ ${entryHeadline(entry)} [${entry.status}]: ${s.affected} changed, ${s.added} added, ${s.removed} removed — ${entry.summary.namingOnly ? 'naming-only' : 'contains non-naming changes'}`);
  return { id: entry.id, index: next };
}

// ── B) re-check merge status ─────────────────────────────────────────────────

async function recheck(library, index, skipIds) {
  const open = index.filter((i) => i.status !== 'merged' && !skipIds.has(i.id));
  console.log(`▶ re-check ${open.length} open entr${open.length === 1 ? 'y' : 'ies'}`);
  for (const item of open) {
    const branchFile = join(BRANCHES_DIR, `${item.id}.json`);
    if (!existsSync(entryPath(item.id)) || !existsSync(branchFile)) {
      console.warn(`   ⚠ ${item.id}: entry or branch snapshot missing — skipped.`);
      continue;
    }
    const entry = readJson(entryPath(item.id));
    const before = { status: entry.status, done: entry.statusInfo && entry.statusInfo.done };
    applyStatus(entry, library, readJson(branchFile), entry);
    const changed = before.status !== entry.status || before.done !== entry.statusInfo.done;

    if (changed) await publish(entry, `Status: ${entry.status}`);
    index = saveEntry(entry, index);
    console.log(`   ${entry.status === 'merged' ? '✅ merged' : '… in review'} ${entryHeadline(entry)} (${entry.statusInfo.done}/${entry.statusInfo.total} changes in the library)`);
  }
  return index;
}

// ── C) republish ─────────────────────────────────────────────────────────────
// Re-renders the Confluence page of every entry from its STORED data. Nothing is
// compared again, so merged entries keep their content (a new diff against today's
// library would show nothing).

async function republish(index) {
  console.log(`▶ republish ${index.length} Confluence page(s) from the stored entries`);
  for (const item of [...index]) {
    if (!existsSync(entryPath(item.id))) continue;
    const entry = readJson(entryPath(item.id));
    await publish(entry, 'Republished by IW Library Compare');
    index = saveEntry(entry, index);
  }
  return index;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(LIB_PATH)) {
    throw new Error(`${LIB_PATH} not found. Run the plugin in the library (main) file first and click “Save library snapshot”.`);
  }
  const explicit = args.file || env.SNAPSHOT_INPUT;
  const changed = explicit || RECHECK || REPUBLISH ? [] : changedFiles();
  const branchFiles = explicit
    ? [explicit]
    : changed.filter((f) => /^snapshots\/branches\/[^/]+\.json$/.test(f) && existsSync(f));
  const libraryChanged = RECHECK || changed.includes('snapshots/library.json');

  if (!branchFiles.length && !libraryChanged && !REPUBLISH) { console.log('Nothing to do.'); return; }

  const library = readJson(LIB_PATH);
  mkdirSync(join(DATA_DIR, 'entries'), { recursive: true });
  if (DRY) mkdirSync(OUT_DIR, { recursive: true });
  let index = existsSync(indexPath) ? readJson(indexPath) : [];

  const done = new Set();
  for (const f of branchFiles) {
    const r = await compare(f, library, index);
    index = r.index;
    done.add(r.id);
  }
  if (libraryChanged) index = await recheck(library, index, done);
  if (REPUBLISH) index = await republish(index);
}

main()
  .then(() => { if (failures) process.exitCode = 1; })
  .catch((e) => { console.error('❌', e.message); process.exit(1); });
