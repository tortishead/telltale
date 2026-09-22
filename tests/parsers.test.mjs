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
  parseCarServiceDump, parseUserDump, parseOverlayDump,
  indentOf, deriveFrame, shortType, sfFlagNames, anrLock,
  carHeadName, carPairs, lineFields, blockRuns, blockEntries, carPropNames,
  userFlagNames, userListUnder, overlayFields, overlayStateLabel, TYPE_INTS,
  parseBinderCallsStatsDump,
  binderCaller, binderCall, binderTxn, binderTime, binderBytes,
  parseInputDump, parseInputDevicesDump,
  inputSources, inputWindowName, inputRegion, inputConfigOf, inputViewports,
  parseLogcatDump, logKeep, logLevel,
  parseGeteventCapture, gevSigned, gevTracks,
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

/* Android 15 gave SurfaceFlinger a new frontend, and Android 16 is the first
   release that prints nothing else: no layer list and no composition blocks,
   but a one-line snapshot per drawn layer, another per layer input knows
   about, and a tree with every layer there is in it. */
test('an Android 16 dump reads every layer, not just the ones that were drawn', () => {
  const s = parseSurfaceFlingerDump(read('fixtures/sf-a16-sample.txt'));
  assert.ok(s.ok);
  assert.equal(s.nodes.length, 80, 'as many layers as the dump says it has');
  assert.equal(s.globals.activeLayers, '80');
  assert.equal(s.globals.frontend, 'new');
  assert.equal(s.displays.length, 1);
  assert.equal(s.displays[0].hwc.rows.length, 5,
    'the HWC table is found through the header the quarterly release prints');
});

test('a new frontend layer is read out of its one line', () => {
  const s = parseSurfaceFlingerDump(read('fixtures/sf-a16-sample.txt'));
  const bar = s.nodes.find((n) => n.title === 'StatusBar#83');

  // the dump prints this one `bounds={0,0,63,1080}`: left, top, bottom, right
  assert.deepEqual(bar.rects.bounds, { l: 0, t: 0, r: 1080, b: 63 });
  assert.deepEqual(bar.frame, { l: 0, t: 0, r: 1080, b: 63 });
  assert.equal(bar.winType, 'STATUS_BAR', 'the HWC table still names the window type');
  assert.equal(bar.comp, 'DEVICE');
  assert.equal(bar.visible, true);
  assert.equal(bar.bufferId, '4617089843202');
  assert.equal(bar.frameNumber, 7);
  assert.deepEqual(bar.inputFlags, ['NOT_FOCUSABLE', 'TRUSTED_OVERLAY']);
  assert.deepEqual(bar.touchable, { l: 0, t: 0, r: 1080, b: 63 });
  assert.equal(bar.pid, 1075);
  assert.equal(bar.uid, 10194);
});

test('a layer the new frontend did not draw says so, and why', () => {
  const s = parseSurfaceFlingerDump(read('fixtures/sf-a16-sample.txt'));
  const spy = s.nodes.find((n) => n.title === 'PointerEventDispatcherOverlay0#40');
  assert.equal(spy.visible, false);
  assert.equal(spy.reason, 'nothing to draw');
  assert.ok(spy.inputFlags.includes('SPY'), 'it is still in the input list');
});

test('the hierarchy is where parentage, the owner and the offscreen layers come from', () => {
  const s = parseSurfaceFlingerDump(read('fixtures/sf-a16-sample.txt'));
  const app = s.nodes.find((n) => n.title.endsWith('NexusLauncherActivity#105'));
  assert.equal(app.pid, 1370);
  assert.ok(app.ancestors.some((a) => a.title === 'Task=6#52'),
    'the task it is in is on its parent chain, elided name and all');

  /* The hierarchy elides the middle of a long name and the composition list
     does not; they are joined on the layer id either way. */
  const record = s.nodes.find((n) => n.title.includes('ActivityRecord{'));
  assert.ok(record.title.includes('[...]'));
  assert.ok(record.childCount >= 1);

  const shade = s.nodes.find((n) => n.title === 'NotificationShade#85');
  assert.equal(shade.offscreen, true, 'a layer off every display is kept');
  assert.equal(shade.frame, null, 'and has nowhere to be drawn');
  assert.deepEqual(shade.badges.map(([l]) => l), ['offscreen']);
});

/* Which way round the lists are printed changed between Android 16 and its
   first quarterly release. The header says which, and a dump with no
   hierarchy in it — a bugreport section cut short — has nothing else. */
test('the composition list is read in the direction its header states', () => {
  const dump = (dir) =>
    'Build configuration: [sf]\n\nActive Layers - layers with client handles (count = 2)\n\n' +
    `Composition list (${dir})\nLayerStack=0\n` +
    '  Layer [1] Back#1\n    visible reason= buffer=1 frame=1\n    bounds={0,0,100,100}\n' +
    '  Layer [2] Front#2\n    visible reason= buffer=2 frame=1\n    bounds={0,0,100,100}\n';
  const topmost = (dir) => parseSurfaceFlingerDump(dump(dir)).displays[0].nodes[0].title;
  assert.equal(topmost('bottom to top'), 'Front#2');
  assert.equal(topmost('top to bottom'), 'Back#1');
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

/* ---------------- car_service ---------------- */

test('carHeadName reads every shape a car_service heading comes in', () => {
  // the plain one, and the one with spaces inside the stars
  assert.deepEqual(carHeadName('CarFeatureController*'), { name: 'CarFeatureController', trail: '' });
  assert.deepEqual(carHeadName('CarBluetoothService *'), { name: 'CarBluetoothService', trail: '' });
  // the service dumper's own heading, which names the service and says `dump`
  assert.deepEqual(carHeadName('CarOemProxyService dump***'),
    { name: 'CarOemProxyService', trail: '' });
  // a heading that never closes its stars
  assert.deepEqual(carHeadName('Display:1'), { name: 'Display:1', trail: '' });
  // and one the service went on printing after
  assert.deepEqual(carHeadName('CarUserNoticeService* mUserId:10'),
    { name: 'CarUserNoticeService', trail: 'mUserId:10' });
});

test('carPairs takes the key/value lines and leaves everything else', () => {
  assert.deepEqual(carPairs([
    '  mCurrentPowerPolicyId: system_power_policy_all_on',
    '  mIsPowerPolicyLocked=false',
    '  03-21 16:50:36 CarDrivingStateService Boot: changed from -1 to 0',
    '  \tat com.android.car.ICarImpl.dump(ICarImpl.java:744)',
    '',
  ]), [
    ['mCurrentPowerPolicyId', 'system_power_policy_all_on'],
    ['mIsPowerPolicyLocked', 'false'],
  ]);
});

test('a section nests under the heading above it, by stars before indent', () => {
  const s = parseCarServiceDump(read('fixtures/car-service-sample.txt'));
  const at = (title) => s.nodes.find((n) => n.title === title);
  const parentOf = (title) => {
    const n = at(title);
    const up = s.nodes.find((x) => x.hash === n.parentHash);
    return up ? up.title : null;
  };

  // the three headings that are the document's shape are not sections in it
  assert.deepEqual(s.nodes.filter((n) => /^Dump (car service|versions|all services)$/.test(n.title)), []);

  // a service prints at indent 2 with one star; the service dumper's heading
  // for CarOemProxyService prints at indent 0 with three, and both are services
  assert.equal(parentOf('CarOemProxyService'), null);
  assert.equal(parentOf('CarFeatureController'), null);

  // OccupantZoneService keeps the indent and adds a star
  assert.equal(parentOf('mDisplayConfigs'), 'OccupantZoneService');
  // Input Service adds a star per level, all at the same indent
  assert.equal(parentOf('Display:1'), 'InputCaptureClientController');
  assert.equal(parentOf('All clients:'), 'Display:1');
  // CarAudioService keeps one star and indents instead
  assert.equal(parentOf('CarZonesAudioFocus'), 'CarAudioService');
  assert.equal(parentOf('CarAudioFocus'), 'CarZonesAudioFocus');
});

test('a service that threw on its way out is badged, not silently short', () => {
  const s = parseCarServiceDump(read('fixtures/car-service-sample.txt'));
  const oem = s.nodes.find((n) => n.title === 'CarOemProxyService');

  assert.equal(oem.failed, true);
  assert.equal(oem.family, 'car-failed');
  assert.deepEqual(oem.badges, [['failed to dump', 'badge-exit']]);
  assert.deepEqual(s.globals.failed, [oem.hash],
    'and the group pane names it, because it is a hole in everything read below');
});

test('the filter reaches what a section printed, not just its name', () => {
  const s = parseCarServiceDump(read('fixtures/car-service-sample.txt'));
  const hit = s.nodes.filter((n) => n.search.includes('mcurrentdrivingstate')
    || n.search.includes('current driving state'));
  assert.deepEqual(hit.map((n) => n.title), ['CarDrivingStateService']);
});

test('versions come off the dump rather than out of a section', () => {
  const s = parseCarServiceDump(read('fixtures/car-service-sample.txt'));
  const versions = new Map(s.globals.versions);
  assert.equal(versions.get('Android SDK_INT'), '34');
  assert.match(versions.get('Car Version'), /^CarVersion\[/);
});

test('lineFields splits on the commas between fields, not the ones inside them', () => {
  const f = lineFields('event count:1, lastEvent: Property:0x11410a00, int32Values: [0, 0], string: ');
  assert.deepEqual(f, [
    ['event count', '1', ':'],
    ['lastEvent', 'Property:0x11410a00', ':'],
    ['int32Values', '[0, 0]', ':'],
    ['string', '', ':'],
  ], 'each field comes back with the separator it was written with');

  // prose is not a record, and neither is a line only part of which is one
  assert.equal(lineFields('There are 8 clients using CarPropertyService.'), null);
  assert.equal(lineFields('mCurrentState: CpmsState, and then some prose'), null);

  // a line whose fields disagree about the separator is still fields here;
  // whether that means several attributes is blockEntries' question, below
  assert.deepEqual(lineFields('mCurrentState: CpmsState canPostpone=false, CpmsState=ON(1)'),
    [['mCurrentState', 'CpmsState canPostpone=false', ':'], ['CpmsState', 'ON(1)', '=']]);
});

test('a run of lines printed to one shape becomes a table, a short run does not', () => {
  const prop = (id) => `Property:${id}, Property name:INFO_VIN, access:0x1`;
  const runs = blockRuns([
    'There are 8 clients using CarPropertyService.',
    prop('0x1'), prop('0x2'), prop('0x3'),
    'Properties changed: ',
  ]);

  assert.deepEqual(runs.map((r) => r.kind), ['text', 'table', 'text']);
  assert.deepEqual(runs[1].keys, ['Property', 'Property name', 'access']);
  assert.equal(runs[1].rows.length, 3);
  assert.deepEqual(runs[1].rows[0].cells, ['0x1', 'INFO_VIN', '0x1']);

  // two of a shape is not a table, and a one-field run is a list, not a column
  assert.deepEqual(blockRuns([prop('0x1'), prop('0x2')]).map((r) => r.kind), ['text']);
  assert.deepEqual(blockRuns([
    'propId: 0x11200402 is registered by 1 client(s).',
    'propId: 0x11200407 is registered by 1 client(s).',
    'propId: 0x11400400 is registered by 2 client(s).',
  ]).map((r) => r.kind), ['text']);
});

test('property ids are named from the two tables the dump names them in', () => {
  const s = parseCarServiceDump(read('fixtures/car-service-sample.txt'));
  const names = s.globals.propNames;

  // *All properties* prints `Property:0x…, Property name:NAME`
  assert.equal(names['0x11100100'], 'INFO_VIN');
  // *Property handlers* prints `// 0x… name: NAME`
  assert.equal(names['0x11200308'], 'FUEL_DOOR_OPEN');
  // and nothing invents a name for an id the dump never named
  assert.equal(names['0xdeadbeef'], undefined);
});

test('a section carries the lines it printed, for the pane that reads them', () => {
  const s = parseCarServiceDump(read('fixtures/car-service-sample.txt'));
  const props = s.nodes.find((n) => n.title === 'All properties');
  const runs = blockRuns(props.body);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, 'table');
  assert.deepEqual(runs[0].keys.slice(0, 2), ['Property', 'Property name']);
});

test('a line printed under a row stays with that row instead of ending the table', () => {
  const runs = blockRuns([
    '  Property:0x1, Property name:A, access:0x1',
    '  Property:0x2, Property name:B, access:0x1',
    '        areaId:0x0, f min:0.000000, i max:3',
    '  Property:0x3, Property name:C, access:0x1',
  ]);

  assert.deepEqual(runs.map((r) => r.kind), ['table'], 'the deeper line did not split it in two');
  assert.equal(runs[0].rows.length, 3);
  assert.deepEqual(runs[0].rows[1].under, ['areaId:0x0, f min:0.000000, i max:3']);
  assert.deepEqual(runs[0].rows[0].under, []);
});

test('blockEntries reads a section as the tree its indenting says it is', () => {
  const entries = blockEntries([
    '  mCurrentPowerPolicyId: system_power_policy_all_on',
    '  mIsPowerPolicyLocked=false',
    '  Power components state:',
    '    AUDIO: on',
    '    WIFI: on',
    '  Power policy groups: none',
  ]);

  assert.deepEqual(entries.map((e) => e.key), [
    'mCurrentPowerPolicyId', 'mIsPowerPolicyLocked', 'Power components state', 'Power policy groups',
  ]);
  assert.equal(entries[0].value, 'system_power_policy_all_on');
  assert.equal(entries[1].value, 'false', 'a name given its value with = splits too');
  assert.deepEqual(entries[2].children.map((c) => [c.key, c.value]), [['AUDIO', 'on'], ['WIFI', 'on']]);
  assert.deepEqual(entries[3].children, [], 'the deeper lines went to the label above them, not to this');
});

test('a line that is not a name and a value is an entry with no value', () => {
  const entries = blockEntries([
    '  Registered power policies:',
    '    system_power_policy_all_on(enabledComponents: AUDIO, CPU | disabledComponents: )',
    '  03-21 16:50:36 CarDrivingStateService Boot: changed from -1 to 0',
  ]);

  // the policy's own colon is inside its brackets, so it is not a name/value line
  assert.equal(entries[0].children.length, 1);
  assert.equal(entries[0].children[0].value, null);
  // and a log line is a line, not a name called `03-21 16`
  assert.equal(entries[1].value, null);
  assert.match(entries[1].key, /^03-21 16:50:36 /);
});

test('an entry knows the line it was printed on', () => {
  const s = parseCarServiceDump(read('fixtures/car-service-sample.txt'));
  const power = s.nodes.find((n) => n.title === 'CarPropertyService');
  const entries = blockEntries(power.body);
  const first = entries[0];

  assert.equal(power.body[first.at], power.body[0], 'at indexes into the body it came from');
  assert.equal(
    read('fixtures/car-service-sample.txt').split('\n')[power.bodyAt + first.at - 1].trim(),
    first.line,
    'and bodyAt turns that into the line of the file it is on');
});

test('several names and values on one line are several attributes', () => {
  // *Power HAL* prints all three of its answers on one line
  const entries = blockEntries(['  isPowerStateSupported:true, isDeepSleepAllowed:false, isHibernationAllowed:false']);

  assert.deepEqual(entries.map((e) => [e.key, e.value]), [
    ['isPowerStateSupported', 'true'],
    ['isDeepSleepAllowed', 'false'],
    ['isHibernationAllowed', 'false'],
  ]);
  assert.deepEqual(entries.map((e) => e.field), [0, 1, 2], 'each is addressable on its own');
});

test('a name followed by something with fields of its own stays one attribute', () => {
  // the first separator is a colon and the rest are equals: this is
  // `mCurrentState: <a CpmsState>`, not four things printed side by side
  const entries = blockEntries([
    '  mCurrentState: CpmsState canPostpone=false, carPowerStateListenerState=6, CpmsState=ON(1)',
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, 'mCurrentState');
  assert.match(entries[0].value, /^CpmsState canPostpone=false,/);
});

test('what a split line printed under it belongs to the last of its fields', () => {
  const entries = blockEntries([
    '  a:1, b:2',
    '    under: here',
  ]);

  assert.deepEqual(entries.map((e) => e.key), ['a', 'b']);
  assert.deepEqual(entries[0].children, []);
  assert.deepEqual(entries[1].children.map((c) => c.key), ['under']);
});

/* ---------------- dumpsys user ---------------- */

test('userFlagNames reads the spelling, not the int in front of it', () => {
  assert.deepEqual(userFlagNames('    Flags: 2067 (ADMIN|INITIALIZED|PRIMARY|SYSTEM)'),
    ['ADMIN', 'INITIALIZED', 'PRIMARY', 'SYSTEM']);
  assert.deepEqual(userFlagNames('    Flags: 0 ()'), []);
  assert.deepEqual(userFlagNames('    State: RUNNING_UNLOCKED'), []);
});

test('userListUnder takes the list under a label and not the label after it', () => {
  const body = [
    '    Restrictions:',
    '      no_record_audio',
    '      no_modify_accounts',
    '    Device policy restrictions:',
    '      null',
    '    Effective restrictions:',
    '      none',
  ];

  assert.deepEqual(userListUnder(body, 'Restrictions'), ['no_record_audio', 'no_modify_accounts']);
  // `null` and `none` are the dump saying there are none, not the name of one
  assert.deepEqual(userListUnder(body, 'Device policy restrictions'), []);
  assert.deepEqual(userListUnder(body, 'Effective restrictions'), []);
  assert.deepEqual(userListUnder(body, 'Not a label here'), []);
});

test('the user sample finds its users, their type and what they are barred from', () => {
  const s = parseUserDump(read('fixtures/user-sample.txt'));
  const users = s.nodes.filter((n) => n.user);

  assert.deepEqual(users.map((u) => u.userId), [0, 10]);
  assert.equal(s.globals.current, 10);

  const system = users[0];
  assert.equal(system.title, 'user 0', 'a user with no name is its id and nothing else');
  assert.equal(system.base, 'system');
  assert.equal(system.state, 'RUNNING_UNLOCKED');
  assert.deepEqual(system.flags, ['ADMIN', 'INITIALIZED', 'PRIMARY', 'SYSTEM']);
  assert.deepEqual(system.restrictions, ['no_record_audio', 'no_modify_accounts']);
  assert.deepEqual(system.badges, [['2 restricted', 'badge-comp']]);

  const driver = users[1];
  assert.equal(driver.title, 'user 10 · Driver');
  assert.equal(driver.current, true);
  assert.deepEqual(driver.badges, [['current', 'badge-focus']]);
});

test('a section holds the things printed inside it, and nothing else does', () => {
  const s = parseUserDump(read('fixtures/user-sample.txt'));
  const at = (title) => s.nodes.find((n) => n.title === title);

  assert.equal(at('Users').subCount, 2);
  assert.equal(at('user 0').parentHash, at('Users').hash);
  assert.equal(at('profile.CLONE').parentHash, at('User types (9 types)').hash);

  // a section that lists nothing is still a section, and keeps its own lines
  const props = at('Device properties');
  assert.equal(props.subCount, 0);
  assert.ok(props.body.some((l) => /Guest restrictions:/.test(l)));
});

test('a user type says what it is and whether it is switched on', () => {
  const s = parseUserDump(read('fixtures/user-sample.txt'));
  const clone = s.nodes.find((n) => n.title === 'profile.CLONE');

  assert.equal(clone.base, 'PROFILE');
  assert.equal(clone.enabled, false);
  assert.deepEqual(clone.badges, [['disabled', 'badge-exit']]);
});

test('two things printed with the same name are still two things', () => {
  // the dump prints one block per type, but a truncated one can repeat a head
  const doubled = read('fixtures/user-sample.txt').replace(
    'User types (9 types):', 'User types (9 types):\n    android.os.usertype.profile.CLONE: \n        mBaseType: PROFILE');
  const s = parseUserDump(doubled);
  const clones = s.nodes.filter((n) => n.title === 'profile.CLONE');

  assert.equal(clones.length, 2);
  assert.notEqual(clones[0].hash, clones[1].hash, 'or one of them could never be picked');
});

/* ---------------- binder_calls_stats ---------------- */

test('binderCaller splits a caller into the uid and the user it ran as', () => {
  const app = binderCaller('com.android.systemui/u0a210');
  assert.equal(app.label, 'com.android.systemui');
  assert.equal(app.user, 0);
  assert.equal(app.uid, 10210);
  assert.equal(app.shared, false);

  // the same app for the driver is a different uid, and the dump prints both
  const driver = binderCaller('shared:com.google.uid.shared/u10a198');
  assert.equal(driver.label, 'com.google.uid.shared');
  assert.equal(driver.user, 10);
  assert.equal(driver.uid, 1010198);
  assert.equal(driver.shared, true);

  // a bare number is a platform uid, and the number is not what it is called
  assert.equal(binderCaller('0').label, 'root');
  assert.equal(binderCaller('shared:android.uid.phone/1001').user, 0);
  assert.equal(binderCaller('9876').label, 'uid 9876', 'one with no name keeps its number');
});

test('binderTxn unpacks the codes that belong to binder rather than the interface', () => {
  // the dumpsys call this dump was taken with is itself a row in it
  assert.equal(binderTxn(1598311760), '_DMP');
  assert.equal(binderTxn(1599098439), '_PNG');
  assert.equal(binderTxn(1598968902), '_NTF');
  assert.equal(binderTxn(21), null, 'a method index is a method index');
});

test('binderCall reads the interface, and says so when the method is not named', () => {
  const named = binderCall('com.android.server.am.ActivityManagerService#startService');
  assert.equal(named.service, 'ActivityManagerService');
  assert.equal(named.method, 'startService');
  assert.equal(named.named, true);

  // detailed tracking off, or a method the collector could not name
  const nul = binderCall('com.android.server.pm.PackageManagerService$IPackageManagerImpl#null');
  assert.equal(nul.named, false);
  assert.equal(nul.method, null);
  assert.equal(nul.inner, 'IPackageManagerImpl', 'the impl is kept, but the service names the row');
  assert.equal(nul.title, 'PackageManagerService#?');

  assert.equal(binderCall('com.android.server.BinderCallsStatsService#1598311760').method, 'dump');
  assert.equal(binderCall('com.android.server.connectivity.NetdEventListenerService#5').method,
    'transaction 5');
});

test('the sample groups its callers by user and hangs their methods under them', () => {
  const s = parseBinderCallsStatsDump(read('fixtures/binder-sample.txt'));

  assert.deepEqual(s.displays.map((d) => d.id), [0, 10]);
  const gms = s.nodes.filter((n) => n.caller && n.title === 'com.google.uid.shared');
  assert.equal(gms.length, 2, 'the same shared uid runs once per user');
  assert.deepEqual(gms.map((n) => n.displayId), [0, 10]);

  const kids = s.nodes.filter((n) => n.parentHash === gms[0].hash);
  assert.equal(kids.length, gms[0].methods);
  assert.ok(kids.every((n) => n.displayId === 0));
});

test('the columns are read by the names the header prints, not by position', () => {
  const text = read('fixtures/binder-sample.txt');
  // a build that drops a column it used to print must not shift every number
  const dropped = text
    .replace('package/uid, worksource, call_desc', 'package/uid, call_desc')
    .replace(/^( +)(\S+?),\2,/gm, '$1$2,');
  const s = parseBinderCallsStatsDump(dropped);
  const call = s.nodes.find((n) => n.title === 'ActivityManagerService#startService');

  assert.equal(call.calls, 89);
  assert.equal(call.cpu, 13992);
});

test('a row that threw is coloured and badged for it', () => {
  const s = parseBinderCallsStatsDump(read('fixtures/binder-sample.txt'));
  const threw = s.nodes.filter((n) => n.call && n.exceptions);

  assert.equal(threw.length, 5, 'as many rows as the tally at the end counts');
  assert.equal(s.globals.threw, 5);
  assert.ok(threw.every((n) => n.family === 'binder-threw'));
  assert.deepEqual(threw[0].badges[0], ['1 threw', 'badge-focus']);
  assert.deepEqual(s.globals.exceptions,
    [[3, 'java.lang.SecurityException'], [2, 'java.lang.IllegalArgumentException']]);
});

test('the summary is what a caller totals, because the table drops rows', () => {
  const s = parseBinderCallsStatsDump(read('fixtures/binder-sample.txt'));
  const gms = s.nodes.find((n) => n.caller && n.displayId === 0
    && n.title === 'com.google.uid.shared');

  assert.equal(gms.calls, 1462, 'the summary counted every call');
  assert.ok(gms.rowsCalls < gms.calls, 'the table printed only the top of them');
  assert.equal(gms.trimmed, true);
  assert.equal(gms.pct, 23);

  // a caller under the summary's cut still has the rows it was printed on
  const system = s.nodes.find((n) => n.caller && n.title === 'android.uid.system');
  assert.equal(system.pct, null);
  assert.equal(system.calls, 8);
});

test('a caller that is only in the summary is still a caller', () => {
  // the table keeps the top 90% by cpu time; the summary below it keeps all
  const text = read('fixtures/binder-sample.txt')
    .replace(/^ {4}com\.android\.car\.carlauncher.*\n/gm, '');
  const s = parseBinderCallsStatsDump(text);
  const launcher = s.nodes.find((n) => n.title === 'com.android.car.carlauncher');

  assert.ok(launcher, 'the table dropped its rows, the summary did not drop it');
  assert.equal(launcher.methods, 0);
  assert.equal(launcher.calls, 35);
  assert.equal(launcher.trimmed, false, 'nothing was trimmed off nothing');
});

/* The two ways this dump comes back saying nothing, both of which are about
   how it was taken rather than about the device. */
test('a dump taken while charging is empty, and says which of the two it is', () => {
  // what the dump looks like when the collector never ran: the headings, the
  // column names, and no rows under any of them
  const text = [
    'Start time: 2026-09-07 00:03:19',
    'On battery time (ms): 0',
    'Sampling interval period: 1000',
    'Sharding modulo: 1',
    read('fixtures/binder-sample.txt').split('\n')[4],
    '',
    'Per-UID Summary (top 90% by cpu time) (cpu_time, % of total cpu_time, ' +
      'recorded_call_count, call_count, package/uid):',
    '',
    '  Summary: total_cpu_time=0, calls_count=0, avg_call_cpu_time=NaN',
    '',
    'Exceptions thrown (exception_count, class_name):',
    '',
  ].join('\n');
  const s = parseBinderCallsStatsDump(text);

  assert.equal(s.ok, true, 'an empty table is still this dump, and the reason is in it');
  assert.equal(s.nodes.length, 0);
  assert.equal(s.globals.recording, false);
  assert.equal(s.displays.length, 1, 'there is still a group for the pane that explains it');
});

test('a dump taken without detailed tracking says the method names are missing', () => {
  const text = read('fixtures/binder-sample.txt').replace(/#[\w$]+,false,/g, '#null,false,');
  const s = parseBinderCallsStatsDump(text);

  assert.equal(s.globals.detailed, false);
  assert.ok(s.nodes.filter((n) => n.call).every((n) => n.family === 'binder-unnamed'
    || n.family === 'binder-threw'));
  assert.equal(parseBinderCallsStatsDump(read('fixtures/binder-sample.txt')).globals.detailed, true);
});

test('the sampling interval is carried through, because it scales every time', () => {
  const text = read('fixtures/binder-sample.txt')
    .replace('Sampling interval period: 1', 'Sampling interval period: 1000');
  assert.equal(parseBinderCallsStatsDump(text).globals.sampling, 1000);
  assert.equal(parseBinderCallsStatsDump(read('fixtures/binder-sample.txt')).globals.sampling, 1);
});

test('times and sizes are read in the unit that keeps them to three figures', () => {
  assert.equal(binderTime(303), '303 µs');
  assert.equal(binderTime(33066), '33 ms');
  assert.equal(binderTime(1200), '1.2 ms');
  assert.equal(binderTime(2500000), '2.5 s');
  assert.equal(binderBytes(804), '804 B');
  assert.equal(binderBytes(67972), '66 kB');
});

test('this parser says no to every other dump it is shown', () => {
  for (const name of ['window-sample', 'sf-sample', 'sf-a16-sample', 'package-sample',
                      'anr-sample', 'car-service-sample', 'user-sample']) {
    assert.equal(parseBinderCallsStatsDump(read(`fixtures/${name}.txt`)).ok, false, name);
  }
});


/* ---------------- dumpsys overlay ---------------- */

test('overlayFields reads a name the service padded out with dots', () => {
  const f = overlayFields([
    '    mTargetPackageName.....: com.android.systemui',
    '    mTargetOverlayableName.: ',
    '    mPriority..............: 11',
  ]);

  assert.equal(f.get('mTargetPackageName'), 'com.android.systemui');
  assert.equal(f.get('mPriority'), '11');
  // a field the service printed empty is printed, and empty
  assert.equal(f.get('mTargetOverlayableName'), '');
  assert.equal(f.has('mNotPrinted'), false);
});

test('overlayStateLabel says the constant the way a person would', () => {
  assert.equal(overlayStateLabel('STATE_MISSING_TARGET'), 'missing target');
  assert.equal(overlayStateLabel('STATE_ENABLED'), 'enabled');
  assert.equal(overlayStateLabel(''), null);
});

test('the overlay sample groups its overlays under the package each is over', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt'));
  const at = (title, user) => s.nodes.find((n) => n.title === title && n.userId === user);

  assert.deepEqual(s.displays.map((d) => d.id), [0, 10], 'a display is a user');
  assert.equal(s.globals.overlays, 12);
  assert.equal(s.globals.targets, 6);

  const android = at('android', 0);
  assert.equal(android.targetNode, true);
  assert.equal(android.subCount, 4);
  assert.equal(android.enabled, 2);
  assert.equal(at('com.android.theme.color.cinnamon', 0).parentHash, android.hash);

  // the same overlay for two users is two blocks and two nodes
  const forBoth = s.nodes.filter((n) =>
    n.title === 'com.android.theme.icon_pack.rounded.android');
  assert.deepEqual(forBoth.map((n) => n.userId), [0, 10]);
  assert.notEqual(forBoth[0].hash, forBoth[1].hash);
});

test('an overlay is read for whether it is over anything, and why not', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt'));
  const at = (title) => s.nodes.find((n) => n.title === title);

  const gone = at('com.example.brand.settings');
  assert.equal(gone.on, false);
  assert.equal(gone.broken, 'no target');
  assert.equal(gone.family, 'overlay-broken');
  assert.deepEqual(gone.badges, [['no target', 'badge-exit']]);

  // enabled by the settings and still not applied: the idmap never built
  const noIdmap = at('com.android.theme.color.cinnamon');
  assert.equal(noIdmap.state, 'STATE_NO_IDMAP');
  assert.equal(noIdmap.on, false, 'the state is what came of mIsEnabled, so it wins');
  assert.equal(noIdmap.broken, 'no idmap');

  const off = at('com.android.internal.display.cutout.emulation.corner');
  assert.equal(off.broken, null, 'turned off is not broken');
  assert.deepEqual(off.badges, [['disabled', 'badge-exit']]);

  const fixed = s.nodes.find((n) => n.title === 'com.google.android.overlay.modules.android');
  assert.equal(fixed.mutable, false);
  assert.equal(fixed.on, true, 'STATE_ENABLED_IMMUTABLE is enabled');
  assert.equal(fixed.family, 'overlay-fixed');
});

/* A fabricated overlay is not a package on the device: the manager names it
   after the thing that made it, which is the one place the head line carries
   two colons rather than one. */
test('a fabricated overlay keeps the name it was registered under', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt'));
  const frro = s.nodes.find((n) => n.fabricated);

  assert.equal(frro.overlayPkg, 'com.android.systemui');
  assert.equal(frro.overlayName, 'ThemeOverlayController_accent');
  assert.equal(frro.title, 'com.android.systemui · ThemeOverlayController_accent');
  assert.equal(frro.userId, 0);
});

/* Highest priority is applied last, so it is the one whose value a resource
   ends up with — and the only one of a stack that is marked. */
test('the overlay applied last is the one marked as winning', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt'));
  const under = (target, user) => s.nodes.filter((n) =>
    n.overlay && n.target === target && n.userId === user);

  const android = under('android', 0);
  assert.deepEqual(android.map((n) => n.priority), [9, 3, 1, 0],
    'a stack is listed with the one that wins on top');
  assert.ok(android[0].badges.some((b) => b[0] === 'wins'));
  assert.equal(android.filter((n) => n.badges.some((b) => b[0] === 'wins')).length, 1);

  // one overlay applied is not a contest, so nothing is marked
  const settings = under('com.android.settings', 10);
  assert.equal(settings.length, 1);
  assert.equal(settings[0].badges.length, 0);
});

test('a block the dump never closed is still read', () => {
  const cut = read('fixtures/overlay-sample.txt')
    .split('\n').slice(0, 8).join('\n');
  const s = parseOverlayDump(cut);

  assert.equal(s.ok, true);
  assert.equal(s.nodes.filter((n) => n.overlay).length, 1);
  assert.equal(s.nodes[1].state, 'STATE_DISABLED');
});

/* ---------------- dumpsys input: the dispatcher's windows ---------------- */

test('a window name gives up its handle in either spelling', () => {
  assert.deepEqual(inputWindowName('7f31ac0 StatusBar'),
    { hash: '7f31ac0', user: null, title: 'StatusBar' });
  assert.deepEqual(inputWindowName('Window{7f31ac0 u0 StatusBar}'),
    { hash: '7f31ac0', user: 'u0', title: 'StatusBar' });
  assert.deepEqual(inputWindowName('PointerEventDispatcher0'),
    { hash: null, user: null, title: 'PointerEventDispatcher0' });
});

test('a touchable region is the rects it is made of, and empty is not none', () => {
  assert.deepEqual(inputRegion('[0,0][1080,136]'), [{ l: 0, t: 0, r: 1080, b: 136 }]);
  assert.equal(inputRegion('[0,0][960,1080]|[960,0][1920,540]').length, 2);
  assert.deepEqual(inputRegion('<empty>'), []);
  assert.deepEqual(inputRegion(undefined), []);
});

/* The older builds print three hex fields where the newer ones print one list
   of names, and every pane below reads the names. */
test('an older window line is read into the newer inputConfig names', () => {
  const old = "    0: name='Window{7f31ac0 u0 StatusBar}', displayId=0, "
    + 'visible=false, flags=0x00040018, type=0x000007d5, layer=21000, '
    + 'frame=[0,0][1080,136], scale=1.000000, touchableRegion=[0,0][1080,136], '
    + 'inputFeatures=0x00000004, ownerPid=1802, ownerUid=10045';
  const got = inputConfigOf(old);
  assert.ok(got.includes('NOT_FOCUSABLE'));
  assert.ok(got.includes('NOT_TOUCHABLE'));
  assert.ok(got.includes('WATCH_OUTSIDE_TOUCH'));
  assert.ok(got.includes('SPY'), 'inputFeatures is where a spy used to be said');
  assert.ok(got.includes('NOT_VISIBLE'), 'visible=false is the older NOT_VISIBLE');

  // and a line that states the names is taken at its word, hex or not
  assert.deepEqual(inputConfigOf("0: name='x', inputConfig=SPY | NOT_FOCUSABLE, frame=[0,0][1,1]"),
    ['SPY', 'NOT_FOCUSABLE']);
});

test('viewports are where the display sizes come from', () => {
  const v = inputViewports(read('fixtures/input-sample.txt'));
  assert.deepEqual(v.get(0).size, { w: 1080, h: 2400 });
  assert.deepEqual(v.get(2).size, { w: 1920, h: 1080 });
  assert.equal(v.get(2).type, 'EXTERNAL');
  assert.equal(v.get(0).uniqueId, 'local:4619827259835644672');
});

test('the input sample parses to the two displays it dispatches to', () => {
  const s = parseInputDump(read('fixtures/input-sample.txt'));
  assert.equal(s.ok, true);
  assert.deepEqual(s.displays.map((d) => d.id), [0, 2]);
  assert.deepEqual(s.displays.map((d) => d.size), [{ w: 1080, h: 2400 }, { w: 1920, h: 1080 }]);

  const win = (t) => s.nodes.find((n) => n.title.includes(t));
  assert.equal(win('StatusBar').touchable, true);
  assert.equal(win('ShellDropTarget').touchable, false, 'NOT_TOUCHABLE takes no touch');
  assert.equal(win('QuickstepLauncher').touchable, false, 'nor does a window with no channel');
  assert.equal(win('ImageWallpaper').family, 'input-wallpaper');
  assert.equal(win('Cluster spy').spy, true);

  // the dispatcher walks its list from the top, so index 0 is the topmost
  const d0 = s.displays[0].nodes.filter((n) => !n.monitor);
  assert.deepEqual(d0.map((n) => n.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

/* Android 16 stopped quoting the window name the dispatcher prints. A dump in
   that spelling has to read the same as one in the old spelling, or the sheet
   opens with a display and no windows on it. */
test('a window line is read with or without quotes around its name', () => {
  const bare = [
    'Input Dispatcher State:',
    '  FocusedWindows:',
    "    displayId=0, name='dc9de94 com.example/com.example.Main'",
    '  Display: 0',
    '    Windows:',
    '      0: name=PointerEventDispatcherOverlay0, id=40, displayId=0,'
      + ' inputConfig=NOT_FOCUSABLE | TRUSTED_OVERLAY | SPY, alpha=1, frame=[0,0][0,0],'
      + ' touchableRegion=[0,0][1080,2400], ownerPid=1854, ownerUid=1000,'
      + ' touchOcclusionMode=BLOCK_UNTRUSTED',
    '      1: name=dc9de94 com.example/com.example.Main, id=108, displayId=0,'
      + ' inputConfig=TRUSTED_OVERLAY, alpha=1, frame=[0,0][1080,2400],'
      + ' touchableRegion=[0,0][1080,2400], ownerPid=2786, ownerUid=1010077,'
      + ' touchOcclusionMode=BLOCK_UNTRUSTED',
  ].join('\n');

  const s = parseInputDump(bare);
  assert.equal(s.ok, true);
  const wins = s.nodes.filter((n) => !n.monitor);
  assert.deepEqual(wins.map((n) => n.index), [0, 1]);
  assert.equal(wins[0].title, 'PointerEventDispatcherOverlay0');
  assert.equal(wins[0].spy, true);
  assert.equal(wins[1].handle, 'dc9de94', 'the handle is still split off the bare name');
  assert.equal(wins[1].title, 'com.example/com.example.Main');
  assert.deepEqual(wins[1].frame, { l: 0, t: 0, r: 1080, b: 2400 });
  assert.equal(wins[1].focused, true, 'and focus still joins by that handle');
});

test('focus and the touch in progress are joined to the windows they name', () => {
  const s = parseInputDump(read('fixtures/input-sample.txt'));
  const focused = s.nodes.filter((n) => n.focused);
  assert.equal(focused.length, 2, 'one per display, and the dump states both');
  assert.ok(focused.every((n) => n.title.includes('Settings') || n.title.includes('Cluster')));
  assert.equal(s.nodes.find((n) => n.touched).title.includes('Settings'), true);
  assert.equal(s.displays[0].touch.down, true);
});

/* The answer this dump is opened for: a touch that went somewhere other than
   where it was aimed. */
test('a window whose touch area sits under another is reported covered', () => {
  const s = parseInputDump(read('fixtures/input-sample.txt'));
  const settings = s.nodes.find((n) => n.title.includes('SettingsHomepageActivity'));
  assert.ok(settings.coveredBy, 'the overlay above it covers all of it');
  assert.ok(settings.coveredBy.title.includes('tracker'));
  assert.equal(settings.coveredBy.occludes, true, 'and it is not a trusted overlay');

  // the bars are covered by nothing: nothing above them is in their way
  assert.equal(s.nodes.find((n) => n.title === 'StatusBar').coveredBy, null);
});

test('a spy is not in the way, because a spy consumes nothing', () => {
  const s = parseInputDump(read('fixtures/input-sample.txt'));
  const cluster = s.nodes.find((n) => n.title.includes('ClusterActivity'));
  assert.equal(cluster.coveredBy, null, 'the spy over it covers it and takes nothing');
  assert.equal(cluster.regions.length, 2, 'and its own touch area is two rects');
});

/* DROP_INPUT_IF_OBSCURED says what happens under a condition, not what is
   happening, so which of the two a window is in has to be worked out. */
test('a window drops input if obscured only when something obscures it', () => {
  const text = read('fixtures/input-sample.txt');
  const quiet = parseInputDump(text).nodes.find((n) => n.title.includes('ClusterActivity'));
  assert.equal(quiet.dropsIfObscured, true);
  assert.equal(quiet.obscuredBy, null, 'the spy above it is a trusted overlay');
  assert.equal(quiet.dropping, false);
  assert.equal(quiet.family, 'input-window');

  // the same window with an untrusted, still-visible overlay over it: the spy
  // above it stops being a trusted overlay and starts counting as opaque
  const untrusted = text.split('\n').map((l) => l.includes('Cluster spy')
    ? l.replace(' | TRUSTED_OVERLAY', '')
       .replace('alpha=1.00', 'alpha=0.50')
       .replace('touchOcclusionMode=BLOCK_UNTRUSTED', 'touchOcclusionMode=USE_OPACITY')
    : l).join('\n');
  const covered = parseInputDump(untrusted)
    .nodes.find((n) => n.title.includes('ClusterActivity'));
  assert.ok(covered.obscuredBy, 'now something untrusted is in front of it');
  assert.equal(covered.obscuredBy.title, 'Cluster spy');
  assert.equal(covered.dropping, true);
  assert.equal(covered.family, 'input-drop');
});

test('a global monitor is listed, drawn nowhere, and sits above the windows', () => {
  const s = parseInputDump(read('fixtures/input-sample.txt'));
  const mon = s.nodes.find((n) => n.monitor);
  assert.equal(mon.title, 'PointerEventDispatcher0');
  assert.equal(mon.frame, null);
  assert.equal(mon.zRank, 0, 'it sees a touch before any window does');
  assert.equal(s.globals.monitors, 1);
});

test('a dispatcher that is frozen or off is reported as such', () => {
  const text = read('fixtures/input-sample.txt').replace('DispatchFrozen: false', 'DispatchFrozen: true');
  assert.equal(parseInputDump(text).globals.dispatchFrozen, true);
  assert.equal(parseInputDump(read('fixtures/input-sample.txt')).globals.dispatchFrozen, false);
});

/* ---------------- dumpsys input: the reader's devices ---------------- */

test('a source mask is read into the sources it holds', () => {
  assert.deepEqual(inputSources('0x00001002').names, ['TOUCHSCREEN']);
  assert.deepEqual(inputSources('0x00000301').names, ['KEYBOARD', 'DPAD']);
  assert.equal(inputSources('0x00001002').mask, 0x1002);
  // a build that prints the names is taken at its word
  assert.deepEqual(inputSources('MOUSE | MOUSE_RELATIVE').names, ['MOUSE', 'MOUSE_RELATIVE']);
});

test('the devices are the two halves of each one, joined on the device id', () => {
  const s = parseInputDevicesDump(read('fixtures/input-sample.txt'));
  assert.equal(s.ok, true);
  const devs = s.nodes.filter((n) => n.device);
  assert.deepEqual(devs.map((n) => n.id), [-1, 3, 4, 7]);

  const touch = devs.find((n) => n.id === 4);
  assert.equal(touch.kind, 'touchscreen');
  assert.equal(touch.hub.Path, '/dev/input/event4', 'the hub half');
  assert.equal(touch.hub.ConfigurationFile, '/vendor/usr/idc/goodix_ts.idc');
  assert.deepEqual(touch.sources.names, ['TOUCHSCREEN', 'STYLUS'], 'the reader half');
  assert.equal(touch.ranges.length, 5);
  assert.equal(touch.ranges[0].axis, 'X');
  assert.equal(touch.ranges[0].max, '1079.000');
});

test('EXTERNAL_STYLUS is a class of its own, not a device that is external', () => {
  const s = parseInputDevicesDump(read('fixtures/input-sample.txt'));
  const touch = s.nodes.find((n) => n.id === 4);
  assert.equal(touch.external, false, 'its classes say EXTERNAL_STYLUS, not EXTERNAL');
  assert.equal(s.nodes.find((n) => n.id === 7).external, true);
});

test('a device that names a display is grouped under it, and the rest are not', () => {
  const s = parseInputDevicesDump(read('fixtures/input-sample.txt'));
  assert.deepEqual(s.displays.map((d) => d.id), [-1, 0]);
  assert.equal(s.displays[0].label, 'no display');
  assert.deepEqual(s.displays[1].nodes.filter((n) => n.device).map((n) => n.id), [4]);
});

test('the mappers hang under the device the reader gave them to', () => {
  const s = parseInputDevicesDump(read('fixtures/input-sample.txt'));
  const mappers = s.nodes.filter((n) => n.mapper);
  assert.equal(mappers.length, 4);
  const touch = mappers.find((n) => n.title === 'Touch');
  assert.equal(touch.parentHash, 'input:dev:4');
  assert.equal(touch.mode, 'direct');
  assert.equal(touch.fields.DeviceType, 'touchScreen');
});

test('both input readers say no to every other dump they are shown', () => {
  for (const name of ['window-sample', 'sf-sample', 'sf-a16-sample', 'package-sample',
                      'anr-sample', 'car-service-sample', 'user-sample', 'binder-sample']) {
    assert.equal(parseInputDump(read(`fixtures/${name}.txt`)).ok, false, name);
    assert.equal(parseInputDevicesDump(read(`fixtures/${name}.txt`)).ok, false, name);
  }
});

/* The way these dumps actually arrive: every service in one file, one after
   another. A reader that scans to the end of the file rather than to the end
   of its own section reads the next service's lines as its own. */
test('both input readers read their own section of a bugreport, and no more', () => {
  const own = read('fixtures/input-sample.txt');
  const bugreport = [
    '========================================================',
    '== dumpstate: 2026-09-21 11:02:33',
    '========================================================',
    '------ WINDOW MANAGER WINDOWS (dumpsys window windows) ------',
    read('fixtures/window-sample.txt'),
    '--------- 0.421s was the duration of dumpsys window',
    '------ INPUT (dumpsys input) ------',
    own,
    '--------- 0.102s was the duration of dumpsys input',
    '------ PACKAGE MANAGER (dumpsys package) ------',
    read('fixtures/package-sample.txt'),
    '--------- 1.882s was the duration of dumpsys package',
  ].join('\n');

  const alone = parseInputDump(own);
  const inside = parseInputDump(bugreport);
  assert.equal(inside.nodes.length, alone.nodes.length);
  assert.deepEqual(inside.displays.map((d) => d.id), alone.displays.map((d) => d.id));

  const devsAlone = parseInputDevicesDump(own).nodes.filter((n) => n.device);
  const devsInside = parseInputDevicesDump(bugreport).nodes.filter((n) => n.device);
  assert.deepEqual(devsInside.map((n) => n.id), devsAlone.map((n) => n.id));

  // and the readers either side of it still see their own dumps whole
  assert.equal(parseWindowDump(bugreport).nodes.length, parseWindowDump(read('fixtures/window-sample.txt')).nodes.length);
  assert.equal(parsePackageDump(bugreport).ok, true);
});


/* ---------------- logcat ---------------- */

test('the level letter is the level, and an unknown one is not a crash', () => {
  assert.equal(logLevel('E').name, 'error');
  assert.equal(logLevel('F').rank, 5);
  assert.equal(logLevel('A').name, 'assert');
  assert.equal(logLevel('?').name, 'info', 'a letter logcat has never printed still reads');
});

test('the logs are read into one group per rule the bugreport printed', () => {
  const s = parseLogcatDump(read('fixtures/logcat-sample.txt'));
  assert.equal(s.ok, true);
  assert.deepEqual(s.displays.map((d) => d.label),
    ['system log', 'event log', 'radio log', 'kernel log']);
  assert.equal(s.displays[0].command, 'logcat -b all -v threadtime -v printable -v uid -d *:v');
  assert.deepEqual(s.displays[0].buffers, ['main', 'crash']);
});

/* Three shapes of line, and the parser has to read all three off one file. */
test('a line is read with or without the uid column, and dmesg with neither', () => {
  const s = parseLogcatDump(read('fixtures/logcat-sample.txt'));
  const line = (tag) => s.nodes.find((n) => n.entry.tag === tag).entry;

  const withUid = line('ActivityManager');     // the system log is dumped with -v uid
  assert.equal(withUid.uid, '1000');
  assert.equal(withUid.pid, 1631);
  assert.equal(withUid.tid, 1668);
  assert.equal(withUid.level.name, 'info');

  const noUid = line('RILJ');                  // the radio log is not
  assert.equal(noUid.uid, null);
  assert.equal(noUid.pid, 1900);
  assert.equal(noUid.tid, 1955);

  const kernel = line('lowmemorykiller');      // and dmesg counts from boot
  assert.equal(kernel.pid, null);
  assert.equal(kernel.time, null);
  assert.ok(kernel.uptime > 12);
  assert.ok(kernel.message.includes('Killing'));
});

/* The list is the log: every line of it, in the order it was printed, with
   nothing nested inside anything. */
test('the list is the lines, in the order the log printed them', () => {
  const s = parseLogcatDump(read('fixtures/logcat-sample.txt'));
  const sys = s.nodes.filter((n) => n.displayId === 0);

  assert.equal(sys.length, s.displays[0].lines, 'every line of the buffer is a row');
  assert.ok(s.nodes.every((n) => !n.parentHash), 'and none of them hangs under anything');
  assert.deepEqual(sys.map((n) => n.at), sys.map((n) => n.at).slice().sort((a, b) => a - b),
    'the rows run down the file the way the log ran down the clock');

  const am = sys.filter((n) => n.tag === 'ActivityManager');
  assert.equal(am.length, 6);
  assert.equal(am.filter((n) => n.level.rank >= 4).length, 2, 'two of them are errors');
  assert.equal(am.filter((n) => n.level.name === 'warn').length, 2);

  // the row carries what the columns print, so the reader needs nothing else
  const one = am[0];
  assert.equal(one.entry.tag, 'ActivityManager');
  assert.ok(one.entry.time);
  assert.equal(typeof one.entry.pid, 'number');
  assert.ok(one.search.includes(String(one.entry.pid)), 'and the filter reaches the pid');
});

test('a crash is found by either of the two things that say so', () => {
  const s = parseLogcatDump(read('fixtures/logcat-sample.txt'));
  const crashed = [...new Set(s.nodes.filter((n) => n.crash).map((n) => n.tag))];
  assert.deepEqual(crashed.sort(), ['AndroidRuntime', 'am_crash'],
    'FATAL EXCEPTION in the main log, and the event the framework logged for it');
  assert.equal(s.globals.crashes, 2);
});

/* The span of a bugreport's logs is not its first and last line: the buffers
   are printed one after another, so the radio log ends before the main log. */
test('the span of the log is worked out from the stamps, not the order', () => {
  const g = parseLogcatDump(read('fixtures/logcat-sample.txt')).globals;
  assert.equal(g.first, '09-21 11:02:30.115', 'the radio log opens it');
  assert.equal(g.last, '09-21 11:02:36.002', 'and the system log closes it');
});

/* A log longer than the reader holds is sampled rather than cut off at the
   budget: what goes is the repetition, and the lines with a level on them
   stay where they were printed. */
test('a log keeps its worst lines when it printed more than the budget', () => {
  const entries = [];
  for (let i = 0; i < 500; i++) {
    entries.push({ at: i, level: logLevel(i === 480 ? 'E' : 'D') });
  }
  const kept = logKeep(entries, 10);
  assert.equal(kept.length, 10);
  assert.ok(kept.some((e) => e.level.name === 'error'), 'the one error survives the cut');
  assert.deepEqual(kept.map((e) => e.at), kept.map((e) => e.at).slice().sort((a, b) => a - b),
    'and what is kept still reads in the order it was printed');
  assert.equal(logKeep(entries.slice(0, 4), 10).length, 4, 'a short tag is left alone');
});

test('this parser says no to every dump that is not a log', () => {
  for (const name of ['window-sample', 'sf-sample', 'sf-a16-sample', 'package-sample',
                      'anr-sample', 'car-service-sample', 'user-sample', 'binder-sample',
                      'input-sample']) {
    assert.equal(parseLogcatDump(read(`fixtures/${name}.txt`)).ok, false, name);
  }
});

/* ---------------- a reader stays inside its own section ---------------- */

/* Both of these parsers mark their sections with something another dump in a
   bugreport also prints, and both are handed the whole file. A car heading is
   a line between stars, which is what SurfaceFlinger prints for every layer;
   a user section is a line at no indent, which is every heading there is. So
   each reads within its own part of the file, from the heading that opens it
   to the next bugreport rule or the line naming the next service. */

const BUGREPORT_BEFORE = [
  '------ SURFACEFLINGER (dumpsys SurfaceFlinger) ------',
  'Display 0 (HWC display 0): powerMode=2',
  '* Layer 0xb4000071ecf94170 (Display 0 name="Built-in Screen"#3)',
  '  Region transparentRegion (this=0 count=1)',
  '* Layer 0xb4000071ecf96f00 (StatusBar#8)',
  '  z= 1, mDrawingParent=none',
  'Hardware Composer state (version 2.4)',
  '--------- 0.2s was the duration of surfaceflinger',
].join('\n');

test('a SurfaceFlinger layer in the same file is not a car service', () => {
  const own = read('fixtures/car-service-sample.txt');
  const s = parseCarServiceDump(`${BUGREPORT_BEFORE}\n${own}`);

  assert.ok(!s.nodes.some((n) => /^Layer 0x/.test(n.title)),
    'the layers above it are another dump');
  assert.ok(s.nodes.some((n) => n.title === 'CarPropertyService'),
    'and its own services are still read');

  /* The same services, off the same lines, as the dump read on its own — only
     shifted by the section that now sits above it. */
  const alone = parseCarServiceDump(own);
  const shift = BUGREPORT_BEFORE.split('\n').length;
  assert.deepEqual(s.nodes.map((n) => n.title), alone.nodes.map((n) => n.title));
  assert.deepEqual(s.nodes.map((n) => n.at), alone.nodes.map((n) => n.at + shift),
    'and a row still says which line of the whole file it came off');
});

test('another dump heading in the same file is not a user section', () => {
  const own = read('fixtures/user-sample.txt');
  const before = [
    '------ PACKAGE MANAGER (dumpsys package) ------',
    'Packages:',
    '  Package [com.example.player] (1a2b3c):',
    '    userId=10233',
    'Hidden system packages:',
    '  Package [com.android.oem] (4d5e6f):',
    '--------- 0.2s was the duration of package manager',
  ].join('\n');
  const after = [
    '--------- 0.2s was the duration of users',
    '------ INPUT (dumpsys input) ------',
    'Input Manager State:',
    '  Interceptor: nothing',
  ].join('\n');

  const s = parseUserDump(`${before}\n${own}\n${after}`);
  assert.ok(!s.nodes.some((n) => /^Packages|^Hidden system packages|^Input Manager State/.test(n.title)),
    'neither the dump above it nor the one below');

  const alone = parseUserDump(own);
  const shift = before.split('\n').length;
  assert.deepEqual(s.nodes.map((n) => n.title), alone.nodes.map((n) => n.title));
  assert.deepEqual(s.nodes.map((n) => n.at), alone.nodes.map((n) => n.at + shift));
  assert.equal(s.globals.current, alone.globals.current);
  assert.equal(s.globals.lines, own.split('\n').length,
    'and the dump is as long as its section, not as the file');
});

/* `Current user:` is printed indented by other services and `Users:` by the
   package dump; an opener is only an opener at no indent. */
test('an indented Current user or Users line does not open the user dump', () => {
  const own = read('fixtures/user-sample.txt');
  const before = [
    '------ ACTIVITY MANAGER (dumpsys activity) ------',
    'ACTIVITY MANAGER USERS:',
    '    Current user: 0',
    '  Users:',
    '    UserInfo{0:null:813}',
    '--------- 0.2s was the duration of activity manager',
  ].join('\n');

  const s = parseUserDump(`${before}\n${own}`);
  assert.ok(!s.nodes.some((n) => n.title === 'ACTIVITY MANAGER USERS'));
  assert.equal(s.nodes[0].at, parseUserDump(own).nodes[0].at + before.split('\n').length);
});

/* ---------------- getevent ---------------- */

/* Every other reader is handed the thing it reports. This one is handed a list
   of kernel events and has to work out that a finger was involved at all, so
   what it gets wrong is not a field — it is a whole gesture, or a whole
   protocol, going missing. */

const gevCap = read('fixtures/getevent-sample.txt');

test('a tracking id of ffffffff is the finger leaving, not a finger 4294967295', () => {
  assert.equal(gevSigned('ffffffff'), -1);
  assert.equal(gevSigned('00000065'), 0x65);
  /* A value printed short — some builds do — is not sign-extended off its own
     top bit. */
  assert.equal(gevSigned('ff'), 0xff);
});

test('a capture comes out as the strokes the fingers made', () => {
  const s = parseGeteventCapture(gevCap);
  const panel = s.displays.find((d) => d.label === 'event2');
  assert.ok(panel, 'the touch device is a group of its own');
  assert.equal(panel.protocol, 'B');
  /* The ranges were pasted above the capture, so the space is the panel's own
     and not one guessed from how far the fingers went. */
  assert.deepEqual(panel.size, { w: 1080, h: 2340 });
  assert.equal(panel.synthesised, false);

  const kinds = panel.nodes.filter((n) => n.stroke).map((n) => n.kind);
  assert.deepEqual(kinds,
    ['tap', 'long press', 'swipe up', 'swipe left', 'swipe right']);
});

test('a still finger is a tap under half a second and a long press over it', () => {
  const s = parseGeteventCapture(gevCap);
  const tap = s.nodes.find((n) => n.kind === 'tap');
  const press = s.nodes.find((n) => n.kind === 'long press');
  assert.ok(tap.duration < 0.5 && press.duration >= 0.5);
  /* Both stood still. What separates them is the clock and nothing else. */
  assert.ok(tap.geo.travel < 20 && press.geo.travel < 20);
});

test('fingers down at the same time are one gesture, and two moving apart are a pinch', () => {
  const s = parseGeteventCapture(gevCap);
  const group = s.nodes.find((n) => n.gesture);
  assert.equal(group.title, 'pinch out');
  assert.equal(group.fingers, 2);
  const kids = s.nodes.filter((n) => n.parentHash === group.hash);
  assert.equal(kids.length, 2);
  /* The two strokes are the gesture's, and nothing else on the panel is. */
  assert.ok(s.nodes.filter((n) => n.stroke).length > kids.length);
});

test('a key is a node with no place on the panel, on the device that reported it', () => {
  const s = parseGeteventCapture(gevCap);
  const keys = s.displays.find((d) => d.label === 'event0');
  assert.equal(keys.noGeometry, true);
  assert.deepEqual(keys.nodes.map((n) => n.title), ['KEY_VOLUMEDOWN']);
  assert.equal(keys.nodes[0].frame, null);
});

/* The labels are `-l` and the stamps are `-t`; a capture taken without either
   is still a capture, and the reader that only reads the fully-flagged form is
   the reader that is no use at three in the morning. */
test('a capture taken without -l reads the same as one taken with it', () => {
  const labelled = [
    '[   10.000000] /dev/input/event2: EV_ABS       ABS_MT_TRACKING_ID   00000005',
    '[   10.000000] /dev/input/event2: EV_ABS       ABS_MT_POSITION_X    00000064',
    '[   10.000000] /dev/input/event2: EV_ABS       ABS_MT_POSITION_Y    000000c8',
    '[   10.000000] /dev/input/event2: EV_SYN       SYN_REPORT           00000000',
    '[   10.050000] /dev/input/event2: EV_ABS       ABS_MT_TRACKING_ID   ffffffff',
    '[   10.050000] /dev/input/event2: EV_SYN       SYN_REPORT           00000000',
  ].join('\n');
  const raw = [
    '[   10.000000] /dev/input/event2: 0003 0039 00000005',
    '[   10.000000] /dev/input/event2: 0003 0035 00000064',
    '[   10.000000] /dev/input/event2: 0003 0036 000000c8',
    '[   10.000000] /dev/input/event2: 0000 0000 00000000',
    '[   10.050000] /dev/input/event2: 0003 0039 ffffffff',
    '[   10.050000] /dev/input/event2: 0000 0000 00000000',
  ].join('\n');
  const a = parseGeteventCapture(labelled), b = parseGeteventCapture(raw);
  assert.equal(a.nodes.length, 1);
  assert.deepEqual(b.nodes.map((n) => n.kind), a.nodes.map((n) => n.kind));
  assert.deepEqual(b.nodes[0].samples, a.nodes[0].samples);
});

test('a protocol A device, which states every contact every frame, reads too', () => {
  const lines = [];
  const at = (t, code, v) =>
    lines.push(`[   ${t.toFixed(6)}] /dev/input/event1: EV_ABS       ${code}   ${
      (v >>> 0).toString(16).padStart(8, '0')}`);
  const syn = (t, code) =>
    lines.push(`[   ${t.toFixed(6)}] /dev/input/event1: EV_SYN       ${code}   00000000`);
  for (let i = 0; i < 5; i++) {
    const t = 20 + i * 0.01;
    at(t, 'ABS_MT_POSITION_X', 100 + i * 60);
    at(t, 'ABS_MT_POSITION_Y', 200);
    syn(t, 'SYN_MT_REPORT');
    at(t, 'ABS_MT_POSITION_X', 500 - i * 60);
    at(t, 'ABS_MT_POSITION_Y', 600);
    syn(t, 'SYN_MT_REPORT');
    syn(t, 'SYN_REPORT');
  }
  syn(20.06, 'SYN_REPORT');            // an empty frame: both fingers gone

  const s = parseGeteventCapture(lines.join('\n'));
  assert.equal(s.displays[0].protocol, 'A');
  const strokes = s.nodes.filter((n) => n.stroke);
  assert.equal(strokes.length, 2, 'two contacts, not ten');
  /* They were down together, so they are one gesture — and they closed on each
     other, which is the other half of a pinch. */
  const group = s.nodes.find((n) => n.gesture);
  assert.equal(group.title, 'pinch in');
});

test('a single-touch device is read off BTN_TOUCH and ABS_X/ABS_Y', () => {
  const lines = [];
  const ev = (t, type, code, v) =>
    lines.push(`[   ${t.toFixed(6)}] /dev/input/event3: ${type}       ${code}   ${
      (v >>> 0).toString(16).padStart(8, '0')}`);
  ev(30, 'EV_KEY', 'BTN_TOUCH', 1);
  for (let i = 0; i < 6; i++) {
    ev(30 + i * 0.02, 'EV_ABS', 'ABS_X', 300);
    ev(30 + i * 0.02, 'EV_ABS', 'ABS_Y', 900 - i * 60);
    ev(30 + i * 0.02, 'EV_SYN', 'SYN_REPORT', 0);
  }
  ev(30.14, 'EV_KEY', 'BTN_TOUCH', 0);
  ev(30.14, 'EV_SYN', 'SYN_REPORT', 0);

  const s = parseGeteventCapture(lines.join('\n'));
  assert.equal(s.displays[0].protocol, 'single-touch');
  assert.equal(s.nodes.length, 1);
  assert.equal(s.nodes[0].kind, 'swipe up');
  /* BTN_TOUCH is what opened and shut the stroke; it is not a key of its own. */
  assert.ok(!s.nodes.some((n) => n.key));
});

/* Without `getevent -p` above it there is no stated coordinate space, and the
   only honest one is how far the fingers actually went — said to be inferred
   wherever it is shown. */
test('a capture with no ranges says its coordinate space was inferred', () => {
  const noRanges = gevCap.split('\n').filter((l) => !/value \d+, min /.test(l)).join('\n');
  const s = parseGeteventCapture(noRanges);
  const panel = s.displays.find((d) => d.label === 'event2');
  assert.equal(panel.synthesised, true);
  assert.ok(panel.size.w < 1080 || panel.size.h < 2340,
    'the space is what the fingers reached, which is less than the panel');
});

test('a held finger reporting the same point at 120Hz is one sample, not a hundred', () => {
  const lines = ['[   40.000000] /dev/input/event2: EV_ABS       ABS_MT_TRACKING_ID   00000001'];
  for (let i = 0; i < 50; i++) {
    lines.push(`[   ${(40 + i * 0.008).toFixed(6)}] /dev/input/event2: EV_ABS       ABS_MT_POSITION_X    00000064`);
    lines.push(`[   ${(40 + i * 0.008).toFixed(6)}] /dev/input/event2: EV_ABS       ABS_MT_POSITION_Y    00000064`);
    lines.push(`[   ${(40 + i * 0.008).toFixed(6)}] /dev/input/event2: EV_SYN       SYN_REPORT           00000000`);
  }
  const s = parseGeteventCapture(lines.join('\n'));
  const n = s.nodes[0];
  assert.equal(n.samples.length, 1);
  assert.equal(n.samples[0].held, 50);
  /* The stroke still lasted as long as it lasted. */
  assert.ok(n.duration > 0.38);
});
