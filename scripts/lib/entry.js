// Turns a diff into the JSON entry that feeds BOTH the changelog detail page
// and the Confluence page.

const SEP = '\u0000';

export function aggregateRenames(changed) {
  const props = new Map();
  const vals = new Map();
  for (const c of changed) {
    const ref = { id: c.id, name: c.name };
    c.propRenames.forEach((r) => {
      const k = r.from + SEP + r.to;
      if (!props.has(k)) props.set(k, { from: r.from, to: r.to, components: [] });
      props.get(k).components.push(ref);
    });
    c.valueRenames.forEach((v) => {
      const k = v.property + SEP + v.from + SEP + v.to;
      if (!vals.has(k)) vals.set(k, { property: v.property, from: v.from, to: v.to, components: [] });
      vals.get(k).components.push(ref);
    });
  }
  const byCount = (a, b) => b.components.length - a.components.length || a.from.localeCompare(b.from);
  return { properties: [...props.values()].sort(byCount), values: [...vals.values()].sort(byCount) };
}

export function buildEntry({ diff, library, branch, existing, ticket }) {
  const m = branch.meta || {};
  const id = m.branchKey || String(m.fileName || 'branch').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = new Date().toISOString();
  return {
    id,
    title: (m.title && m.title.trim()) || m.fileName || id,
    createdAt: (existing && existing.createdAt) || now,
    updatedAt: now,
    branch: { url: m.branchUrl, key: m.branchKey, fileName: m.fileName, snapshotAt: m.takenAt },
    library: { fileName: (library.meta || {}).fileName, snapshotAt: (library.meta || {}).takenAt },
    ticket: ticket || null,
    confluence: (existing && existing.confluence) || null,
    summary: diff.summary,
    pages: diff.pages,
    styles: diff.styles,
    variables: diff.variables,
    components: diff.components,
    renames: aggregateRenames(diff.components.changed),
  };
}

export function indexItem(e) {
  const s = e.summary;
  return {
    id: e.id,
    title: e.title,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    ticket: e.ticket,
    branchUrl: e.branch.url,
    confluenceUrl: e.confluence ? e.confluence.url : null,
    summary: {
      namingOnly: s.namingOnly,
      affected: s.components.affected + s.components.added + s.components.removed,
      renamed: s.components.renamed,
      propertyChanges: s.components.propertyChanges,
      visualChanges: s.components.visualChanges,
      styles: s.styles.added + s.styles.removed + s.styles.changed,
      variables: s.variables.added + s.variables.removed + s.variables.changed,
    },
  };
}
