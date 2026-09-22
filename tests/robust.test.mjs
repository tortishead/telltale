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
  parseWindowDump, parseUserDump, parseOverlayDump, parseCarServiceDump, parseInputDump,
  parseLogcatDump, parsePackageDump, parseAnrDump, parseSurfaceFlingerDump,
  parseBinderCallsStatsDump, parseInputDevicesDump,
} from '../tools/parse-layer.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (name) => readFileSync(dir(`fixtures/${name}`), 'utf8');
const zipBytes = readFileSync(dir('fixtures/bugreport-sample.zip'));

const PARSERS = {
  window: parseWindowDump, sf: parseSurfaceFlingerDump, package: parsePackageDump,
  anr: parseAnrDump, car: parseCarServiceDump, user: parseUserDump,
  overlay: parseOverlayDump,
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

/* ---- a modern dump inside a modern bugreport ---------------------------- */

/* Android 16 prints SurfaceFlinger into a bugreport under a `DUMP OF SERVICE`
   heading rather than the old banner, and the new frontend's own lists start
   at column zero the way a heading does. Both readers have to come out of one
   file with their own section and nothing of the other's. */
test('an Android 16 SurfaceFlinger section opens alongside the window one', async () => {
  const page = openPage();
  const text = [
    'Bugreport format version: 2.0',
    '',
    '------ DUMPSYS CRITICAL (/system/bin/dumpsys) ------',
    '-'.repeat(79),
    'DUMP OF SERVICE CRITICAL SurfaceFlinger:',
    fixture('sf-a16-sample.txt'),
    '--------- 0.5s was the duration of dumpsys SurfaceFlinger',
    '-'.repeat(79),
    'DUMP OF SERVICE window:',
    fixture('window-sample.txt'),
  ].join('\n');

  await page.load(text, null, 'bugreport.txt');
  const found = new Map(page.docs().map(d => [d.found[0].tool.id, d.found[0].scene]));
  assert.equal(found.get('sf').nodes.length, 80, 'every layer the hierarchy holds');
  assert.ok(found.get('window').nodes.length, 'and the window dump under it');
  assert.ok(!found.get('window').nodes.some(n => /#\d+$/.test(n.title)),
    'with no layer read as a window');
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

/* ---------------- a touch trace ---------------- */

/* The trace reader is the one that is handed something a bugreport never
   contains, and the one whose drawing is not the drawing every other tool
   gets. Both halves are worth a test: that it does not turn up on a dump that
   merely names the same axes, and that its sheet, its clock and its mapping
   onto somebody else's display all survive contact with a real capture.
 */

const capture = () => readFileSync(dir('fixtures/getevent-sample.txt'), 'utf8');

test('a getevent capture opens one tab, and no other reader claims it', async () => {
  const page = openPage();
  await page.load(capture(), null, 'touch.txt');
  assert.deepEqual(page.docs().map((d) => d.found[0].tool.id), ['getevent']);
});

/* The same, for the capture with no node in front of its events: that form is
   what `getevent -lt /dev/input/event2` prints, and it has to reach the trace
   reader on the strength of the event lines alone. */
test('a capture taken with a device argument opens the trace reader too', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/getevent-bare-sample.txt'), 'utf8'),
                  null, 'touch.txt');
  assert.deepEqual(page.docs().map((d) => d.found[0].tool.id), ['getevent']);
});

/* `dumpsys input` prints `ABS_MT_POSITION_X` in the reader's motion ranges. A
   detect built on the axis names rather than on the shape of an event line
   would open a trace tab on every bugreport. */
test('a dump that names the same axes is not read as a capture', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/input-sample.txt'), 'utf8'), null, 'input.txt');
  assert.ok(!page.docs().some((d) => d.found[0].tool.id === 'getevent'));
});

test('the trace draws a path for every stroke and marks where each finger landed', async () => {
  const page = openPage();
  await page.load(capture(), null, 'touch.txt');
  page.display(2);
  const svg = page.sheet();
  assert.equal((svg.match(/class="gev-path"/g) || []).length, 5, 'one path per stroke');
  assert.equal((svg.match(/class="gev-down"/g) || []).length, 5, 'and one dot where it went down');
  /* The playhead's own elements are in the drawing from the start, empty, so
     playing moves them instead of rebuilding the sheet. */
  assert.ok(svg.includes('data-live='), 'the live half of each path is there to fill in');
});

/* A device that only ever reported keys has no panel, and must say that rather
   than draw a screen nobody measured. */
test('a device with no positions says so instead of drawing a panel', async () => {
  const page = openPage();
  await page.load(capture(), null, 'touch.txt');
  page.display(0);
  assert.match(page.sheet(), /Nothing on event0 reported a position/);
});

test('a trace with another dump on the desk can be drawn over its display', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/window-sample.txt'), 'utf8'), null, 'window.txt');
  await page.load(capture(), null, 'touch.txt');

  const trace = page.docs().find((d) => d.found[0].tool.id === 'getevent');
  const windows = page.docs().find((d) => d.found[0].tool.id === 'window');
  page.open(trace);
  page.display(2);

  /* Nothing is borrowed until it is asked for: a trace opens in its own units. */
  assert.ok(!page.sheet().includes('gev-under'));

  page.S.mapTo = `${windows.id}:window:0`;
  const over = page.sheet();
  assert.ok(over.includes('gev-under'), "the other dump's windows are drawn under the strokes");

  page.select('gev:2:s0');
  const detail = page.detail();
  assert.match(detail, /What it landed on/);
  assert.match(detail, /com\.example\.player/,
    'and the tap is named by the window it came down in');
});

/* Which way round a panel is mounted against the display it drives is the one
   thing the trace reader has always had to be told by hand. `dumpsys display`
   states it, so a capture played over one of its displays is turned by what
   the device said rather than by what somebody guessed. */
test('a display that says how its panel is mounted turns the trace by it', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/display-sample.txt'), 'utf8'), null, 'display.txt');
  assert.equal(page.attach(capture()), null, 'the capture was taken');

  const trace = page.S.trace;
  const tap = trace.nodes.find((n) => n.kind === 'tap');
  /* The sheet is what fixes the projection the playhead then writes into, so
     it is drawn again after anything that could change it — which is what the
     page does for itself when the turn or the display changes. */
  const path = () => {
    page.sheet();
    return page.playhead(trace.globals.span).find((f) => f.hash === tap.hash).d;
  };

  /* The built-in panel is mounted the same way up as its display, so nothing
     is turned and the pane says as much. */
  page.display(0);
  page.select(null);
  assert.match(page.detail(), /installOrientation/);
  assert.match(page.detail(), /turned by the\s+<b>0°<\/b>/);

  /* The HDMI screen's own dump says a quarter turn, and the strokes take it. */
  page.display(2);
  page.select(null);
  assert.match(page.detail(), /turned by the\s+<b>90°<\/b>/);
  const turned = path();
  page.S.mapTurn = 0;
  assert.notEqual(turned, path(), 'the stated turn is the one being drawn with');
  page.S.mapTurn = null;
  assert.equal(turned, path(), 'and putting the override back gives the stated one again');

  /* And the pane says the stated turn is still only a default. */
  page.select(null);
  assert.match(page.detail(), /The\s+button beside the clock still overrides it/);
});

/* Every other reader's display states no such thing, and the pane goes on
   saying the scaling is an assumption rather than claiming a fact. */
test('a display from a reader that states no mounting is still an assumption', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/window-sample.txt'), 'utf8'), null, 'window.txt');
  assert.equal(page.attach(capture()), null);
  page.select(null);
  assert.match(page.detail(), /this reader's assumption/);
});

test('the playhead moves without the sheet being rebuilt', async () => {
  const page = openPage();
  await page.load(capture(), null, 'touch.txt');
  page.display(2);
  const before = page.sheet();
  page.S.playAt = 2.5;
  assert.equal(page.els.get('sheet').innerHTML, before,
    'scrubbing is not a redraw; the same SVG is still in the pane');
});

/* The clock is the reason this reader exists rather than a list of events, so
   what it says at a moment is worth pinning down: nothing before a stroke
   started, the whole of it after it ended, and a finger on screen only while
   that finger was actually down. */
test('the playhead draws each stroke only over the span it happened in', async () => {
  const page = openPage();
  await page.load(capture(), null, 'touch.txt');
  page.display(2);
  page.sheet();

  const tap = page.docs()[0].found[0].scene.nodes.find((n) => n.kind === 'tap');
  const span = page.docs()[0].found[0].scene.globals;
  const rel = (t) => t - span.start;
  const frameOf = (t, hash) => page.playhead(t).find((f) => f.hash === hash);

  assert.equal(frameOf(0, tap.hash).d, '', 'nothing has been drawn at zero');
  assert.equal(frameOf(0, tap.hash).tip, null, 'and no finger is down');

  const mid = frameOf(rel((tap.start + tap.end) / 2), tap.hash);
  assert.ok(mid.d.startsWith('M'), 'part way through, part of the path is there');
  assert.ok(mid.tip, 'and the finger is on screen');

  const after = frameOf(rel(tap.end) + 0.5, tap.hash);
  assert.ok(after.d.startsWith('M'), 'after it ended the whole path stays');
  assert.equal(after.tip, null, 'but the finger has gone');
});

test('a stroke is drawn where the display it is mapped onto puts it', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/window-sample.txt'), 'utf8'), null, 'window.txt');
  await page.load(capture(), null, 'touch.txt');
  const trace = page.docs().find((d) => d.found[0].tool.id === 'getevent');
  const windows = page.docs().find((d) => d.found[0].tool.id === 'window');
  page.open(trace);
  page.display(2);

  const tap = trace.found[0].scene.nodes.find((n) => n.kind === 'tap');
  const at = (hash) => page.playhead(trace.found[0].scene.globals.span).find((f) => f.hash === hash);
  const own = at(tap.hash).d.match(/M([\d.]+) ([\d.]+)/);

  page.S.mapTo = `${windows.id}:window:0`;
  page.sheet();
  const over = at(tap.hash).d.match(/M([\d.]+) ([\d.]+)/);

  const panel = trace.found[0].scene.displays.find((d) => d.id === 2);
  const display = windows.found[0].scene.displays.find((d) => d.id === 0);
  /* In its own units the point is the point; over a display it is that point
     scaled by the ratio between the two, and nothing else. */
  assert.equal(Math.round(+own[1]), Math.round(tap.samples[0].x));
  assert.equal(Math.round(+over[1]),
    Math.round(tap.samples[0].x / panel.size.w * display.size.w));
  assert.equal(Math.round(+over[2]),
    Math.round(tap.samples[0].y / panel.size.h * display.size.h));
});

/* A panel mounted at 90° to its display is the normal case on a tablet, and
   nothing in either dump states it, so the turn is the reader's to offer. */
test('turning the panel against the display turns the strokes with it', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/window-sample.txt'), 'utf8'), null, 'window.txt');
  await page.load(capture(), null, 'touch.txt');
  const trace = page.docs().find((d) => d.found[0].tool.id === 'getevent');
  const windows = page.docs().find((d) => d.found[0].tool.id === 'window');
  page.open(trace);
  page.display(2);
  page.S.mapTo = `${windows.id}:window:0`;

  const tap = trace.found[0].scene.nodes.find((n) => n.kind === 'tap');
  const point = () => page.playhead(trace.found[0].scene.globals.span)
    .find((f) => f.hash === tap.hash).d.match(/M([\d.]+) ([\d.]+)/).slice(1).map(Number);

  const [x0, y0] = point();
  page.S.mapTurn = 180;
  const [x2, y2] = point();
  const display = windows.found[0].scene.displays.find((d) => d.id === 0);
  assert.ok(Math.abs((x0 + x2) - display.size.w) < 1, 'half a turn mirrors x');
  assert.ok(Math.abs((y0 + y2) - display.size.h) < 1, 'and y');
});

/* `event0` is the volume rocker on half the phones ever made and sorts first
   by number. What a touch trace is about is the panel. */
test('a trace opens on the device that reported positions, not on the first one', async () => {
  const page = openPage();
  await page.load(capture(), null, 'touch.txt');
  assert.equal(page.S.displayId, 2);
});

/* ---------------- a capture pasted onto a layout ---------------- */

/* The other direction: not a capture that borrows a display, but a window dump
   that is handed a capture and plays it over its own windows. It is the same
   drawing and the same clock reached from the other end, so what is worth
   testing is that the two ends really do meet — and that the layout underneath
   is still the thing being read.
 */

test('a window dump takes a pasted capture and plays it over its own windows', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/window-sample.txt'), 'utf8'), null, 'window.txt');

  assert.equal(page.stage(), null, 'nothing is playing until something is pasted');
  assert.equal(page.attach(capture()), null, 'and a real capture is taken without complaint');

  const stage = page.stage();
  assert.equal(stage.own, false, 'the capture is the guest here, not the subject');
  assert.equal(stage.dev.label, 'event2', 'played off the device that reported positions');
  assert.equal(stage.display.id, 0, 'over the display this dump is showing');

  const plan = page.sheet('plan');
  assert.ok(plan.includes('gev-over'), 'the trace is drawn over the layout');
  assert.equal((plan.match(/class="gev-path"/g) || []).length, 5);
  /* The dump underneath is still a window dump: its windows are still there
     and still the things that take a click. */
  assert.ok(plan.includes('class="pw-fill"'));
  assert.ok(!plan.includes('data-hash="gev:'),
    'and no stroke is a hit target of its own: the window under it takes the click');
});

test('text that is not a capture is refused in words, and changes nothing', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/window-sample.txt'), 'utf8'), null, 'window.txt');
  const bad = page.attach('WINDOW MANAGER WINDOWS (dumpsys window windows)\nnothing here');
  assert.match(bad, /getevent/);
  assert.equal(page.stage(), null);
});

test('taking the capture off puts the dump back the way it was', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/window-sample.txt'), 'utf8'), null, 'window.txt');
  const before = page.sheet('plan');
  page.attach(capture());
  assert.notEqual(page.sheet('plan'), before);
  page.detach();
  assert.equal(page.stage(), null);
  assert.equal(page.sheet('plan'), before);
});

/* The stack is the plan seen from the side, so a trace laid on it has to go
   through the same rotation the faces did — otherwise the gesture floats over
   a drawing it is no longer on. */
test('the trace lies on the screen plane in the z-order view too', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/window-sample.txt'), 'utf8'), null, 'window.txt');
  page.attach(capture());
  const plan = page.sheet('plan');
  const depth = page.sheet('depth');
  assert.ok(depth.includes('gev-over'));
  const first = (svg) => svg.slice(svg.indexOf('gev-over')).match(/d="M([-\d.]+) ([-\d.]+)/);
  assert.notDeepEqual(first(depth).slice(1), first(plan).slice(1),
    'the same stroke is drawn at different points in the two views');
});

/* The point of putting the log on the layout rather than beside it. */
test('a selected window says which strokes came down on it, and who took them', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/input-sample.txt'), 'utf8'), 'input', 'input.txt');
  page.attach(capture());
  page.sheet('plan');

  const scene = page.docs()[0].found[0].scene;
  const overlay = scene.nodes.find((n) => n.title.includes('tracker.Overlay'));
  const ime = scene.nodes.find((n) => n.title === 'InputMethod');

  page.select(overlay.hash);
  const onOverlay = page.detail();
  assert.match(onOverlay, /Touches on this window/);
  assert.match(onOverlay, /this one/, 'the overlay takes what lands on it');

  /* Two strokes came down inside the IME's frame, and the overlay above it is
     what would actually have got them. */
  page.select(ime.hash);
  const onIme = page.detail();
  assert.match(onIme, /taken by/);
  assert.match(onIme, /tracker\.Overlay/);
});

test('a window nothing landed on says so rather than showing an empty list', async () => {
  const page = openPage();
  await page.load(readFileSync(dir('fixtures/input-sample.txt'), 'utf8'), 'input', 'input.txt');
  page.attach(capture());
  page.sheet('plan');
  const bar = page.docs()[0].found[0].scene.nodes.find((n) => n.title === 'StatusBar');
  page.select(bar.hash);
  assert.match(page.detail(), /No finger in the capture came down/);
});
