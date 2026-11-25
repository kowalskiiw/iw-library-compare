// Confluence page for one comparison entry (storage format) + REST v2 client.
// Wording comes from site/assets/describe.js, shared with the detail page.

import {
  nodeLink, describeComponent, describeStyle, describeVariable,
  groupByPage, headlineText, guidance, limitList, SCOPE_TEXT,
} from '../../site/assets/describe.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = (s) => `<code>${esc(s)}</code>`;
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
const tokens = (ts) => ts.map((t) => (t.t === 'code' ? code(t.v) : esc(t.v))).join('');
const lines = (ls) => ls.map(tokens).join('<br/>');
const h = (n, text) => `<h${n}>${esc(text)}</h${n}>`;
const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const table = (head, rows) =>
  `<table><tbody><tr>${head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
  '</tbody></table>';
const macro = (name, inner = '', params = {}) =>
  `<ac:structured-macro ac:name="${name}" ac:schema-version="1">` +
  Object.entries(params).map(([k, v]) => `<ac:parameter ac:name="${k}">${esc(v)}</ac:parameter>`).join('') +
  (inner ? `<ac:rich-text-body>${inner}</ac:rich-text-body>` : '') +
  '</ac:structured-macro>';

function componentLinks(entry, comps) {
  const { shown, more } = limitList(comps, 8);
  const html = shown.map((c) => link(nodeLink(entry.branch.url, c.id), c.name)).join(', ');
  return more ? `${html}, +${more} more (see “Changes per component”)` : html;
}

export function buildStorage(entry, { siteUrl } = {}) {
  const url = entry.branch.url;
  const out = [];

  // Summary panel
  const meta = [];
  meta.push(`Compared on ${esc((entry.updatedAt || '').slice(0, 10))}`);
  meta.push(`library snapshot ${esc((entry.library.snapshotAt || '').slice(0, 10))}`);
  meta.push(`branch snapshot ${esc((entry.branch.snapshotAt || '').slice(0, 10))}`);
  meta.push(link(url, 'Figma branch'));
  if (entry.ticket) meta.push(entry.ticket.url ? link(entry.ticket.url, entry.ticket.key) : esc(entry.ticket.key));
  if (siteUrl) meta.push(link(`${siteUrl.replace(/\/$/, '')}/detail.html?id=${encodeURIComponent(entry.id)}`, 'Changelog entry'));
  out.push(macro('info', headlineText(entry).map((t) => `<p>${esc(t)}</p>`).join('') + `<p>${meta.join(' · ')} · Component names on this page link to the Figma branch.</p>`));
  out.push(macro('toc', '', { maxLevel: '2' }));

  // Guidance
  const g = guidance(entry);
  out.push(h(2, 'What this means for you'));
  out.push(h(3, 'Developers') + ul(g.dev.map(esc)));
  out.push(h(3, 'QA testers') + ul(g.qa.map(esc)));

  // Property + value renames (cheat sheets)
  const r = entry.renames;
  if (r.properties.length) {
    out.push(h(2, 'Variant property renames'));
    out.push(table(['Old property', 'New property', 'Where'],
      r.properties.map((p) => [code(p.from), code(p.to), componentLinks(entry, p.components)])));
  }
  if (r.values.length) {
    out.push(h(2, 'Variant value renames'));
    out.push(table(['Property', 'Old value', 'New value', 'Where'],
      r.values.map((v) => [esc(v.property), code(v.from), code(v.to), componentLinks(entry, v.components)])));
  }

  // Styles
  const st = entry.styles;
  if (st.added.length || st.removed.length || st.changed.length) {
    out.push(h(2, 'Styles'));
    const rows = [
      ...st.changed.map((s) => [esc(s.type), esc(s.name), lines(describeStyle(s, 'changed'))]),
      ...st.added.map((s) => [esc(s.type), esc(s.name), lines(describeStyle(s, 'added'))]),
      ...st.removed.map((s) => [esc(s.type), esc(s.name), lines(describeStyle(s, 'removed'))]),
    ];
    out.push(table(['Type', 'Style', 'Change'], rows));
  }

  // Variables
  const va = entry.variables;
  if (va.added.length || va.removed.length || va.changed.length) {
    out.push(h(2, 'Variables'));
    const rows = [
      ...va.changed.map((v) => [esc(v.collection), esc(v.name), lines(describeVariable(v, 'changed'))]),
      ...va.added.map((v) => [esc(v.collection), esc(v.name), lines(describeVariable(v, 'added'))]),
      ...va.removed.map((v) => [esc(v.collection), esc(v.name), lines(describeVariable(v, 'removed'))]),
    ];
    out.push(table(['Collection', 'Variable', 'Change'], rows));
  }

  // Pages
  const pg = entry.pages;
  if (pg.added.length || pg.removed.length || pg.renamed.length) {
    out.push(h(2, 'Pages'));
    out.push(ul([
      ...pg.renamed.map((p) => `Renamed: ${code(p.oldName)} → ${code(p.name)}`),
      ...pg.added.map((p) => `Added: ${code(p.name)}`),
      ...pg.removed.map((p) => `Removed: ${code(p.name)}`),
    ]));
  }

  // Components
  const comps = entry.components;
  if (comps.added.length) {
    out.push(h(2, 'Components added'));
    out.push(table(['Component', 'Page'], comps.added.map((c) => [link(nodeLink(url, c.id), c.name), esc(c.page)])));
  }
  if (comps.removed.length) {
    out.push(h(2, 'Components removed'));
    out.push(table(['Component', 'Page'], comps.removed.map((c) => [esc(c.name), esc(c.page)])));
  }
  if (comps.changed.length) {
    out.push(h(2, 'Changes per component'));
    out.push(`<p>Names are the new names from the branch. Click a name to open the component in Figma. “Was” shows the old name when the component was renamed.</p>`);
    for (const grp of groupByPage(comps.changed)) {
      out.push(h(3, `${grp.page} (${grp.items.length})`));
      out.push(table(['Component', 'Was', 'Changes'], grp.items.map((c) => {
        const d = describeComponent(c);
        return [link(nodeLink(url, c.id), c.name), d.was ? code(d.was) : '—', lines(d.lines)];
      })));
    }
  }

  out.push(h(2, 'Scope of this comparison'));
  out.push(`<p>${esc(SCOPE_TEXT)}</p>`);
  return out.join('\n');
}

// ── REST v2 client ────────────────────────────────────────────────────────────

function client({ domain, email, token }) {
  const base = `https://${domain}/wiki/api/v2`;
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  return async function req(method, path, body) {
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Confluence ${method} ${path} failed: ${res.status} ${text.slice(0, 400)}`);
      err.status = res.status;
      err.text = text;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  };
}

// Updates the existing page (if pageId is known and still exists), otherwise creates one.
export async function upsertPage({ domain, email, token, spaceId, parentId, title, body, pageId, message }) {
  const req = client({ domain, email, token });
  const toResult = (r) => ({ id: String(r.id), url: `https://${domain}/wiki${(r._links && r._links.webui) || ''}` });

  if (pageId) {
    try {
      const cur = await req('GET', `/pages/${pageId}`);
      const r = await req('PUT', `/pages/${pageId}`, {
        id: String(pageId), status: 'current', title,
        body: { representation: 'storage', value: body },
        version: { number: cur.version.number + 1, message },
      });
      return toResult(r);
    } catch (e) {
      if (e.status !== 404) throw e; // page was deleted → fall through and create a new one
    }
  }

  const payload = {
    spaceId: String(spaceId), status: 'current', title,
    ...(parentId ? { parentId: String(parentId) } : {}),
    body: { representation: 'storage', value: body },
  };
  try {
    return toResult(await req('POST', '/pages', payload));
  } catch (e) {
    // Titles must be unique per space — retry once with a timestamp.
    if (e.status === 400 && /title/i.test(e.text || '')) {
      payload.title = `${title} (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
      return toResult(await req('POST', '/pages', payload));
    }
    throw e;
  }
}

export async function fetchIssue({ domain, email, token, key }) {
  const res = await fetch(`https://${domain}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,issuetype`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'), Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return { summary: j.fields && j.fields.summary, type: j.fields && j.fields.issuetype && j.fields.issuetype.name };
}
