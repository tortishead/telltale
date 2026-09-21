/* What the page does when what it is handed is wrong.
 *
 * The other three test files are about dumps that are what they claim to be.
 * This one is about the rest of what lands on a debugging tool: a reader that
 * meets a shape no build has printed before and throws, an archive whose
 * download stopped half way, a paste that turned out to be nothing. None of
 * those is a reason for the page to stop working, and each of them used to be.
 *
 * Everything here is asserted through the page's own functions, the way the
 * page calls them — a reader is made to fail by replacing the one the page
 * registered, not by reaching inside `load`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openPage } from '../tools/page-harness.mjs';
import {
  parseWindowDump, parseUserDump, parseCarServiceDump, parseInputDump,
  parseLogcatDump, parsePackageDump, parseAnrDump, parseSurfaceFlingerDump,
  parseBinderCallsStatsDump, parseInputDevicesDump,
} from '../tools/parse-layer.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (name) => readFileSync(dir(`fixtures/${name}`), 'utf8');
const zipBytes = readFileSync(dir('fixtures/bugreport-sample.zip'));

const PARSERS = {
  window: parseWindowDump, sf: parseSurfaceFlingerDump, package: parsePackageDump,
  anr: parseAnrDump, car: parseCarServiceDump, user: parseUserDump,
  binder: parseBinderCallsStatsDump, input: parseInputDump,
  inputdev: parseInputDevicesDump, logcat: parseLogcatDump,
};

/* ---- what every parser is handed ---------------------------------------- */

test('every parser takes nothing at all and says it read nothing', () => {
  for(const [id, parse] of Object.entries(PARSERS)){
    for(const nothing of [undefined, null, '']){
      const scene = parse(nothing);
      assert.equal(typeof scene, 'object', `${id} handed back a scene for ${nothing}`);
      assert.equal(scene.ok, false, `${id} claims to have read ${nothing}`);
      assert.deepEqual(scene.nodes, [], `${id} invented nodes out of ${nothing}`);
    }
  }
});

/* A dump pulled through a Windows adb, or off a clipboard that normalised
   nothing, arrives with CRLF. Every parser agrees what a line is, so the same
   text read either way is the same dump — and not one with a \r on the end of
   every field it read. */
test('a dump read with CRLF line ends is the same dump', () => {
  const same = (parse, text) => {
    const unix = parse(text);
    const dos = parse(text.replace(/\n/g, '\r\n'));
    assert.equal(dos.ok, unix.ok);
    assert.equal(dos.nodes.length, unix.nodes.length);
    assert.deepEqual(dos.nodes.map(n => n.title), unix.nodes.map(n => n.title));
  };
  same(parseWindowDump, fixture('window-sample.txt'));
  same(parseUserDump, fixture('user-sample.txt'));
  same(parseCarServiceDump, fixture('car-service-sample.txt'));
  same(parseInputDump, fixture('input-sample.txt'));
  same(parseLogcatDump, fixture('logcat-sample.txt'));
});

/* ---- one reader failing is not the load failing ------------------------- */

test('a reader that throws costs its own tab and nothing else', async () => {
  const page = openPage();
  const broken = page.TOOLS.find(t => t.id === 'window');
  broken.parse = () => { throw new Error('a shape no build has printed'); };

  const file = new File([zipBytes], 'bugreport.zip', { type: 'application/zip' });
  const { text, label, from } = await page.readDump(file);
  await page.load(text, null, from || label, from ? label : null);

  const ids = page.docs().map(d => d.found[0].tool.id);
  assert.ok(ids.length >= 8, 'the readers that worked still opened');
  assert.ok(!ids.includes('window'), 'and the one that threw did not');
  assert.equal(page.error(), null, 'nothing was reported as a failure of the load');
});

/* A reader that hands back something that is not a scene is broken in the same
   way as one that threw, and used to be the worse of the two: the throw was
   caught and the `scene.ok` read on the line after it was not. */
test('a reader that hands back nothing is treated as one that threw', async () => {
  const page = openPage();
  page.TOOLS.find(t => t.id === 'window').parse = () => undefined;

  const file = new File([zipBytes], 'bugreport.zip', { type: 'application/zip' });
  const { text, label, from } = await page.readDump(file);
  await page.load(text, null, from || label, from ? label : null);

  const ids = page.docs().map(d => d.found[0].tool.id);
  assert.ok(ids.length >= 8);
  assert.ok(!ids.includes('window'));
});

test('every reader failing is one message naming each of them', async () => {
  const page = openPage();
  for(const tool of page.TOOLS) tool.parse = () => { throw new Error(`${tool.id} gave up`); };

  await page.load(fixture('window-sample.txt'), null, 'windows.txt');
  const err = page.error();
  assert.ok(err, 'the page said so');
  assert.match(err, /could not be read/);
  assert.match(err, /window gave up/, 'and named the reader that failed');
  assert.equal(page.docs().length, 0);
});

test('text nothing recognises is a message, not a thrown error', async () => {
  const page = openPage();
  await page.load('a shopping list\nmilk\nbread\n', null, 'list.txt');
  assert.match(page.error(), /Nothing recognisable/);
  assert.equal(page.docs().length, 0);
});

test('load takes nothing at all without throwing', async () => {
  const page = openPage();
  for(const nothing of [undefined, null, '']){
    await page.load(nothing, null, 'nothing');
    assert.ok(page.error(), 'and says so every time');
  }
  assert.equal(page.docs().length, 0);
});

/* ---- archives that are not whole ---------------------------------------- */

/* A download that stopped, or a zip cut at the wrong byte. What matters is
   that it is told as a truncated archive rather than as whatever RangeError
   fell out of reaching for bytes that are not there. */
test('a zip cut off part way says so, in words about the zip', async () => {
  const cut = zipBytes.subarray(0, Math.floor(zipBytes.length * 0.6));
  /* The index lives at the end, so a zip cut in the middle has none at all. */
  const page = openPage();
  await assert.rejects(
    () => page.readDump(new File([cut], 'half.zip', { type: 'application/zip' })),
    (e) => {
      assert.match(e.message, /truncated|not a zip/);
      assert.doesNotMatch(e.message, /RangeError|Offset is outside/);
      return true;
    });
});

/* The other half of the same failure: the index survived but what it points at
   did not, which is what a zip rebuilt from a partial download looks like. */
test('an entry pointing past the end of the file says the archive is truncated', async () => {
  const page = openPage();
  const buf = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength);
  const index = page.zipIndex(buf);
  const entry = index.find(e => e.name.endsWith('.txt') && e.packed > 0);
  assert.ok(entry, 'the fixture has a packed text entry to point past the end');

  /* Move the entry's local header beyond the last byte and read it the way the
     page reads one, through the same path zipPickDump takes. */
  const short = buf.slice(0, entry.localAt + 8);
  await assert.rejects(() => page.zipPickDump(short), /truncated|no index|not a zip/);
});

test('bytes that are not a zip at all are read as text, not unpacked', async () => {
  const page = openPage();
  const plain = new File([fixture('window-sample.txt')], 'windows.txt');
  const { text, from } = await page.readDump(plain);
  assert.equal(from, undefined);
  assert.ok(text.startsWith('WINDOW MANAGER'));
});

/* ---- a pane that cannot be drawn ---------------------------------------- */

/* A reader draws its own details pane, and a dump it half understands can
   throw there as easily as it can while parsing. The pane says so; the other
   two panes are still the dump. */
test('a details pane that throws does not take the list with it', async () => {
  const page = openPage();
  await page.load(fixture('window-sample.txt'), null, 'windows.txt');
  page.open(page.docs()[0]);

  assert.ok(page.rows().includes('NavigationBar'), 'the list drew to start with');

  page.TOOLS.find(t => t.id === 'window').detail
    = () => { throw new Error('this window is a shape I do not know'); };
  page.select(page.S.data.nodes[0].hash);

  assert.match(page.detail(), /could not draw the details/, 'the pane says what happened');
  assert.ok(page.rows().includes('NavigationBar'), 'and the list is still the dump');
});
