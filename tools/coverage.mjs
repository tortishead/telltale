/* Which reader is proven against which Android release.
 *
 *     node tools/coverage.mjs
 *
 * A release does not change what a service says so much as how it spells it,
 * and the only proof a reader still reads a release is a fixture taken off it.
 * Grepping twenty-odd source files for the releases their comments name says
 * what was thought about, not what is tested. This says what is tested.
 *
 * The readers come from the page's own TOOLS list and the fixtures from
 * tools/fixtures.mjs, so a reader or a fixture added anywhere turns up here
 * with nothing to edit. A blank cell is not a bug — it is a dump nobody has
 * taken yet, and the row it is on says which one to go and take.
 *
 * It prints and exits; it is a maintenance tool like tools/flag-docs.py, not a
 * test, and it fails nothing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openPage } from './page-harness.mjs';
import { CASES, BUGREPORT, fixtureName } from './fixtures.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (n) => dir(`../tests/fixtures/${n}`);

/* What a bugreport proves, which is every reader in it at once. The zip states
   the build it came off, so opening it fills a whole column of the table that
   the single-dump fixtures fill a cell of. */
async function bugreportTools() {
  const bytes = readFileSync(fixture(BUGREPORT.file));
  const page = openPage();
  const file = new File([bytes], BUGREPORT.file, { type: 'application/zip' });
  const { text, label, from } = await page.readDump(file);
  await page.load(text, null, from || label, from ? label : null);
  return new Set(page.docs().map((d) => d.found[0].tool.id));
}

/* Every reader, in the order the page registers them, against the release each
   of its fixtures came off. A reader with no fixture at all is still a row:
   that is the emptiest row there is and the one worth seeing. */
function build(tools, fromBugreport) {
  const byParse = new Map(tools.map((t) => [t.parse, t]));
  const rows = new Map(tools.map((t) => [t.id, { tool: t, seen: new Map(), unstated: 0 }]));

  const mark = (id, release) => {
    const row = rows.get(id);
    if (!row) return;
    if (release === null) { row.unstated += 1; return; }
    row.seen.set(release, (row.seen.get(release) || 0) + 1);
  };

  for (const c of CASES) {
    const tool = byParse.get(c.parse);
    if (!tool) continue;          /* a parser the page does not register */
    mark(tool.id, c.release);
  }
  for (const id of fromBugreport) mark(id, BUGREPORT.release);

  return rows;
}

/* The releases any fixture states, low to high, which are the columns. */
function releases(rows) {
  const out = new Set();
  for (const row of rows.values()) for (const r of row.seen.keys()) out.add(r);
  return [...out].sort((a, b) => a - b);
}

function print(rows, cols) {
  const pad = (s, n) => String(s).padEnd(n);
  const idWidth = Math.max(6, ...[...rows.keys()].map((k) => k.length));
  const head = [pad('reader', idWidth), ...cols.map((c) => pad(`A${c}`, 4)), '?'];
  console.log(head.join('  '));
  console.log('-'.repeat(head.join('  ').length));

  for (const row of rows.values()) {
    const cells = cols.map((c) => {
      const n = row.seen.get(c) || 0;
      return pad(n === 0 ? '·' : n === 1 ? '✓' : String(n), 4);
    });
    console.log([pad(row.tool.id, idWidth), ...cells, row.unstated || '·'].join('  '));
  }

  /* What to go and take. A reader proven on nothing but dumps of unstated
     provenance is one release away from a silent null nobody will see. */
  console.log('');
  const bare = [...rows.values()].filter((r) => r.seen.size === 0);
  if (bare.length) {
    console.log(`no fixture states a release for: ${bare.map((r) => r.tool.id).join(', ')}`);
  }
  for (const c of cols) {
    const missing = [...rows.values()].filter((r) => !r.seen.has(c)).map((r) => r.tool.id);
    if (missing.length) console.log(`no Android ${c} fixture for: ${missing.join(', ')}`);
  }
  console.log('');
  console.log('✓ a fixture off that release   n that many   · none   ? release unstated');
}

const page = openPage();
const tools = page.TOOLS.map((t) => ({ id: t.id, parse: t.parse.name }));
const rows = build(tools, await bugreportTools());
print(rows, releases(rows));
