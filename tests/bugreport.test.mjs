/* What happens to a whole `adb bugreport`, from the zip inwards.
 *
 * The other two test files are about one dump at a time. This one is about the
 * file people actually have: an archive, holding one text, holding every
 * service's dump one after another — and therefore about the two things that
 * decide whether Telltale is any use on it. That the zip is opened to the
 * right file inside it, and that every reader which knows a section of that
 * text says so, because a reader that says so is a tab.
 *
 * The zip is `tests/fixtures/bugreport-sample.zip`, written by
 * tools/make-bugreport-fixture.py out of the text fixtures next to it — by
 * Python's zipfile rather than by anything in here, so what is being read is
 * an archive this repository did not write.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openPage } from '../tools/page-harness.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const bytes = readFileSync(dir('fixtures/bugreport-sample.zip'));
const zipFile = () => new File([bytes], 'bugreport-2026-09-21.zip', { type: 'application/zip' });

const NAME = 'bugreport-panther-UQ1A.240105.004-2026-09-21-11-04-02.txt';

/* Every reader in the page that a bugreport should turn up. `car` is in here
   because the fixture carries a car_service dump; a bugreport off a phone
   would open with one tab fewer, which is the point of the list being derived
   from what is in the file rather than hard-coded. */
const EXPECTED = ['window', 'sf', 'display', 'activity', 'package', 'anr', 'car', 'user',
                  'props', 'overlay', 'binder', 'input', 'inputdev', 'events', 'logcat'];

test('the zip is opened to the file dumpstate named, not to the biggest one', async () => {
  const page = openPage();
  const index = page.zipIndex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.ok(index.some((e) => e.name === 'main_entry.txt'));
  assert.ok(index.some((e) => e.name === NAME));
  assert.ok(index.some((e) => e.name.startsWith('FS/')), 'and the collected files are in there too');

  const { text, label, from } = await page.readDump(zipFile());
  assert.equal(from, NAME, 'main_entry.txt names the dump, so that is the one read');
  assert.equal(label, 'bugreport-2026-09-21.zip');
  assert.ok(text.includes('WINDOW MANAGER WINDOWS'), 'and it came out inflated');
  assert.ok(text.length > 60000);
});

test('a text file is read as itself, not sniffed at', async () => {
  const page = openPage();
  const plain = new File([readFileSync(dir('fixtures/window-sample.txt'))], 'windows.txt');
  const { text, from } = await page.readDump(plain);
  assert.equal(from, undefined, 'nothing was unpacked');
  assert.ok(text.startsWith('WINDOW MANAGER'));
});

test('every dump a bugreport holds opens in its own tab', async () => {
  const page = openPage();
  const { text, label, from } = await page.readDump(zipFile());
  await page.load(text, null, from || label, from ? label : null);

  assert.equal(page.error(), null, 'it loaded');
  const docs = page.docs();
  assert.deepEqual(docs.map((d) => d.found[0].tool.id), EXPECTED,
    'one tab per reader, in the order the readers are registered');

  for (const d of docs) {
    const f = d.found[0];
    assert.equal(d.found.length, 1, 'a tab is one reading, not a switch over several');
    assert.ok(f.scene.ok, `${f.tool.id} kept a scene`);
    assert.ok(f.scene.nodes.length > 0, `${f.tool.id} found something`);
    assert.ok(f.score >= 2, `${f.tool.id} recognised it rather than being guessed at`);
    assert.equal(d.label, NAME, 'every tab names the file it was read out of');
    assert.equal(d.from, 'bugreport-2026-09-21.zip');
  }

  // and the one in front is the first of them
  assert.equal(page.S.docId, docs[0].id);
});

/* Which tab opens in front is the link's business, not the order's. */
test('?tool= decides which of the tabs is in front', async () => {
  const page = openPage();
  const { text, from } = await page.readDump(zipFile());
  await page.load(text, 'logcat', from);
  const open = page.docs().find((d) => d.id === page.S.docId);
  assert.equal(open.found[0].tool.id, 'logcat');
  assert.equal(page.docs().length, EXPECTED.length, 'the rest are open behind it');
});

test('a reader inside a bugreport finds what it finds on its own', async () => {
  const page = openPage();
  const { text } = await page.readDump(zipFile());
  await page.load(text, null, 'bugreport');
  const found = page.docs().map((d) => d.found[0]);

  for (const [id, fixture] of [
    ['window', 'window-sample.txt'],
    ['sf', 'sf-sample.txt'],
    ['input', 'input-sample.txt'],
    ['binder', 'binder-sample.txt'],
    ['logcat', 'logcat-sample.txt'],
    ['props', 'props-sample.txt'],
    ['display', 'display-sample.txt'],
    ['activity', 'activity-sample.txt'],
  ]) {
    const tool = page.TOOLS.find((t) => t.id === id);
    const alone = tool.parse(readFileSync(dir(`fixtures/${fixture}`), 'utf8'));
    const inside = found.find((f) => f.tool.id === id).scene;
    assert.equal(inside.nodes.length, alone.nodes.length,
      `${id} read a different number of nodes out of the bugreport`);
    assert.deepEqual(inside.displays.map((d) => d.id), alone.displays.map((d) => d.id), id);
  }
});

/* Every other reader in a bugreport says what the device was doing. This one
   says what the device is, and it says it in the pane of whichever namespace
   is open — because the namespace somebody opened is not usually the one the
   fingerprint is in. */
test('the properties tab answers what device this is, from any namespace', async () => {
  const page = openPage();
  const { text } = await page.readDump(zipFile());
  await page.load(text, 'props', 'bugreport');

  const doc = page.docs().find((d) => d.found[0].tool.id === 'props');
  page.open(doc);

  const scene = doc.found[0].scene;
  for (const d of scene.displays.slice(0, 3)) {
    page.display(d.id);
    page.select(null);
    const pane = page.detail();
    assert.match(pane, /UQ1A\.240105\.004/, `${d.label} did not say which build`);
    assert.match(pane, /Pixel 7/, `${d.label} did not say which device`);
    assert.match(pane, /2024-01-05/, `${d.label} did not say the patch level`);
  }
});

test('a service init did not keep running is badged, and the pane says why', async () => {
  const page = openPage();
  const { text } = await page.readDump(zipFile());
  await page.load(text, 'props', 'bugreport');
  const doc = page.docs().find((d) => d.found[0].tool.id === 'props');
  page.open(doc);

  const stopped = doc.found[0].scene.nodes.find((n) => n.name === 'init.svc.vendor.sensors-hal');
  assert.deepEqual(stopped.badges, [['restarting', 'badge-exit']]);

  page.display(stopped.displayId);
  page.select(stopped.hash);
  const pane = page.detail();
  assert.match(pane, /init\.svc\.vendor\.sensors-hal/);
  assert.match(pane, /restarting/);
  assert.match(pane, /writable while the device is up/,
    'and says init is what writes it, rather than the build');
});

/* The logs are the reason a bugreport is taken as often as the dumps are. */
test('the logs come out as their own reader, one group per buffer', async () => {
  const page = openPage();
  const { text } = await page.readDump(zipFile());
  await page.load(text, null, 'bugreport');
  const log = page.docs().map((d) => d.found[0])
    .find((f) => f.tool.id === 'logcat').scene;

  assert.deepEqual(log.displays.map((d) => d.label),
    ['system log', 'radio log', 'kernel log'],
    'and not the event buffer, which is the event reader\'s');
  assert.ok(log.globals.crashes >= 1, 'and the crash in it is counted');
  assert.equal(log.displays[0].crashes.includes('AndroidRuntime'), true);
});

/* The event log is in the same file as the logs and the dumps, and it is the
   one buffer the log reader hands over whole: every line in it is a tag and a
   list of numbers, which is unreadable as a line and is what this reader is
   for. */
test('the event buffer opens as its own reader, and not as log lines', async () => {
  const page = openPage();
  const { text } = await page.readDump(zipFile());
  await page.load(text, 'events', 'bugreport');

  const doc = page.docs().find((d) => d.found[0].tool.id === 'events');
  page.open(doc);
  const scene = doc.found[0].scene;

  assert.deepEqual(scene.displays.map((d) => d.label), ['event log'],
    'only the events buffer, not the system log next to it');
  assert.deepEqual(scene.nodes.map((n) => n.tag),
    ['am_proc_start', 'wm_set_resumed_activity', 'am_crash', 'am_proc_died', 'am_low_memory']);

  const crash = scene.nodes.find((n) => n.tag === 'am_crash');
  assert.equal(crash.kind, 'trouble');
  assert.equal(crash.who, 'com.example.tracker');
  page.select(crash.hash);
  const pane = page.detail();
  assert.match(pane, /IllegalStateException/);
  assert.match(pane, /AndroidRuntime/, 'and says where the stack that goes with it is');

  /* And the log reader has left them alone, so no line is on the desk twice. */
  const log = page.docs().find((d) => d.found[0].tool.id === 'logcat').found[0].scene;
  assert.ok(!log.nodes.some((n) => n.tag === 'am_crash'));
  assert.ok(!log.displays.some((d) => /event/.test(d.label)));
});

/* A bugreport that stopped copying halfway is the normal kind of broken file,
   and what it must not do is come back as "could not be read" with nothing
   said about why. */
test('a truncated zip is refused with a reason, not a crash', async () => {
  const page = openPage();
  const cut = new File([bytes.subarray(0, 400)], 'half-a-bugreport.zip');
  await assert.rejects(() => page.readDump(cut), /no index in it|truncated|not a zip/);
});

/* The sniff is on the bytes, not on the name: a file called .zip that is not
   one is read as the text it is, rather than refused for its extension. */
test('only a real archive is unpacked', async () => {
  const page = openPage();
  assert.equal(page.isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(page.isZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06])), false, 'an empty archive holds no dump');
  assert.equal(page.isZip(new Uint8Array([0x57, 0x49, 0x4e])), false);

  const misnamed = new File([readFileSync(dir('fixtures/window-sample.txt'))], 'windows.zip');
  const { text, from } = await page.readDump(misnamed);
  assert.equal(from, undefined);
  assert.ok(text.startsWith('WINDOW MANAGER'));
});

/* ---------------- the filter boxes ---------------- */

/* Plain text is a substring; text between slashes is a pattern. This is the
   one piece of the page that decides which rows exist, and a log is read by
   pattern more than by word, so both readings are pinned here. */
test('a filter is a substring, or a regular expression between slashes', () => {
  const page = openPage();
  const m = page.match;

  assert.equal(m(''), null, 'an empty box filters nothing');
  assert.equal(m('   '), null);

  const plain = m('ActivityManager');
  assert.equal(plain.regex, false);
  assert.equal(plain.test('tag activitymanager said something'), true,
    'the text matched against is lowercased, so the query is too');

  const rx = m('/^am_(crash|anr)/');
  assert.equal(rx.regex, true);
  assert.equal(rx.ok, true);
  assert.equal(rx.test('am_crash 4471 com.example'), true);
  assert.equal(rx.test('not am_crash'), false, 'the anchor is the caller\'s');

  assert.equal(m('/PackageManager/').test('packagemanager: no package'), true,
    'case is ignored whether or not the i flag was typed');

  const stateful = m('/a/g');
  assert.equal(stateful.test('aaa'), true);
  assert.equal(stateful.test('aaa'), true, 'g is dropped, so the match does not walk');

  const bad = m('/[unclosed/');
  assert.equal(bad.ok, false);
  assert.ok(bad.error, 'and it says what is wrong with it rather than matching its own slashes');
  assert.equal(bad.test('anything'), false);
});

test('the log list is filtered by that same reading', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/logcat-sample.txt'), 'utf8'), 'logcat', 'logcat.txt');

  const all = page.filter('');
  assert.ok(all.length > 0);

  const tagged = page.filter('activitymanager');
  assert.equal(tagged.length, 6);
  assert.ok(tagged.every((n) => n.tag === 'ActivityManager'));

  /* The text a row is matched on is the tag first, so a pattern anchored at
     the front is a tag query and one in the middle is a message query. */
  const byTag = page.filter('/^activitymanager\\b/');
  assert.equal(byTag.length, 6);

  const byMessage = page.filter('/fatal exception|has died/');
  assert.ok(byMessage.length >= 2);
  assert.ok(byMessage.some((n) => n.crash), 'the crash is one of them');

  const either = page.filter('/^(surfacecontrol|windowmanager)\\b/');
  assert.deepEqual([...new Set(either.map((n) => n.tag))].sort(),
    ['SurfaceControl', 'WindowManager']);

  assert.deepEqual(page.filter('/[/'), [], 'a pattern that will not compile lists nothing');
});

/* The switch beside the box is the other way in: with it on, what is typed is
   the pattern, slashes and all not needed. `activity.*` is a query someone
   types expecting exactly that. */
test('the .* switch reads the box as a pattern without the slashes', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/logcat-sample.txt'), 'utf8'), 'logcat', 'logcat.txt');

  assert.deepEqual(page.filter('activity.*', false), [],
    'off, the dots and the star are themselves and nothing has them');

  const on = page.filter('activity.*', true);
  assert.ok(on.length >= 6, 'on, it matches the tag and every message with the word in it');
  assert.ok(on.every((n) => /activity/i.test(n.search)));
  assert.ok(on.some((n) => n.tag === 'ActivityManager'));

  assert.equal(page.filter('surfacecontrol|windowmanager', true).length > 0, true,
    'an alternation needs no slashes either');

  const m = page.match('[', true);
  assert.equal(m.ok, false, 'and a pattern that will not compile still says so');
});

/* ---------- the desk-wide search ---------- */

/* The filter above the list searches the dump being read; Search in the top
   bar searches the whole desk. On a bugreport that is the difference between
   one reader's answer and ten of them, which is the only reason the feature
   exists — the thing being looked for is usually in the tab that is not open.
   These are the page's own `findHits` and `goToHit`, so what is asserted is
   what ⌘K does. */

async function desk() {
  const page = openPage();
  const { text, label, from } = await page.readDump(zipFile());
  await page.load(text, null, from, label);
  return page;
}

test('the search walks every tab on the desk, not the one in front', async () => {
  const page = await desk();
  assert.equal(page.docs().length, EXPECTED.length, 'ten tabs to search');

  const res = page.find('system');
  assert.ok(res.total > 0);
  assert.ok(res.groups.length > 1, 'the hits came out of more than one tab');

  /* A group says which tab, which reader and — where the reader found more
     than one — which display, so two groups can share a tab. */
  const readers = new Set(res.groups.map((g) => g.entry.tool.id));
  assert.ok(readers.size > 1, 'and out of more than one reader');
  assert.ok([...readers].every((id) => EXPECTED.includes(id)));

  assert.ok(res.flat.every((h) => /system/i.test(h.node.search)),
    'every listed hit matches, on the same text the filter matches on');
  assert.equal(res.flat.length,
    res.groups.reduce((n, g) => n + g.hits.length, 0),
    'the flat list the keyboard walks is the groups, in the order they are drawn');
});

test('a group is capped rather than dropped, and the count says so', async () => {
  const page = await desk();
  /* Matches everything a parser hung any text on, which is far past the cap in
     at least one reader. */
  const res = page.find('/./');
  assert.ok(res.capped, 'some group had more than it listed');
  assert.ok(res.groups.some((g) => g.more > 0));
  assert.ok(res.total > res.flat.length,
    'the total counts what was found, not what was listed');
  for (const g of res.groups) assert.ok(g.hits.length <= 25);
});

test('the search reads a pattern the way the filter does', async () => {
  const page = await desk();

  assert.equal(page.find('activity.*', false).total, 0,
    'off, the dots and the star are themselves');
  assert.ok(page.find('activity.*', true).total > 0, 'on, it is a pattern');
  assert.ok(page.find('/^activity/').total > 0, 'and slashes need no switch');

  const bad = page.find('(', true);
  assert.equal(bad.total, 0);
  assert.ok(bad.bad && /Unterminated group/.test(bad.bad.error),
    'a pattern that will not compile says what is wrong with it');
});

test('opening a hit lands on its tab, its display, and leaves the query on', async () => {
  const page = await desk();
  const res = page.find('system');
  const hit = res.flat.find((h) => h.doc.id !== page.S.docId);
  assert.ok(hit, 'something was found in a tab that is not the open one');

  page.goTo(hit, 'system', false);
  assert.equal(page.S.docId, hit.doc.id, 'that tab is open');
  assert.equal(page.S.toolId, hit.entry.tool.id, 'showing the reader that found it');
  assert.equal(page.S.displayId, hit.display.id, 'on the display it came from');
  assert.equal(page.S.selected, hit.node.hash, 'with the row selected');
  assert.equal(page.S.filter, 'system', 'and the query left on as that tab filter');
  assert.equal(page.S.regex, false);

  /* A query read as a pattern has to keep being read as one on the way over,
     or the tab lands filtered to nothing by the thing that was just found. */
  const pat = page.find('/^activity/', false);
  const p = pat.flat[0];
  page.goTo(p, '/^activity/', false);
  assert.equal(page.S.filter, '/^activity/');
  assert.ok(page.filter(page.S.filter, page.S.regex).some((n) => n.hash === p.node.hash),
    'and the row that was found is one of the rows the filter leaves');
});

/* ---------- a reader stays inside its own section ---------- */

/* Every parser is handed the whole bugreport, so one that marks its sections
   with something another dump also prints will read that other dump as its
   own. Two did: `dumpsys user` calls any line at no indent a section, which is
   every heading in the file; `dumpsys car_service` calls any line between
   stars a service, which is every SurfaceFlinger layer (`* Layer 0x...`). A
   phone's bugreport then opened the Users tab on nine thousand sections of
   SurfaceFlinger and package. Both now read inside their own part of the file,
   and these say so by the line numbers the rows came off. */

/* Where a `------ NAME (dumpsys x) ------` section runs from and to. Taken out
   of the fixture rather than written down, so editing the fixture cannot leave
   the bounds behind. */
function section(text, head) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes(head));
  assert.ok(start >= 0, `the fixture has a ${head} section`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^-{3,}/.test(lines[i])) { end = i; break; }
  }
  return { start: start + 1, end: end + 1 };   // 1-based, the way a row counts
}

async function tabOf(id) {
  const page = openPage();
  const { text, label, from } = await page.readDump(zipFile());
  await page.load(text, null, from, label);
  const doc = page.docs().find((d) => d.found[0].tool.id === id);
  assert.ok(doc, `${id} opened a tab`);
  return { page, text, scene: doc.found[0].scene };
}

test('the user dump is read inside its own section, not the whole bugreport', async () => {
  const { text, scene } = await tabOf('user');
  const { start, end } = section(text, '------ USERS (dumpsys user)');

  assert.ok(scene.nodes.length > 0);
  for (const n of scene.nodes) {
    assert.ok(n.at >= start && n.at <= end,
      `${n.title} came off line ${n.at}, outside the users section ${start}-${end}`);
  }

  const titles = scene.nodes.map((n) => n.title);
  assert.ok(titles.includes('Users'));
  assert.ok(titles.some((t) => t.startsWith('user 0')), 'the users are in there');
  assert.ok(titles.some((t) => /^User types/.test(t)), 'and so are the types');
  assert.ok(!titles.some((t) => /Layer |DisplayDevice|Hardware Composer|WINDOW MANAGER/.test(t)),
    'and nothing another dump printed');

  assert.equal(scene.globals.current, 10, 'the current user is this section own');
  assert.ok(scene.globals.lines < 400, 'and the dump is as long as the section, not the file');
});

test('the car dump is read inside its own section, not every line between stars', async () => {
  const { text, scene } = await tabOf('car');
  const { start, end } = section(text, '------ CAR SERVICE (dumpsys car_service)');

  assert.ok(scene.nodes.length > 0);
  for (const n of scene.nodes) {
    assert.ok(n.at >= start && n.at <= end,
      `${n.title} came off line ${n.at}, outside the car section ${start}-${end}`);
  }
  assert.ok(!scene.nodes.some((n) => /^Layer 0x|^BufferStateLayer|^EffectLayer/.test(n.title)),
    'a SurfaceFlinger layer is not a car service');
});

/* A dump pasted on its own carries none of a bugreport's headings, and has to
   go on being read from its first line to its last. */
test('a dump on its own is still read whole', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/user-sample.txt'), 'utf8'), 'user', 'user.txt');
  const users = page.docs()[0].found[0].scene;
  assert.equal(users.nodes[0].at, 3, 'the first section is the one the file opens with');
  assert.ok(users.nodes.some((n) => n.title === 'Whitelisted packages per user type'),
    'and the last one is still read');

  const car = openPage();
  await car.load(readFileSync(dir('fixtures/car-service-sample.txt'), 'utf8'), 'car', 'car.txt');
  assert.ok(car.docs()[0].found[0].scene.nodes.length > 5);
});
