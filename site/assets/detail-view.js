// Renders the content of one comparison entry as HTML. Used by the standalone
// detail page (detail.html) and by the modal on the overview page, so both show
// exactly the same thing. Every string from the data is escaped.

import {
  libLink, addedLink, removedLink, libraryUrl, describeComponent, describeStyle, describeVariable, changeBadge,
  groupByPage, headlineText, guidance, limitList, SCOPE_TEXT, linkNote, statusLines, statusLabel, isMerged,
} from './describe.js';

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Entries with at most this many changed components show every group open;
// bigger ones start collapsed (use "Expand all", or open single groups).
const OPEN_ALL_UP_TO = 20;

const code = (s) => `<code>${esc(s)}</code>`;

// A small color square in front of every hex color in a value ("#2194FF", "#000000 (25%)").
const HEX_RE = /#([0-9A-Fa-f]{6})(?:\s*\((\d+)%\))?/g;
function swatches(text) {
  const out = [];
  for (const m of String(text).matchAll(HEX_RE)) {
    if (out.length >= 3) break;
    const n = parseInt(m[1], 16);
    const a = m[2] === undefined ? 1 : Math.min(100, Number(m[2])) / 100;
    out.push(`<span class="swatch" aria-hidden="true" style="background:rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})"></span>`);
  }
  return out.join('');
}
const badge = (b) => `<span class="badge badge-${b.tone}">${esc(b.label)}</span>`;

const tokens = (ts) => ts.map((t) => {
  if (t.t === 'code') return swatches(t.v) + code(t.v);
  if (t.t === 'meter') {
    const pct = Math.max(3, Math.round((t.changed / t.total) * 100));
    return `<span class="meter-row" role="img" aria-label="${esc(t.v)}" title="${esc(t.v)}">` +
      `<span class="meter-label">Appearance</span><span class="meter"><span style="width:${pct}%"></span></span>` +
      `<span class="meter-num">${t.changed} / ${t.total}</span></span>`;
  }
  return esc(t.v);
}).join('');
const lines = (ls) => ls.map(tokens).join('<br>');
// `widths` (percent per column) gives every table of the same kind the same column grid.
const table = (head, rows, widths) =>
  `<div class="table-wrap"><table>${widths ? `<colgroup>${widths.map((w) => `<col style="width:${w}%">`).join('')}</colgroup>` : ''}<thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
const date = (s) => esc(String(s || '').slice(0, 10));
const ext = (href, text, cls = '') =>
  `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

function compLinks(e, comps) {
  const { shown, more } = limitList(comps, 8);
  const html = shown.map((c) => ext(libLink(e, c.id), c.name, 'comp')).join(', ');
  return more ? `${html}, +${more} more (see “Changes per component”)` : html;
}

// Makes "Expand all / Collapse all" work. Call once with the element that holds the rendered detail.
export function bindDetailInteractions(root) {
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-toggle-all]');
    if (!b) return;
    const open = b.dataset.toggleAll === 'open';
    root.querySelectorAll('details.group').forEach((d) => { d.open = open; });
  });
}

// Links shown next to the headline (page header / modal header)..
export function headerLinks(e) {
  const out = [];
  if (e.confluence) out.push(ext(e.confluence.url, 'Confluence'));
  out.push(ext(libraryUrl(e.branch.url), 'Figma library'));
  out.push(ext(e.branch.url, 'Figma branch'));
  return out.join('');
}

// Everything below the headline.
export function renderDetailBody(e) {
  const url = e.branch.url;
  const h = [];

  const meta = [
    `Compared on ${date(e.updatedAt)}`,
    `library snapshot ${date(e.library.snapshotAt)}`,
    `branch snapshot ${date(e.branch.snapshotAt)}`,
    ext(libraryUrl(url), 'Figma library'),
    ext(url, 'Figma branch'),
    e.ticket ? `${ext(e.ticket.url || '#', e.ticket.key)}${e.ticket.summary ? ' — ' + esc(e.ticket.summary) : ''}` : '',
    e.confluence ? ext(e.confluence.url, 'Confluence page') : '',
  ].filter(Boolean).join('<span>·</span>');
  const sl = statusLines(e);
  const statusHtml = `<p><span class="chip ${isMerged(e) ? 'ok' : 'warn'}">${esc(statusLabel(e))}</span>${esc(sl[0])}</p>` +
    sl.slice(1).map((t) => `<p>${esc(t)}</p>`).join('');
  h.push(`<div class="panel">${statusHtml}${headlineText(e).map((t) => `<p>${esc(t)}</p>`).join('')}<div class="meta">${meta}</div></div>`);

  const g = guidance(e);
  h.push('<h2>What this means for you</h2>');
  h.push(`<div class="cols"><div><h3>Developers</h3><ul class="plain">${g.dev.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` +
         `<div><h3>QA testers</h3><ul class="plain">${g.qa.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`);

  if (e.renames.properties.length) {
    h.push('<h2>Variant property renames</h2>');
    h.push(table(['Old property', 'New property', 'Where'],
      e.renames.properties.map((p) => [code(p.from), code(p.to), compLinks(e, p.components)]), [24, 24, 52]));
  }
  if (e.renames.values.length) {
    h.push('<h2>Variant value renames</h2>');
    h.push(table(['Property', 'Old value', 'New value', 'Where'],
      e.renames.values.map((v) => [esc(v.property), code(v.from), code(v.to), compLinks(e, v.components)]), [14, 18, 18, 50]));
  }

  const st = e.styles;
  if (st.added.length || st.removed.length || st.changed.length) {
    h.push('<h2>Styles</h2>');
    const styleRow = (s, kind) => [badge(changeBadge(s, kind)), esc(s.type), esc(s.name), lines(describeStyle(s, kind))];
    h.push(table(['Change', 'Type', 'Style', 'Details'], [
      ...st.changed.map((s) => styleRow(s, 'changed')),
      ...st.added.map((s) => styleRow(s, 'added')),
      ...st.removed.map((s) => styleRow(s, 'removed')),
    ], [14, 9, 33, 44]));
  }

  const va = e.variables;
  if (va.added.length || va.removed.length || va.changed.length) {
    h.push('<h2>Variables</h2>');
    const varRow = (v, kind) => [badge(changeBadge(v, kind)), esc(v.collection), esc(v.name), lines(describeVariable(v, kind))];
    h.push(table(['Change', 'Collection', 'Variable', 'Details'], [
      ...va.changed.map((v) => varRow(v, 'changed')),
      ...va.added.map((v) => varRow(v, 'added')),
      ...va.removed.map((v) => varRow(v, 'removed')),
    ], [14, 18, 28, 40]));
  }

  const pg = e.pages;
  if (pg.added.length || pg.removed.length || pg.renamed.length) {
    h.push('<h2>Pages</h2><ul class="plain">' + [
      ...pg.renamed.map((p) => `Renamed: ${code(p.oldName)} → ${code(p.name)}`),
      ...pg.added.map((p) => `Added: ${code(p.name)}`),
      ...pg.removed.map((p) => `Removed: ${code(p.name)}`),
    ].map((x) => `<li>${x}</li>`).join('') + '</ul>');
  }

  const c = e.components;
  if (c.added.length) {
    h.push('<h2>Components added</h2>');
    h.push(table(['Component', 'Page'], c.added.map((x) => [ext(addedLink(e, x.id), x.name, 'comp'), esc(x.page)]), [60, 40]));
  }
  if (c.removed.length) {
    h.push('<h2>Components removed</h2>');
    h.push(table(['Component', 'Page'], c.removed.map((x) => {
      const href = removedLink(e, x.id);
      return [href ? ext(href, x.name, 'comp') : esc(x.name), esc(x.page)];
    }), [60, 40]));
  }
  if (c.changed.length) {
    const groups = groupByPage(c.changed);
    const openAll = c.changed.length <= OPEN_ALL_UP_TO;
    h.push('<div class="section-head"><h2>Changes per component</h2>' + (groups.length > 1
      ? '<div class="group-controls"><button type="button" data-toggle-all="open">Expand all</button><button type="button" data-toggle-all="close">Collapse all</button></div>'
      : '') + '</div>');
    h.push(`<p class="note">Names are the new names from the branch. ${esc(linkNote(e))} “Was” shows the old name when the component was renamed.</p>`);
    for (const grp of groups) {
      const rows = table(['Component', 'Was', 'Changes'], grp.items.map((x) => {
        const d = describeComponent(x);
        return [ext(libLink(e, x.id), x.name, 'comp'), d.was ? code(d.was) : '—', lines(d.lines)];
      }), [42, 20, 38]);
      h.push(`<details class="group"${openAll ? ' open' : ''}><summary><span class="g-name">${esc(grp.page)}</span> <span class="count">(${grp.items.length})</span></summary>${rows}</details>`);
    }
  }

  h.push(`<div class="scope"><strong>Scope of this comparison.</strong> ${esc(SCOPE_TEXT)}</div>`);
  return h.join('\n');
}
