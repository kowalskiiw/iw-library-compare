// Builds a small library + branch snapshot pair, runs the whole pipeline in
// dry-run mode and asserts the interesting cases. Run with: npm test
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import assert from 'assert';

const dir = 'tests/out';
rmSync(dir, { recursive: true, force: true });
mkdirSync(`${dir}/in`, { recursive: true });

const library = {
  schema: 1,
  meta: { kind: 'library', fileName: 'IW Design Library', takenAt: '2026-11-24T10:00:00.000Z' },
  pages: { '0:1': 'Buttons', '0:2': 'Inputs' },
  styles: {
    'S:1': { t: 'paint', n: 'Brand/500', d: '', v: '#2194FF' },
    'S:2': { t: 'text', n: 'Body/M', d: '', v: 'Inter Regular · 16px · lh 24px' },
  },
  variables: {
    'V:1': { c: 'Color Styles', n: 'Footer Greece/800', t: 'COLOR', d: '', v: { 'Mode 1': '#1A3362' } },
    'V:2': { c: 'Spacings', n: 'spacing-04', t: 'FLOAT', d: '', v: { 'Mode 1': '4' } },
  },
  components: {
    '1:1': {
      n: 'Primary Buttons', d: '', pg: 'Buttons', k: 'set',
      p: {
        Type: { t: 'VARIANT', dv: 'Text', o: ['Text', 'Icon'] },
        State: { t: 'VARIANT', dv: 'Default', o: ['Default', 'Mouseover', 'Focused'] },
        'Label#10:1': { t: 'TEXT', dv: 'Button' },
      },
      vs: [
        ['1:2', 'Type=Text, State=Default', 'v1'],
        ['1:3', 'Type=Text, State=Mouseover', 'v2'],
        ['1:4', 'Type=Icon, State=Focused', 'v3'],
      ],
    },
    '2:1': {
      n: 'Input Text', d: '', pg: 'Inputs', k: 'set',
      p: { State: { t: 'VARIANT', dv: 'Default', o: ['Default', 'Mouseover'] } },
      vs: [['2:2', 'State=Default', 'i1'], ['2:3', 'State=Mouseover', 'i2']],
    },
    '3:1': { n: '.AvatarSmall', d: '', pg: 'Buttons', k: 'component', p: {}, vs: [], vh: 'a1' },
    '3:2': { n: '.Divider', d: '', pg: 'Buttons', k: 'component', p: {}, vs: [], vh: 'd1' },
    '4:1': { n: 'Old Card', d: '', pg: 'Inputs', k: 'component', p: {}, vs: [], vh: 'o1' },
  },
};

const branch = JSON.parse(JSON.stringify(library));
branch.meta = {
  kind: 'branch', fileName: 'CXI-0000-Sample', takenAt: '2026-11-24T12:00:00.000Z',
  branchUrl: 'https://www.figma.com/design/LIBKEY/branch/BRKEY1/IW-Design-Library',
  branchKey: 'BRKEY1', ticket: 'cxi-1234', title: '',
};
branch.styles['S:1'].v = '#1575CF';                                   // value change
branch.styles['S:2'].n = 'Body/Medium';                               // rename
branch.styles['S:3'] = { t: 'paint', n: 'Brand/900', d: '', v: '#001A33' }; // added
branch.variables['V:2'].v['Mode 1'] = '8';                            // value change
branch.variables['V:3'] = { c: 'Spacings', n: 'spacing-08', t: 'FLOAT', d: '', v: { 'Mode 1': '8' } }; // added
branch.components['1:1'] = {
  n: 'Primary Button', d: '', pg: 'Buttons', k: 'set',
  p: {
    Content: { t: 'VARIANT', dv: 'Text', o: ['Text', 'Icon'] },
    State: { t: 'VARIANT', dv: 'Default', o: ['Default', 'Hover', 'Focus'] },
    'Label text#10:1': { t: 'TEXT', dv: 'Button' },
  },
  vs: [
    ['1:2', 'Content=Text, State=Default', 'v1'],
    ['1:3', 'Content=Text, State=Hover', 'CHANGED'],
    ['1:4', 'Content=Icon, State=Focus', 'v3'],
  ],
};
branch.components['2:1'] = {
  n: 'Input Text', d: '', pg: 'Inputs', k: 'set',
  p: { State: { t: 'VARIANT', dv: 'Default', o: ['Default', 'Hover'] } },
  vs: [['2:2', 'State=Default', 'i1'], ['2:3', 'State=Hover', 'i2']],
};
branch.components['3:1'].n = '.Avatar Base S';                        // name only
branch.components['3:2'].vh = 'd2';                                   // standalone visual change
delete branch.components['4:1'];                                      // removed
branch.components['5:1'] = { n: 'New Chip', d: '', pg: 'Inputs', k: 'component', p: {}, vs: [], vh: 'c1' }; // added

writeFileSync(`${dir}/in/library.json`, JSON.stringify(library));
writeFileSync(`${dir}/in/branch.json`, JSON.stringify(branch));

const run = () =>
  execFileSync('node', [
    'scripts/run-comparison.js', '--dry-run',
    '--library', `${dir}/in/library.json`, '--file', `${dir}/in/branch.json`,
    '--data-dir', `${dir}/data`, '--out', dir,
  ], { encoding: 'utf8' });

console.log(run());
const entry = JSON.parse(readFileSync(`${dir}/data/entries/BRKEY1.json`, 'utf8'));
const s = entry.summary;

assert.equal(s.components.renamed, 2, 'two renamed components');
assert.equal(s.components.propertyChanges, 2, 'two components with property/value changes');
assert.equal(s.components.visualChanges, 2, 'visual change in set variant + standalone');
assert.equal(s.components.added, 1);
assert.equal(s.components.removed, 1);
assert.equal(s.namingOnly, false);
assert.equal(s.styles.changed, 2);
assert.equal(s.styles.added, 1);
assert.equal(s.variables.changed, 1);
assert.equal(s.variables.added, 1);
assert.equal(entry.ticket.key, 'CXI-1234');

const prim = entry.components.changed.find((c) => c.id === '1:1');
assert.deepEqual(prim.propRenames.map((r) => `${r.from}>${r.to}`).sort(), ['Label>Label text', 'Type>Content']);
assert.deepEqual(prim.valueRenames.map((v) => `${v.property}:${v.from}>${v.to}`).sort(), ['State:Focused>Focus', 'State:Mouseover>Hover']);
assert.equal(prim.valuesAdded.length + prim.valuesRemoved.length, 0, 'renames must not show up as added/removed values');
assert.equal(prim.visual.changed, 1);
assert.equal(entry.renames.values.find((v) => v.from === 'Mouseover').components.length, 2, 'Mouseover→Hover aggregated over both sets');

// Re-running updates the same entry (no duplicate)
run();
const index = JSON.parse(readFileSync(`${dir}/data/entries.json`, 'utf8'));
assert.equal(index.length, 1, 'idempotent per branch key');
console.log('✅ all assertions passed');
