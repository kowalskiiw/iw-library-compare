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
  if (t.t === 'count') {
    const tip = t.names && t.names.length ? t.names.join('\n') + (t.more ? `\n+${t.more} more` : '') : '';
    return tip ? `<span class="vcount" title="${esc(tip)}">${esc(t.v)}</span>` : esc(t.v);
  }
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

// ── component filter ────────────────────────────────────────────────────────
// Everything below works on the already rendered DOM (no re-render), so it can be used by the
// modal and by the standalone page. It only touches the "Changes per component" list.

const plural = (n) => `${n} component${n === 1 ? '' : 's'}`;

function clearHighlights(root) {
  root.querySelectorAll('mark.hl').forEach((m) => {
    const p = m.parentNode;
    p.replaceChild(root.ownerDocument.createTextNode(m.textContent), m);
    p.normalize();
  });
}

// Wraps every occurrence of `needle` (lowercase) in the row's text nodes in <mark class="hl">.
// Text is only ever inserted as text nodes / textContent, never as HTML.
function highlightRow(row, needle) {
  const doc = row.ownerDocument;
  const walker = doc.createTreeWalker(row, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const node of nodes) {
    const text = node.nodeValue;
    const low = text.toLowerCase();
    let i = low.indexOf(needle);
    if (i === -1) continue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    while (i !== -1) {
      frag.appendChild(doc.createTextNode(text.slice(last, i)));
      const m = doc.createElement('mark');
      m.className = 'hl';
      m.textContent = text.slice(i, i + needle.length);
      frag.appendChild(m);
      last = i + needle.length;
      i = low.indexOf(needle, last);
    }
    frag.appendChild(doc.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

function applyFilter(root) {
  const input = root.querySelector('#comp-filter');
  if (!input) return;
  const q = input.value.trim();
  const needle = q.toLowerCase();
  const filtering = needle.length > 0;
  const groups = [...root.querySelectorAll('details.group')];

  // Remember which groups were open when the filtering starts; restore them when it ends.
  if (filtering && !root.dataset.filterActive) {
    groups.forEach((g) => { g.dataset.wasOpen = g.open ? '1' : '0'; });
    root.dataset.filterActive = '1';
  }
  clearHighlights(root);

  let shown = 0;
  let total = 0;
  for (const g of groups) {
    const rows = [...g.querySelectorAll('tbody tr')];
    let hits = 0;
    for (const r of rows) {
      total++;
      const hit = !filtering || r.textContent.toLowerCase().includes(needle);
      r.hidden = !hit;
      if (hit) { hits++; shown++; if (filtering) highlightRow(r, needle); }
    }
    g.hidden = filtering && hits === 0;
    if (filtering && hits > 0) g.open = true;
    const cnt = g.querySelector('summary .count');
    if (cnt) cnt.textContent = filtering ? `(${hits} of ${rows.length})` : `(${rows.length})`;
  }
  if (!filtering && root.dataset.filterActive) {
    groups.forEach((g) => { g.open = g.dataset.wasOpen === '1'; });
    delete root.dataset.filterActive;
  }

  const count = root.querySelector('[data-filter-count]');
  if (count) count.innerHTML = filtering ? `<strong>${shown}</strong> of ${plural(total)}` : plural(total);
  const clear = root.querySelector('.filter-clear');
  const kbd = root.querySelector('.kbd');
  if (clear) clear.hidden = !filtering;
  if (kbd) kbd.hidden = filtering;

  const empty = root.querySelector('[data-filter-empty]');
  if (empty) {
    empty.hidden = !(filtering && shown === 0);
    const qq = empty.querySelector('[data-q]');
    if (qq) qq.textContent = q;
  }
  const note = root.querySelector('[data-filter-note]');
  if (note) {
    note.hidden = !(filtering && shown > 0 && shown < total);
    const n = note.querySelector('[data-n]');
    if (n) n.textContent = String(total - shown);
    const w = note.querySelector('[data-w]');
    if (w) w.textContent = total - shown === 1 ? 'component is' : 'components are';
  }
}

function clearFilter(root, refocus) {
  const input = root.querySelector('#comp-filter');
  if (!input) return;
  input.value = '';
  applyFilter(root);
  if (refocus) input.focus();
}

// Makes the buttons and the filter of a rendered detail work.
// Call once with the element that holds the rendered detail (it survives re-renders).
export function bindDetailInteractions(root) {
  root.addEventListener('click', (ev) => {
    const toggle = ev.target.closest('[data-toggle-all]');
    if (toggle) {
      const open = toggle.dataset.toggleAll === 'open';
      root.querySelectorAll('details.group:not([hidden])').forEach((d) => { d.open = open; });
      return;
    }
    if (ev.target.closest('[data-clear-filter]')) clearFilter(root, true);
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.id === 'comp-filter') applyFilter(root);
  });
  // Esc first empties the filter; only a second Esc reaches the modal (which closes it).
  root.addEventListener('keydown', (ev) => {
    if (ev.target.id === 'comp-filter' && ev.key === 'Escape' && ev.target.value) {
      ev.preventDefault();
      ev.stopPropagation();
      clearFilter(root, false);
    }
  });
  // "/" jumps into the filter, unless the user is typing somewhere already.
  root.ownerDocument.addEventListener('keydown', (ev) => {
    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const input = root.querySelector('#comp-filter');
    const active = root.ownerDocument.activeElement;
    if (!input || active === input) return;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
    ev.preventDefault();
    input.focus();
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
    h.push('<h2>Changes per component</h2>');
    h.push(`<p class="note">Names are the new names from the branch. ${esc(linkNote(e))} “Was” shows the old name when the component was renamed.</p>`);
    // Filter + counter + expand/collapse in one bar that stays visible while the list scrolls.
    const totalRows = c.changed.length;
    h.push(
      '<div class="filter-bar">' +
        '<div class="filter-field">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
          '<label class="sr-only" for="comp-filter">Filter components</label>' +
          '<input id="comp-filter" type="text" autocomplete="off" spellcheck="false" placeholder="Filter components, properties or values…">' +
          '<span class="kbd" aria-hidden="true">/</span>' +
          '<button type="button" class="filter-clear" data-clear-filter aria-label="Clear filter" hidden>×</button>' +
        '</div>' +
        '<div class="filter-meta">' +
          `<span class="filter-count" data-filter-count aria-live="polite">${totalRows} component${totalRows === 1 ? '' : 's'}</span>` +
          (groups.length > 1 ? '<button type="button" data-toggle-all="open">Expand all</button><button type="button" data-toggle-all="close">Collapse all</button>' : '') +
        '</div>' +
      '</div>');
    for (const grp of groups) {
      const rows = table(['Component', 'Was', 'Changes'], grp.items.map((x) => {
        const d = describeComponent(x);
        return [ext(libLink(e, x.id), x.name, 'comp'), d.was ? code(d.was) : '—', lines(d.lines)];
      }), [42, 20, 38]);
      h.push(`<details class="group"${openAll ? ' open' : ''}><summary><span class="g-name">${esc(grp.page)}</span> <span class="count">(${grp.items.length})</span></summary>${rows}</details>`);
    }
    h.push('<div class="filter-empty" data-filter-empty hidden><p class="t">No components match “<span data-q></span>”.</p>' +
      '<p class="s">The filter looks at component names, old names, property names and values.</p>' +
      '<button type="button" data-clear-filter>Clear filter</button></div>');
    h.push('<p class="filter-note" data-filter-note hidden><span data-n></span> <span data-w></span> hidden by the filter. <button type="button" class="linklike" data-clear-filter>Clear filter</button></p>');
  }

  h.push(`<div class="scope"><strong>Scope of this comparison.</strong> ${esc(SCOPE_TEXT)}</div>`);
  return h.join('\n');
}
