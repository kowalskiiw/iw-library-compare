// Renders the content of one comparison entry as HTML. Used by the standalone
// detail page (detail.html) and by the modal on the overview page, so both show
// exactly the same thing. Every string from the data is escaped.

import {
  libLink, addedLink, removedLink, libraryUrl, describeComponent, describeStyle, describeVariable,
  groupByPage, headlineText, guidance, limitList, SCOPE_TEXT, linkNote, statusLines, statusLabel, isMerged,
} from './describe.js';

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = (s) => `<code>${esc(s)}</code>`;
const tokens = (ts) => ts.map((t) => (t.t === 'code' ? code(t.v) : esc(t.v))).join('');
const lines = (ls) => ls.map(tokens).join('<br>');
const table = (head, rows) =>
  `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
const date = (s) => esc(String(s || '').slice(0, 10));
const ext = (href, text, cls = '') =>
  `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

function compLinks(e, comps) {
  const { shown, more } = limitList(comps, 8);
  const html = shown.map((c) => ext(libLink(e, c.id), c.name, 'comp')).join(', ');
  return more ? `${html}, +${more} more (see “Changes per component”)` : html;
}

// Links shown next to the headline (page header / modal header).
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
      e.renames.properties.map((p) => [code(p.from), code(p.to), compLinks(e, p.components)])));
  }
  if (e.renames.values.length) {
    h.push('<h2>Variant value renames</h2>');
    h.push(table(['Property', 'Old value', 'New value', 'Where'],
      e.renames.values.map((v) => [esc(v.property), code(v.from), code(v.to), compLinks(e, v.components)])));
  }

  const st = e.styles;
  if (st.added.length || st.removed.length || st.changed.length) {
    h.push('<h2>Styles</h2>');
    h.push(table(['Type', 'Style', 'Change'], [
      ...st.changed.map((s) => [esc(s.type), esc(s.name), lines(describeStyle(s, 'changed'))]),
      ...st.added.map((s) => [esc(s.type), esc(s.name), lines(describeStyle(s, 'added'))]),
      ...st.removed.map((s) => [esc(s.type), esc(s.name), lines(describeStyle(s, 'removed'))]),
    ]));
  }

  const va = e.variables;
  if (va.added.length || va.removed.length || va.changed.length) {
    h.push('<h2>Variables</h2>');
    h.push(table(['Collection', 'Variable', 'Change'], [
      ...va.changed.map((v) => [esc(v.collection), esc(v.name), lines(describeVariable(v, 'changed'))]),
      ...va.added.map((v) => [esc(v.collection), esc(v.name), lines(describeVariable(v, 'added'))]),
      ...va.removed.map((v) => [esc(v.collection), esc(v.name), lines(describeVariable(v, 'removed'))]),
    ]));
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
    h.push(table(['Component', 'Page'], c.added.map((x) => [ext(addedLink(e, x.id), x.name, 'comp'), esc(x.page)])));
  }
  if (c.removed.length) {
    h.push('<h2>Components removed</h2>');
    h.push(table(['Component', 'Page'], c.removed.map((x) => {
      const href = removedLink(e, x.id);
      return [href ? ext(href, x.name, 'comp') : esc(x.name), esc(x.page)];
    })));
  }
  if (c.changed.length) {
    h.push('<h2>Changes per component</h2>');
    h.push(`<p class="note">Names are the new names from the branch. ${esc(linkNote(e))} “Was” shows the old name when the component was renamed.</p>`);
    for (const grp of groupByPage(c.changed)) {
      h.push(`<h3>${esc(grp.page)} <span class="count">(${grp.items.length})</span></h3>`);
      h.push(table(['Component', 'Was', 'Changes'], grp.items.map((x) => {
        const d = describeComponent(x);
        return [ext(libLink(e, x.id), x.name, 'comp'), d.was ? code(d.was) : '—', lines(d.lines)];
      })));
    }
  }

  h.push(`<div class="scope"><strong>Scope of this comparison.</strong> ${esc(SCOPE_TEXT)}</div>`);
  return h.join('\n');
}
