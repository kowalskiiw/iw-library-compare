// Shared by the Node scripts (Confluence page) and the browser (detail page),
// so both always say exactly the same thing. No DOM / Node APIs in here.
// Descriptions are returned as "token" lines: [{t:'text'|'code', v}] so each
// renderer can format them its own way (HTML or Confluence storage format).

const T = (v) => ({ t: 'text', v: String(v) });
const C = (v) => ({ t: 'code', v: String(v) });
const ARROW = ' → ';

export function nodeLink(branchUrl, nodeId) {
  try {
    const u = new URL(branchUrl);
    u.search = '';
    u.hash = '';
    u.searchParams.set('node-id', String(nodeId).replace(':', '-'));
    return u.toString();
  } catch {
    return branchUrl;
  }
}

// The library URL is the branch URL without its "/branch/<branch key>" part.
// Node IDs are identical in library and branch, so the same node-id works in both.
export function libraryUrl(branchUrl) {
  try {
    const u = new URL(branchUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    const b = parts.indexOf('branch');
    if (b === -1) return branchUrl;
    parts.splice(b, 2);
    u.pathname = '/' + parts.join('/');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return branchUrl;
  }
}

// Component links go to the library, because that is where developers and testers
// look (and the branch is deleted after the merge). Components that were added
// exist only in the branch until the merge, so those link there.
export const libLink = (entry, nodeId) => nodeLink(libraryUrl(entry.branch.url), nodeId);
export const branchLink = (entry, nodeId) => nodeLink(entry.branch.url, nodeId);

// The title as shown to readers: a leading Jira key ("CXI-2133-Priority-Fix-4" → "Priority-Fix-4")
// is dropped, because the ticket is shown as its own link. Only the display changes; the stored
// title stays as it was.
export function displayTitle(e) {
  return String(e.title || '').replace(/^[A-Z][A-Z0-9]+-\d+[\s_:–—-]*/, '').trim();
}

// Same headline on the changelog site and on the Confluence page.
export function entryHeadline(e) {
  const t = displayTitle(e);
  if (e.version) return t ? `${e.version} – ${t}` : e.version;
  return t || String(e.title || '');
}

// ── merge status ─────────────────────────────────────────────────────────────
// 'in-review': the branch is not (completely) in the library yet.
// 'merged'   : everything the entry touched is in the library now.

export const isMerged = (e) => e.status === 'merged';
export const statusLabel = (e) => (isMerged(e) ? 'Merged' : 'In review');

// Added components exist only in the branch until the merge; afterwards they are in the library.
export const addedLink = (e, nodeId) => (isMerged(e) ? libLink(e, nodeId) : branchLink(e, nodeId));
// Removed components exist in the library until the merge; afterwards there is nothing to open.
export const removedLink = (e, nodeId) => (isMerged(e) ? null : libLink(e, nodeId));

const day = (s) => String(s || '').slice(0, 10);

export function statusLines(e) {
  const si = e.statusInfo || {};
  if (isMerged(e)) {
    return [si.mergedAt
      ? `All changes are now in the library (merged ${day(si.mergedAt)}).`
      : 'The library already matches the branch.'];
  }
  const out = [`The branch has not been merged into the library yet, so the library still shows the old state (checked ${day(si.checkedAt || e.updatedAt)}).`];
  if (si.done) {
    const names = (si.pending || []).slice(0, 8).map((p) => p.name).join(', ');
    const more = (si.pendingCount || 0) > 8 ? `, +${si.pendingCount - 8} more` : '';
    out.push(`${si.done} of ${si.total} changes are already in the library. Still missing: ${names}${more}.`);
  }
  return out;
}

export const linkNote = (e) =>
  isMerged(e)
    ? 'Links open the Figma library, which now contains all changes. Removed components no longer exist there, so they are not linked.'
    : 'Links open the Figma library. Until the branch is merged, the library still shows the old names. Added components exist only in the branch, so they link there.';

function join(items, sep = ', ') {
  const out = [];
  items.forEach((it, i) => {
    if (i) out.push(T(sep));
    out.push(...it);
  });
  return out;
}

function groupBy(list, keyFn) {
  const m = new Map();
  list.forEach((x) => {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  });
  return m;
}

// → { was: oldName|null, lines: Token[][] }
export function describeComponent(c) {
  const lines = [];
  c.propRenames.forEach((r) => lines.push([T('Property '), C(r.from), T(ARROW), C(r.to)]));
  for (const [prop, list] of groupBy(c.valueRenames, (v) => v.property)) {
    lines.push([T(`${prop}: `), ...join(list.map((v) => [C(v.from), T(ARROW), C(v.to)]))]);
  }
  c.propsAdded.forEach((p) => lines.push([T('Property added: '), C(p)]));
  c.propsRemoved.forEach((p) => lines.push([T('Property removed: '), C(p)]));
  for (const [prop, list] of groupBy(c.valuesAdded, (v) => v.property)) {
    lines.push([T(`${prop}: value added `), ...join(list.map((v) => [C(v.value)]))]);
  }
  for (const [prop, list] of groupBy(c.valuesRemoved, (v) => v.property)) {
    lines.push([T(`${prop}: value removed `), ...join(list.map((v) => [C(v.value)]))]);
  }
  c.defaultsChanged.forEach((d) => lines.push([T('Default of '), C(d.property), T(': '), C(d.from), T(ARROW), C(d.to)]));
  if (c.variantsAdded) lines.push([T(`${c.variantsAdded} variant(s) added`)]);
  if (c.variantsRemoved) lines.push([T(`${c.variantsRemoved} variant(s) removed`)]);
  if (c.description) lines.push([T('Description changed')]);
  if (c.moved) lines.push([T('Moved from page '), C(c.moved.from), T(' to '), C(c.moved.to)]);
  if (c.visual) {
    lines.push([
      T(c.visual.total > 1
        ? `Appearance changed in ${c.visual.changed} of ${c.visual.total} variant(s)`
        : 'Appearance changed'),
    ]);
  }
  if (!lines.length) lines.push([T(c.oldName ? 'Name only' : '—')]);
  return { was: c.oldName, lines };
}

export function describeStyle(s, kind) {
  if (kind === 'added') return [[T('Added: '), C(s.value)]];
  if (kind === 'removed') return [[T('Removed (was '), C(s.value), T(')')]];
  const lines = [];
  if (s.oldName) lines.push([T('Renamed from '), C(s.oldName)]);
  if (s.value) lines.push([T('Value '), C(s.value.from), T(ARROW), C(s.value.to)]);
  if (s.description) lines.push([T('Description changed')]);
  return lines;
}

export function describeVariable(v, kind) {
  const entries = (obj) => Object.entries(obj || {});
  if (kind === 'added') {
    return [[T('Added: '), ...join(entries(v.values).map(([m, val]) => (entries(v.values).length > 1 ? [T(`${m} `), C(val)] : [C(val)])))]];
  }
  if (kind === 'removed') {
    return [[T('Removed (was '), ...join(entries(v.values).map(([, val]) => [C(val)])), T(')')]];
  }
  const lines = [];
  if (v.oldName) lines.push([T('Renamed from '), C(v.oldName)]);
  if (v.oldCollection) lines.push([T('Moved from collection '), C(v.oldCollection)]);
  (v.values || []).forEach((x) => {
    lines.push([T(v.values.length > 1 ? `${x.mode}: ` : 'Value '), C(x.from), T(ARROW), C(x.to)]);
  });
  if (v.description) lines.push([T('Description changed')]);
  return lines;
}

export function groupByPage(list) {
  const m = groupBy(list, (c) => c.page || '—');
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([page, items]) => ({ page, items: items.slice().sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function headlineText(e) {
  const s = e.summary;
  const c = s.components;
  const out = [];
  const nothing =
    !c.affected && !c.added && !c.removed &&
    !s.styles.added && !s.styles.removed && !s.styles.changed &&
    !s.variables.added && !s.variables.removed && !s.variables.changed &&
    !s.pages.added && !s.pages.removed && !s.pages.renamed;
  if (nothing) {
    out.push('No differences found between the library snapshot and the branch.');
    return out;
  }
  out.push(
    s.namingOnly
      ? 'Naming-only change. Nothing visual changed, and no styles, variables or documentation changed.'
      : 'This branch changes more than names — see the sections below for details.'
  );
  const parts = [];
  if (c.renamed) parts.push(`${c.renamed} renamed`);
  if (c.propertyChanges) parts.push(`${c.propertyChanges} with property or value changes`);
  if (c.visualChanges) parts.push(`${c.visualChanges} with appearance changes`);
  if (c.descriptionChanges) parts.push(`${c.descriptionChanges} with description changes`);
  if (c.added) parts.push(`${c.added} added`);
  if (c.removed) parts.push(`${c.removed} removed`);
  // Removed components only exist in the library, so the total is branch + removed.
  out.push(`${c.affected + c.added + c.removed} of ${c.branch + c.removed} components are affected${parts.length ? ': ' + parts.join(', ') : ''}.`);
  const other = [];
  const st = s.styles;
  if (st.added || st.removed || st.changed) other.push(`Styles: ${st.added} added, ${st.removed} removed, ${st.changed} changed`);
  const va = s.variables;
  if (va.added || va.removed || va.changed) other.push(`Variables: ${va.added} added, ${va.removed} removed, ${va.changed} changed`);
  const pg = s.pages;
  if (pg.added || pg.removed || pg.renamed) other.push(`Pages: ${pg.added} added, ${pg.removed} removed, ${pg.renamed} renamed`);
  if (other.length) out.push(other.join(' · '));
  return out;
}

export function guidance(e) {
  const s = e.summary;
  const c = s.components;
  const dev = [];
  const qa = [];
  if (s.namingOnly) {
    dev.push('The visuals are identical, so no CSS or token changes are expected.');
  } else {
    dev.push('Check the sections below for appearance, style and variable changes. Those can require code changes.');
  }
  if (c.renamed || c.propertyChanges) {
    dev.push('If your code, Storybook mappings or Dev Mode snippets reference Figma names of components, variant properties or variant values, update them with the tables below.');
  }
  if (s.namingOnly) {
    qa.push('No visual regression is expected. Spot-check the affected screens against the current build.');
  } else {
    qa.push('Test the components marked with appearance changes, and everything that uses changed styles or variables.');
  }
  qa.push('Use “Changes per component” as a checklist. Each component lists exactly what changed and links to Figma.');
  if (c.renamed || c.propertyChanges) {
    qa.push('Update test cases and test data that mention old names (for example a state that was renamed).');
  }
  return { dev, qa };
}

export function limitList(list, max = 8) {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

export const SCOPE_TEXT =
  'Compared automatically from two Figma snapshots (library vs. branch), matched by node ID: pages, styles, variables, component names, descriptions, variant properties and values, and a fingerprint of each component’s appearance (fills, strokes, radii, effects, spacing, text, bindings). Not compared: overrides inside nested instances and prototype interactions. The appearance fingerprint tells you that something changed, not which property.';
