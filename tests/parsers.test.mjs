/* The behaviour the parse layer is supposed to have, written out one claim at
 * a time. The golden files next door catch drift; these say what the drift
 * would be away from, and they cover the cases the source comments call out as
 * the ones a build has already broken once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseWindowDump, parseSurfaceFlingerDump, parsePackageDump, parseAnrDump,
  indentOf, deriveFrame, shortType, sfFlagNames, anrLock, TYPE_INTS,
} from '../tools/parse-layer.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(dir(p), 'utf8');

/* ---------------- small helpers ---------------- */

test('shortType drops the prefix dumpsys prints and the constant carries', () => {
  assert.equal(shortType('TYPE_STATUS_BAR'), 'STATUS_BAR');
  assert.equal(shortType('BASE_APPLICATION'), 'BASE_APPLICATION');
  assert.equal(shortType(null), '—');
  assert.equal(shortType(''), '—');
});

test('TYPE_INTS covers the ints the SurfaceFlinger HWC table prints', () => {
  // the HWC table only ever prints the int, so these have to resolve
  assert.equal(TYPE_INTS[1], 'BASE_APPLICATION');
  assert.equal(TYPE_INTS[2000], 'STATUS_BAR');
  assert.equal(TYPE_INTS[2013], 'WALLPAPER');
  assert.equal(TYPE_INTS[2019], 'NAVIGATION_BAR');
});

test('indentOf counts leading whitespace', () => {
  assert.equal(indentOf('x'), 0);
  assert.equal(indentOf('    x'), 4);
  assert.equal(indentOf(''), 0);
});

/* ---------------- geometry recovery ---------------- */

/* A window that printed no frame still has one, because mAttrs says where it
   asked to go and the display says how big the screen is. Gravity is printed
   with its component bits, so an explicit edge has to beat the centre bit it
   contains. */
test('deriveFrame places a window by gravity when no frame was printed', () => {
  const disp = { size: { w: 1080, h: 2340 } };
  const at = (attrs, gravity) =>
    deriveFrame({ attrs, gravity, requested: null }, disp);

  assert.deepEqual(at('(0,0)(fillx132)', 'BOTTOM'),
    { l: 0, t: 2208, r: 1080, b: 2340 }, 'a bottom bar sits on the bottom edge');
  assert.deepEqual(at('(0,0)(fillx130)', 'TOP'),
    { l: 0, t: 0, r: 1080, b: 130 }, 'a top bar sits on the top edge');
  assert.deepEqual(at('(0,0)(fillxfill)', 'CENTER'),
    { l: 0, t: 0, r: 1080, b: 2340 }, 'fill by fill is the whole display');
  assert.deepEqual(at('(0,0)(400x200)', 'CENTER'),
    { l: 340, t: 1070, r: 740, b: 1270 }, 'a centred window is centred');
  assert.deepEqual(at('(0,0)(400x200)', 'BOTTOM CENTER_HORIZONTAL'),
    { l: 340, t: 2140, r: 740, b: 2340 }, 'an explicit edge beats the centre bit');
  assert.deepEqual(at('(0,0)(400x200)', 'RIGHT TOP'),
    { l: 680, t: 0, r: 1080, b: 200 }, 'RIGHT measures back from the right edge');
});

test('deriveFrame gives up rather than guessing', () => {
  assert.equal(deriveFrame({ attrs: '(0,0)(fillx132)' }, null), null,
    'no display means no size to place against');
  assert.equal(deriveFrame({ attrs: '', gravity: '' }, { size: { w: 1080, h: 2340 } }), null,
    'no mAttrs spec means nothing to place');
});

/* ---------------- windows ---------------- */

test('the window sample parses to the stack it describes', () => {
  const s = parseWindowDump(read('fixtures/window-sample.txt'));
  assert.ok(s.ok);
  assert.equal(s.displays.length, 1);

  const byTitle = (t) => s.nodes.find((n) => n.title.includes(t));

  const nav = byTitle('NavigationBar0');
  assert.deepEqual(nav.frame, { l: 0, t: 2208, r: 1080, b: 2340 });
  assert.equal(nav.typeLabel, 'NAVIGATION_BAR');
  assert.equal(nav.visible, true);

  const ime = byTitle('InputMethod');
  assert.equal(ime.visible, false, 'the IME in the sample is not showing');

  const exiting = byTitle('SplashActivity');
  assert.equal(exiting.exiting, true, 'a window marked EXITING is marked exiting');
  assert.equal(exiting.visible, false);

  // z order runs bottom-up in the dump and the scene sorts it topmost-first
  const zs = s.displays[0].nodes.map((n) => n.z);
  assert.deepEqual([...zs].sort((a, b) => b - a), zs, 'nodes come back in z order');

  assert.match(s.globals.focus, /com\.example\.player/);
});

test('every node belongs to exactly one display', () => {
  const s = parseWindowDump(read('fixtures/window-sample.txt'));
  for (const d of s.displays) {
    assert.equal(typeof d.id, 'number');
    assert.ok(d.nodes.length > 0, `display ${d.id} came back with no windows`);
  }
  // the flat list is the union of the displays, so nothing is dropped or doubled
  assert.equal(s.nodes.length,
    s.displays.reduce((n, d) => n + d.nodes.length, 0));
});

/* ---------------- SurfaceFlinger ---------------- */

test('sfFlagNames names the bits it knows and keeps the rest', () => {
  assert.deepEqual(sfFlagNames('1'), ['HIDDEN']);
  assert.deepEqual(sfFlagNames('201'), ['HIDDEN', 'DISPLAY_DECORATION']);
  assert.deepEqual(sfFlagNames('0'), [], 'no bits set is no flags');
  assert.deepEqual(sfFlagNames(''), []);
  // a flag from a build newer than the table still shows up, as hex
  assert.deepEqual(sfFlagNames('800'), ['0x800']);
  assert.deepEqual(sfFlagNames('802'), ['OPAQUE', '0x800']);
});

test('the SurfaceFlinger sample parses to the layer tree it describes', () => {
  const s = parseSurfaceFlingerDump(read('fixtures/sf-sample.txt'));
  assert.ok(s.ok);
  assert.equal(s.displays.length, 1);

  const byTitle = (t) => s.nodes.find((n) => n.title.includes(t));

  const popup = byTitle('PopupWindow');
  assert.deepEqual(popup.frame, { l: 120, t: 640, r: 960, b: 1160 });
  assert.ok(popup.parentHash, 'the popup hangs off the activity it belongs to');

  const ime = byTitle('InputMethod');
  assert.equal(ime.visible, false, 'a layer with an empty visible region is not showing');

  // the HWC table is joined onto the layers by name
  const d = s.displays[0];
  assert.ok(d.hwc && d.hwc.rows.length, 'the HWC rows were read');
  const activity = byTitle('MainActivity');
  assert.equal(activity.focused, true, 'the [*] in the HWC table marks the focused layer');
});

/* ---------------- packages ---------------- */

test('the package sample splits on Android user and shares uids', () => {
  const s = parsePackageDump(read('fixtures/package-sample.txt'));
  assert.ok(s.ok);
  assert.deepEqual(s.displays.map((d) => d.id), [0, 10], 'one group per Android user');

  const u0 = s.displays[0];
  const shop = u0.nodes.find((n) => n.title === 'com.example.shop');
  assert.equal(shop.family, 'pkg-app');
  assert.equal(shop.installed, true);

  // a shared uid becomes the parent of everything running under it
  const shared = u0.nodes.find((n) => n.title === 'android.uid.systemui');
  assert.ok(shared, 'the shared uid got a row of its own');
  const sysui = u0.nodes.find((n) => n.title === 'com.android.systemui');
  assert.equal(sysui.parentHash, shared.hash);

  // every family the tool colours is reachable from this fixture
  assert.deepEqual([...new Set(s.nodes.map((n) => n.family))].sort(),
    ['pkg-apex', 'pkg-app', 'pkg-priv', 'pkg-shared', 'pkg-system', 'pkg-updated']);
});

/* dumpsys prints a package's overlay paths through a printer that has lost its
   indent, so a line lands at column zero in the middle of `Packages:`. Reading
   it as the end of the section costs every package after it. */
test('a stray column-zero line does not end the Packages section', () => {
  const s = parsePackageDump(read('fixtures/package-sample.txt'));
  const names = s.nodes.map((n) => n.title);
  assert.ok(names.includes('com.android.settings'),
    'the packages printed after the stray overlay-paths line survived');
  assert.ok(names.includes('com.android.media.swcodec'));
});

test('a package an update replaced is badged shadowed, not lost', () => {
  const s = parsePackageDump(read('fixtures/package-sample.txt'));
  const settings = s.displays[0].nodes.filter((n) => n.title === 'com.android.settings');
  assert.equal(settings.length, 2, 'printed once under Packages and once under Hidden');
  const badged = settings.filter((n) => n.badges.some(([l]) => l === 'shadowed'));
  assert.equal(badged.length, 1, 'exactly the hidden one is badged');
});

test('per-user state is read per user, not off the package', () => {
  const s = parsePackageDump(read('fixtures/package-sample.txt'));
  const shopIn = (uid) =>
    s.displays.find((d) => d.id === uid).nodes.find((n) => n.title === 'com.example.shop');

  assert.deepEqual(shopIn(0).badges.map(([l]) => l), [],
    'the shop is ordinary under the owner');
  assert.deepEqual(shopIn(10).badges.map(([l]) => l), ['disabled by user', 'stopped'],
    'and disabled and stopped under the work profile');
});

/* ---------------- ANR traces ---------------- */

test('anrLock reads the four shapes a monitor line comes in', () => {
  const held = anrLock('- waiting to lock <0x0e2b8f8f> (a com.example.Foo) held by thread 12');
  assert.equal(held.kind, 'waiting-to-lock');
  assert.equal(held.addr, '0x0e2b8f8f');
  assert.equal(held.klass, 'com.example.Foo');
  assert.equal(held.heldByTid, 12);

  const owned = anrLock('- locked <0x1a4f2201> (a com.example.Bar)');
  assert.equal(owned.kind, 'locked');
  assert.equal(owned.heldByTid, null, 'a lock you hold is held by nobody else');

  assert.equal(anrLock('  at com.example.Foo.bar(Foo.java:1)'), null,
    'a stack frame is not a lock line');
});

test('the ANR sample finds the chain that blocks main', () => {
  const s = parseAnrDump(read('fixtures/anr-sample.txt'));
  assert.ok(s.ok);
  assert.equal(s.displays.length, 1, 'one process in the sample');

  const d = s.displays[0];
  assert.equal(d.analysis.main.name, 'main');
  assert.equal(d.analysis.mainIdle, false, 'main is blocked, not idle');

  // main (1) waits on Worker-3 (12), which waits on DB-writer (7)
  assert.deepEqual(d.graph.chain, [1, 12, 7]);
  assert.deepEqual(d.graph.cycles, [], 'the sample is a chain, not a deadlock');

  const main = s.nodes.find((n) => n.title === 'main');
  assert.ok(main.badges.some(([l]) => l === 'blocked'));
});

test('thread pools collapse into one row that stands in for its members', () => {
  const s = parseAnrDump(read('fixtures/anr-sample.txt'));
  const pools = s.nodes.filter((n) => n.pool);
  assert.equal(pools.length, 2, 'the Binder pool and the executor pool');

  const binder = pools.find((n) => n.title.includes('Binder'));
  assert.equal(binder.members.length, 4);
  // `members` are the member rows themselves, and each hangs off the pool
  for (const m of binder.members) {
    assert.equal(m.parentHash, binder.hash, `${m.title} does not hang off its pool`);
  }
  assert.equal(s.nodes.filter((n) => n.parentHash === binder.hash).length, 4);

  // the flat node list is the pools plus every thread, so nothing is dropped
  assert.equal(s.nodes.length, pools.length + s.globals.threads);
});

/* A bugreport dumps some processes in ART's format and some in the native one,
   where thread names come from the kernel's comm field truncated to fifteen
   characters. Everything below is about telling those two apart. */

test('a Java process dumped in the native format still finds its main thread', () => {
  const s = parseAnrDump(read('fixtures/anr-native-sample.txt'));
  const app = s.displays.find((d) => d.proc.name === 'com.example.messaging');

  assert.equal(app.proc.runtime, 'art', 'ART daemon threads give the runtime away');
  assert.ok(app.analysis.main, 'the main thread was found');
  assert.equal(app.analysis.main.name, 'ample.messaging',
    'comm truncated the name, so it is not "main" and cannot be found by name');
  assert.equal(app.analysis.main.sysTid, app.proc.pid,
    'what identifies it is that its sysTid is the pid');
});

test('a native daemon is not reported as missing a main thread', () => {
  const s = parseAnrDump(read('fixtures/anr-native-sample.txt'));
  const daemon = s.displays.find((d) => d.proc.name === '/system/bin/exampleserver');

  assert.equal(daemon.proc.runtime, 'native');
  assert.equal(daemon.analysis.main, null, 'it has no main thread, which is correct');
  assert.deepEqual(daemon.analysis.findings, [],
    'and that is not a finding: it would fire on most processes in a bugreport');

  // its first thread has the pid for a sysTid, so the fallback must not fire here
  const first = daemon.proc.threads.find((t) => t.sysTid === daemon.proc.pid);
  assert.ok(first, 'the thread the fallback would have taken exists');
  assert.equal(first.isMain, false, 'and was deliberately not taken');
});

test('an ART process genuinely missing main is still reported', () => {
  // no thread named main, no thread with the pid for a sysTid, but ART is running
  const cut = read('fixtures/anr-native-sample.txt')
    .replace('"ample.messaging" sysTid=6907', '"some-worker" sysTid=6999');
  const s = parseAnrDump(cut);
  const app = s.displays.find((d) => d.proc.name === 'com.example.messaging');

  assert.equal(app.proc.runtime, 'art');
  assert.equal(app.analysis.main, null);
  assert.deepEqual(app.analysis.findings.map((f) => f.title),
    ['No main thread in this process'],
    'suppressing the finding for native processes must not suppress it here');
});
