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
const EXPECTED = ['window', 'sf', 'package', 'anr', 'car', 'user',
                  'binder', 'input', 'inputdev', 'logcat'];

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
  page.load(text, null, from || label, from ? label : null);

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
  page.load(text, 'logcat', from);
  const open = page.docs().find((d) => d.id === page.S.docId);
  assert.equal(open.found[0].tool.id, 'logcat');
  assert.equal(page.docs().length, EXPECTED.length, 'the rest are open behind it');
});

test('a reader inside a bugreport finds what it finds on its own', async () => {
  const page = openPage();
  const { text } = await page.readDump(zipFile());
  page.load(text, null, 'bugreport');
  const found = page.docs().map((d) => d.found[0]);

  for (const [id, fixture] of [
    ['window', 'window-sample.txt'],
    ['sf', 'sf-sample.txt'],
    ['input', 'input-sample.txt'],
    ['binder', 'binder-sample.txt'],
    ['logcat', 'logcat-sample.txt'],
  ]) {
    const tool = page.TOOLS.find((t) => t.id === id);
    const alone = tool.parse(readFileSync(dir(`fixtures/${fixture}`), 'utf8'));
    const inside = found.find((f) => f.tool.id === id).scene;
    assert.equal(inside.nodes.length, alone.nodes.length,
      `${id} read a different number of nodes out of the bugreport`);
    assert.deepEqual(inside.displays.map((d) => d.id), alone.displays.map((d) => d.id), id);
  }
});

/* The logs are the reason a bugreport is taken as often as the dumps are. */
test('the logs come out as their own reader, one group per buffer', async () => {
  const page = openPage();
  const { text } = await page.readDump(zipFile());
  page.load(text, null, 'bugreport');
  const log = page.docs().map((d) => d.found[0])
    .find((f) => f.tool.id === 'logcat').scene;

  assert.deepEqual(log.displays.map((d) => d.label),
    ['system log', 'event log', 'radio log', 'kernel log']);
  assert.ok(log.globals.crashes >= 1, 'and the crash in it is counted');
  assert.equal(log.displays[0].crashes.includes('AndroidRuntime'), true);
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

test('the log list is filtered by that same reading', () => {
  const page = openPage();
  page.load(readFileSync(dir('fixtures/logcat-sample.txt'), 'utf8'), 'logcat', 'logcat.txt');

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
test('the .* switch reads the box as a pattern without the slashes', () => {
  const page = openPage();
  page.load(readFileSync(dir('fixtures/logcat-sample.txt'), 'utf8'), 'logcat', 'logcat.txt');

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
