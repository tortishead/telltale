/* The join between the readers.
 *
 * The other test files are about one reader at a time: text in, scene out.
 * This one is about what the readers have in common — that a pid in a log line
 * and a pid on an input window are the same process, and that a package is the
 * same package whether a dump wrote it as `10143` or as `u0a143`. The fixture
 * is the bugreport, because the join is only worth anything on a file holding
 * several dumps of one device at one moment.
 *
 * Everything here is the page's own functions, called the way the details pane
 * calls them: the node and the group it sits on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openPage } from '../tools/page-harness.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const bytes = readFileSync(dir('fixtures/bugreport-sample.zip'));

async function desk(){
  const page = openPage();
  const { text, label, from } = await page.readDump(new File([bytes], 'bugreport.zip'));
  await page.load(text, null, from || label, from ? label : null);
  /* A reader, the group a node sits on, and the node itself — the three things
     the pane has in hand when it draws the card. */
  page.pick = (toolId, title) => {
    const entry = page.docs().find((d) => d.found[0].tool.id === toolId).found[0];
    for(const display of entry.scene.displays){
      const node = display.nodes.find((n) => n.title.startsWith(title));
      if(node) return { doc: page.docs().find((d) => d.found[0] === entry), entry, display, node };
    }
    throw new Error(`${toolId} has no node called ${title}`);
  };
  page.idsOf = (toolId, title) => {
    const at = page.pick(toolId, title);
    return page.ids(at.node, at.display);
  };
  page.joinOf = (toolId, title) => {
    const at = page.pick(toolId, title);
    return page.join(at.node, at.display);
  };
  return page;
}

const kinds = (ids, kind) => ids.filter((i) => i.kind === kind).map((i) => i.value);
const readers = (join, kind, value) => {
  const one = join.find((j) => j.id.kind === kind && j.id.value === value);
  assert.ok(one, `nothing on the spine for ${kind} ${value}`);
  return [...new Set(one.groups.map((g) => g.entry.tool.id))];
};

test('a node says what it is keyed by, in whatever the dump called it', async () => {
  const page = await desk();

  const win = page.idsOf('window', 'NavigationBar0');
  assert.deepEqual(kinds(win, 'uid'), [1000]);
  assert.deepEqual(kinds(win, 'pkg'), ['com.android.systemui']);
  /* The window dump states the pid of the owning process in one place only:
     the session it holds. */
  assert.deepEqual(kinds(win, 'pid'), [1234]);
  assert.ok(kinds(win, 'token').includes('c0ffee1'), 'and the window record itself');

  const inp = page.idsOf('input', 'PointerEventDispatcher0');
  assert.deepEqual(kinds(inp, 'pid'), [1631]);
  assert.deepEqual(kinds(inp, 'uid'), [1000]);

  const line = page.idsOf('logcat', 'Start proc 5210');
  assert.deepEqual(kinds(line, 'pid'), [1631], 'the pid that logged it');
  assert.deepEqual(kinds(line, 'tid'), [1668]);
});

/* The one piece of arithmetic in the file, and the reason it is there: the
   same app uid is written three ways across one bugreport. */
test('u0a143 and 10143 are one uid', async () => {
  const page = await desk();
  const task = page.idsOf('activity', 'task #6');
  assert.ok(kinds(task, 'uid').includes(10143),
    'the task heading writes it as u0a143 and as A=10143, and both land on the number');
});

test('a pid reaches the other readers that named it', async () => {
  const page = await desk();
  const join = page.joinOf('input', 'PointerEventDispatcher0');
  assert.deepEqual(readers(join, 'pid', 1631).sort(), ['events', 'logcat'],
    'system_server owns the pointer monitor, and the logs are full of it');
});

test('a package reaches the dumps that describe it', async () => {
  const page = await desk();
  const join = page.joinOf('window', 'NavigationBar0');
  const where = readers(join, 'pkg', 'com.android.systemui').sort();
  assert.deepEqual(where, ['package', 'service', 'window'],
    'the window, the service it runs, and the package it was installed as');
});

/* A process name is the one identifier a log line usually carries instead of a
   package, so the two have to be the same thing on the spine. */
test('a process name is a claim about a package', async () => {
  const page = await desk();
  const act = page.idsOf('activity', 'com.android.settings/');
  assert.ok(kinds(act, 'proc').includes('com.android.settings'));
  assert.ok(kinds(act, 'pkg').includes('com.android.settings'));

  const join = page.joinOf('activity', 'com.android.settings/');
  assert.ok(readers(join, 'pkg', 'com.android.settings').includes('package'));
});

/* An ANR is the one dump whose subject is a process rather than a thing on a
   display: it states the pid once, at the top, and the threads under it say
   only their own tid. */
test('an ANR hands its process down to every thread in it', async () => {
  const page = await desk();
  const ids = page.idsOf('anr', 'main');
  assert.deepEqual(kinds(ids, 'pid'), [12345]);
  assert.deepEqual(kinds(ids, 'pkg'), ['com.example.shop']);

  const join = page.joinOf('anr', 'main');
  assert.ok(readers(join, 'pkg', 'com.example.shop').includes('package'),
    'so the package dump for the app that hung is one click away');
});

/* The regression that says the shapes are read rather than guessed at: a
   display called `Internal` and a user called `Owner` are not packages. */
test('what a group is called is not mistaken for a package', async () => {
  const page = await desk();
  for(const [tool, title] of [['input', 'PointerEventDispatcher0'], ['package', 'com.example.shop']]){
    for(const id of page.idsOf(tool, title)){
      if(id.kind !== 'pkg') continue;
      assert.match(id.value, /\./, `${tool} called ${id.value} a package`);
    }
  }
  assert.deepEqual(kinds(page.idsOf('package', 'com.example.shop'), 'pkg'), ['com.example.shop'],
    'the package dump names its own package and nothing else');
});

/* The pane draws what the node is keyed by and nothing else. Reading that off
   a node is field reads and a memo; finding where each one leads is a walk of
   the desk, and the walk is what the chip is for. */
test('the pane lists the identifiers, and walks the desk for none of them', async () => {
  const page = await desk();
  const at = page.pick('input', 'PointerEventDispatcher0');
  page.open(at.doc);
  page.display(at.display.id);
  page.select(at.node.hash);

  const html = page.detail();
  assert.match(html, /Elsewhere on this desk/);
  assert.match(html, /<button class="chip chip-id" type="button" data-spine="0">pid 1631</);
  assert.deepEqual(page.chips().map((id) => `${id.kind} ${id.value}`), ['pid 1631', 'uid 1000']);
  assert.equal(page.finding().id, null, 'the card is not up and nothing has been joined');
});

/* An identifier that is on nothing else is still what the node is called, so
   it is still a chip — the card it opens is what says there is nothing there. */
test('an identifier that joins to nothing is still listed', async () => {
  const page = await desk();
  const at = page.pick('window', 'NavigationBar0');
  page.open(at.doc);
  page.display(at.display.id);
  page.select(at.node.hash);
  assert.ok(page.chips().some((id) => id.kind === 'token' && id.value === 'c0ffee1'),
    'no other dump in this build reprints a window token');
});

test('picking a chip opens the card on that identifier alone', async () => {
  const page = await desk();
  const at = page.pick('input', 'PointerEventDispatcher0');
  page.open(at.doc);
  page.display(at.display.id);
  page.select(at.node.hash);

  page.openSpine(page.chips().findIndex((id) => id.kind === 'pid'));
  const up = page.finding();
  assert.deepEqual(up.id, { kind:'pid', value:1631 });
  assert.equal(up.groups.total, 14, 'system_server owns the monitor and the logs are full of it');
  assert.deepEqual([...new Set(up.groups.groups.map((g) => g.entry.tool.id))].sort(),
    ['events', 'logcat'], 'and only the readers that named that pid');
  assert.equal(up.flat.length, up.groups.total, 'every one of them is listed and walkable');
});

test('going to a row on the spine opens the dump it is in', async () => {
  const page = await desk();
  const at = page.pick('input', 'PointerEventDispatcher0');
  page.open(at.doc);
  page.display(at.display.id);
  page.select(at.node.hash);
  page.openSpine(page.chips().findIndex((id) => id.kind === 'pid'));

  const hit = page.finding().flat.find((h) => h.entry.tool.id === 'logcat');
  page.goTo(hit);
  assert.equal(page.S.docId, hit.doc.id, 'the log is open');
  assert.equal(page.S.selected, hit.node.hash, 'on the line that named the same process');
  assert.equal(page.S.filter, '',
    'and nothing is typed into its filter: the row was found by what it is');
});
