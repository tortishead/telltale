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
  userFlagNames, userListUnder, overlayFields, overlayStateLabel, overlayConstraints,
  TYPE_INTS,
  parseBinderCallsStatsDump,
  binderCaller, binderCall, binderTxn, binderTime, binderBytes,
  parseInputDump, parseInputDevicesDump,
  inputSources, inputWindowName, inputRegion, inputConfigOf, inputViewports,
  parseLogcatDump, logKeep, logLevel,
  parseGeteventCapture, gevSigned, gevTracks,
  parseSystemPropertiesDump, propNamespace, propSectionOf, propReadOnly, propFlag,
  parseEventLogDump, eventSplit, eventFields, configChanges, shortComponent,
  parseDisplayManagerDump, dmRect, dmField, dmSize, dmBlocks, dmCutoutBounds, dmDegrees,
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

/* The new frontend prints a rect as four numbers in braces, and prints them
   left, top, BOTTOM, right — the order the struct is laid out in rather than
   the order every other rect in the dump comes in. Read as l,t,r,b a bottom
   bar comes out as an impossible rect, which `rectValid` then drops, so the
   layer silently loses its geometry. The HWC table in the same dump is what
   proves the order: it prints the same rect as LTRB. */
test('a braced bounds is read left, top, bottom, right', () => {
  const dump = [
    'Active Layers - layers with client handles (count = 2)',
    '',
    'Composition list (top to bottom)',
    'LayerStack=0',
    '  Layer [74] BottomCarSystemBar#74',
    '    visible reason= buffer=10574209482756 frame=55',
    '    bounds={0,2124,2220,956} toDisplayTransform={ tx=0.0000 ty=2124.0000 }',
    '    input{(NOT_FOCUSABLE) touchableRegion={0,2124,2220,956}}',
    '  Layer [69] TopCarSystemBar#69',
    '    visible reason= buffer=10574209482753 frame=6',
    '    bounds={0,0,76,956}',
    '',
    'Layer Hierarchy',
    ' ROOT',
    ' ├─ BottomCarSystemBar#74 pid=1854 uid=1000',
    ' └─ TopCarSystemBar#69 pid=1854 uid=1000',
  ].join('\n');

  const s = parseSurfaceFlingerDump(dump);
  const at = (t) => s.nodes.find((n) => n.title === t);

  // the HWC table of the dump this came from prints 0 2124 956 2220
  assert.deepEqual(at('BottomCarSystemBar#74').rects.bounds,
    { l: 0, t: 2124, r: 956, b: 2220 });
  assert.deepEqual(at('TopCarSystemBar#69').rects.bounds,
    { l: 0, t: 0, r: 956, b: 76 });
  // a touchable region is printed the same way round
  assert.deepEqual(at('BottomCarSystemBar#74').touchable,
    { l: 0, t: 2124, r: 956, b: 2220 });
});

/* Reordering a rect without saying so reads, to anyone holding the pane next
   to the dump, as a rect that is not there at all. */
test('the numbers the dump printed come back with the rect', () => {
  const dump = [
    'Active Layers - layers with client handles (count = 1)',
    '',
    'Composition list (top to bottom)',
    'LayerStack=0',
    '  Layer [108] CarLauncher#108',
    '    visible reason= buffer=11965778886660 frame=14',
    '    bounds={0,0,2220,956}',
    '    input{(TRUSTED_OVERLAY) touchableRegion={0,0,2220,956}}',
  ].join('\n');

  const n = parseSurfaceFlingerDump(dump).nodes.find((x) => x.title === 'CarLauncher#108');

  assert.deepEqual(n.rects.bounds, { l: 0, t: 0, r: 956, b: 2220 });
  assert.equal(n.printed.bounds, '0,0,2220,956');
  assert.equal(n.printed['touchable region'], '0,0,2220,956');
  // a dump that printed no braced rect carries no printed text either
  const legacy = parseSurfaceFlingerDump(read('fixtures/sf-sample.txt'));
  assert.deepEqual(legacy.nodes[0].printed, {});
});

/* A rect is only wrong against the display it is on, and a layer left in the
   other rotation is the case the braced print order hides best: the numbers
   look plausible either way round until they are held against the screen. */
const offDisplayDump = (bounds, dispFrame) => [
  'Active Layers - layers with client handles (count = 1)',
  '',
  'Composition list (top to bottom)',
  'LayerStack=0',
  '  Layer [108] CarLauncher#108',
  '    visible reason= buffer=11965778886660 frame=14',
  `    bounds={${bounds}}`,
  '',
  'Display 4630947222266796161 (physical, "DSI_0")',
  '   layerFilter={layerStack=0 toInternalDisplay=true skipScreenshot=false }',
  '   displaySpace=ProjectionSpace{bounds=Rect(0, 0, 956, 2220), content=Rect(0, 0, 956, 2220), orientation=ROTATION_0}',
  '',
  'Display 4630947222266796161 HWC layers (top to bottom):',
  ' Layer name',
  '           Z |  Window Type |  Comp Type |  Transform |   Disp Frame (LTRB) |          Source Crop (LTRB) |',
  ' CarLauncher#108',
  `           2 |            1 |     DEVICE |          0 | ${dispFrame} |    0.0    0.0  956.0 2220.0 |`,
].join('\n');

test('a layer that fits the display is not flagged for not fitting it', () => {
  // the numbers the car dump really printed: left, top, bottom, right
  const s = parseSurfaceFlingerDump(offDisplayDump('0,0,2220,956', '   0    0  956 2220'));
  const n = s.nodes.find((x) => x.title === 'CarLauncher#108');
  assert.deepEqual(s.displays[0].size, { w: 956, h: 2220 });
  assert.deepEqual(n.frame, { l: 0, t: 0, r: 956, b: 2220 });
  assert.equal(n.offDisplay, undefined);
  assert.ok(!n.badges.some(([label]) => /display|transposed/.test(label)));
});

test('a layer still in the other rotation is called transposed', () => {
  const s = parseSurfaceFlingerDump(offDisplayDump('0,0,956,2220', '   0    0 2220  956'));
  const n = s.nodes.find((x) => x.title === 'CarLauncher#108');
  assert.deepEqual(n.frame, { l: 0, t: 0, r: 2220, b: 956 });
  assert.equal(n.offDisplay.transposed, true);
  assert.equal(n.offDisplay.clear, false);
  assert.deepEqual(n.offDisplay.size, { w: 956, h: 2220 });
  assert.equal(n.offDisplay.over.r, 1264);
  assert.ok(n.badges.some(([label]) => label === 'transposed'));
});

test('a layer with nothing on the display at all says so', () => {
  const s = parseSurfaceFlingerDump(offDisplayDump('0,0,956,2220', '1200    0 2000  900'));
  const n = s.nodes.find((x) => x.title === 'CarLauncher#108');
  assert.equal(n.offDisplay.clear, true);
  assert.equal(n.offDisplay.transposed, false);
  assert.ok(n.badges.some(([label]) => label === 'off display'));
});

/* The size Telltale works out from how far the layers reach cannot be overrun
   by the layers it was worked out from, so a dump that never stated a display
   size says nothing about fit either. */
test('a display whose size was guessed flags nothing', () => {
  const dump = [
    'Active Layers - layers with client handles (count = 1)',
    '',
    'Composition list (top to bottom)',
    'LayerStack=0',
    '  Layer [108] CarLauncher#108',
    '    visible reason= buffer=11965778886660 frame=14',
    '    bounds={0,0,956,2220}',
  ].join('\n');
  const s = parseSurfaceFlingerDump(dump);
  assert.ok(s.displays[0].synthesised);
  assert.equal(s.nodes[0].offDisplay, undefined);
});

/* An input sink's bounds are larger than any screen on purpose, and it is
   drawn by nothing. Flagging it would put the badge on half a modern dump. */
test('an invisible layer is not flagged for reaching past the display', () => {
  const s = parseSurfaceFlingerDump([
    'Active Layers - layers with client handles (count = 1)',
    '',
    'Input list',
    'LayerStack=0',
    '  Layer [40] PointerEventDispatcherOverlay0#40',
    '    invisible reason=nothing to draw',
    '    bounds={-9560,-22200,22200,9560}',
    '',
    'Display 4630947222266796161 (physical, "DSI_0")',
    '   layerFilter={layerStack=0 toInternalDisplay=true skipScreenshot=false }',
    '   displaySpace=ProjectionSpace{bounds=Rect(0, 0, 956, 2220), content=Rect(0, 0, 956, 2220), orientation=ROTATION_0}',
  ].join('\n'));
  assert.equal(s.nodes[0].visible, false);
  assert.equal(s.nodes[0].offDisplay, undefined);
});

/* An output layer writes the dataspace mid-line with the next field right
   behind it, and the value itself has spaces in it. */
test('a dataspace stops at the next field, not at the end of the line', () => {
  const s = parseSurfaceFlingerDump([
    'Active Layers - layers with client handles (count = 1)',
    '',
    'Composition list (top to bottom)',
    'LayerStack=0',
    '  Layer [108] CarLauncher#108',
    '    visible reason= buffer=1 frame=14',
    '    bounds={0,0,2220,956}',
    '',
    'Display 0',
    '  - Output Layer 0xb40000723ea1b220(CarLauncher#108)',
    '      forceClientComposition=false displayFrame=[0 0 956 2220] bufferTransform=0 (0) '
    + 'dataspace=V0_SRGB (142671872) whitePointNits=-1.000000 dimmingRatio=1.000000 '
    + 'override dataspace=UNKNOWN (0) override display space=ProjectionSpace{bounds=Rect(0, 0, -1, -1)}',
  ].join('\n'));
  assert.equal(s.nodes[0].dataspace, 'V0_SRGB (142671872)');
  // the layer list writes it with a comma after it and spaces inside it
  const legacy = parseSurfaceFlingerDump(read('fixtures/sf-sample.txt'));
  assert.ok(legacy.nodes.some((n) => n.dataspace === 'BT709 sRGB Full range'));
});

/* ---------------- dumpsys display ---------------- */

test('the service prints its rects, its fields and its rotations in its own way', () => {
  assert.deepEqual(dmRect('logicalFrame=Rect(0, 0 - 1080, 2400)'),
    { l: 0, t: 0, r: 1080, b: 2400 });
  assert.equal(dmRect('nothing here'), null);
  // a viewport writes `key=value` and a DisplayInfo writes `key value`
  assert.equal(dmField('displayId=0, uniqueId=\'local:4\'', 'displayId'), '0');
  assert.equal(dmField('rotation 3, state ON', 'rotation'), '3');
  assert.equal(dmField('uniqueId "local:4619"', 'uniqueId'), 'local:4619');
  assert.equal(dmField('hdrCapabilities null', 'hdrCapabilities'), null);
  assert.deepEqual(dmSize('real 1080 x 2400, app 1080 x 2264', 'app'), { w: 1080, h: 2264 });
  // Android counts rotation in quarter turns
  assert.equal(dmDegrees(0), 0);
  assert.equal(dmDegrees(1), 90);
  assert.equal(dmDegrees(3), 270);
  assert.equal(dmDegrees(null), null);
});

test('a block is taken by counting braces, not to the first close', () => {
  const text = 'DisplayDeviceInfo{"Screen": hdr HdrCapabilities{mMax=1000.0}, '
             + 'cutout DisplayCutout{insets=Rect(0, 136 - 0, 0)}, state ON}';
  const [block] = dmBlocks(text, 'DisplayDeviceInfo');

  assert.match(block.body, /state ON$/, 'the inner blocks did not end the outer one');
  assert.equal(dmField(block.body, 'state'), 'ON');
});

test('the holes in a panel are the bounds, not the insets above them', () => {
  const cutout = 'insets=Rect(0, 136 - 0, 0) waterfall=Insets{left=0, top=0, right=0, bottom=0} '
               + 'boundingRect={Bounds=[Rect(0, 0 - 0, 0), Rect(464, 0 - 616, 136), '
               + 'Rect(0, 0 - 0, 0), Rect(0, 0 - 0, 0)]}';
  assert.deepEqual(dmCutoutBounds(cutout), [{ l: 464, t: 0, r: 616, b: 136 }]);
  assert.deepEqual(dmCutoutBounds(null), []);
});

test('the display sample comes out as the displays the framework hands out', () => {
  const s = parseDisplayManagerDump(read('fixtures/display-sample.txt'));

  assert.equal(s.ok, true);
  assert.deepEqual(s.displays.map((d) => d.id), [0, 2]);

  const [panel, hdmi] = s.displays;
  assert.equal(panel.name, 'Built-in Screen');
  assert.deepEqual(panel.real, { w: 1080, h: 2400 });
  assert.deepEqual(panel.app, { w: 1080, h: 2264 }, 'which is not the panel');
  assert.equal(panel.density, 420);
  assert.equal(panel.rotation, '0');
  assert.equal(panel.state, 'ON');
  assert.equal(panel.type, 'INTERNAL');
  assert.deepEqual(panel.mode, { id: 1, w: 1080, h: 2400, fps: 120 });
  assert.equal(panel.modes.length, 2, 'and what else the panel could do');
  assert.ok(panel.flags.includes('FLAG_SECURE'));

  assert.equal(hdmi.name, 'HDMI Screen');
  assert.deepEqual(hdmi.real, { w: 1920, h: 1080 });
  assert.equal(hdmi.rotation, '90', 'in degrees, not in quarter turns');
  assert.equal(hdmi.density, 213);
});

test('a display is drawn as the rectangles it is made of', () => {
  const s = parseDisplayManagerDump(read('fixtures/display-sample.txt'));
  const on = (id) => s.displays.find((d) => d.id === id).nodes;

  assert.deepEqual(on(0).map((n) => n.title),
    ['panel', 'what apps get', 'input viewport', 'cutout 1']);
  assert.deepEqual(on(0)[0].frame, { l: 0, t: 0, r: 1080, b: 2400 });
  assert.deepEqual(on(0)[1].frame, { l: 0, t: 0, r: 1080, b: 2264 });
  assert.deepEqual(on(0)[3].frame, { l: 464, t: 0, r: 616, b: 136 });
  assert.match(on(0)[1].meta, /136px of decor/);

  /* A display whose app area is the whole panel has nothing to say about the
     difference, so it does not get a rect for it. */
  assert.deepEqual(on(2).map((n) => n.title), ['panel', 'input viewport']);
});

/* The one field in a bugreport that says which way round a panel is glued to
   the display it drives, and the reason this reader is worth having open
   beside a touch trace. */
test('a display states how its panel is mounted, in degrees', () => {
  const s = parseDisplayManagerDump(read('fixtures/display-sample.txt'));
  assert.equal(s.displays[0].installRotation, 0);
  assert.equal(s.displays[1].installRotation, 90, 'installOrientation 1 is a quarter turn');
});

test('the input viewport is read as the frame a touch is mapped through', () => {
  const s = parseDisplayManagerDump(read('fixtures/display-sample.txt'));
  const v = s.displays[0].viewport;

  assert.equal(v.type, 'INTERNAL');
  assert.equal(v.orientation, 0);
  assert.equal(v.port, 0);
  assert.deepEqual(v.logical, { l: 0, t: 0, r: 1080, b: 2400 });
  assert.equal(v.valid, true);
  assert.equal(s.displays[1].viewport.orientation, 1);
});

test('a dump that printed its panels and no logical displays is still read', () => {
  const text = read('fixtures/display-sample.txt');
  const cut = text.slice(0, text.indexOf('  Logical Displays:'));
  const s = parseDisplayManagerDump(cut);

  assert.equal(s.ok, true);
  assert.equal(s.displays.length, 2, 'the devices are the displays it has');
  assert.deepEqual(s.displays[0].real, { w: 1080, h: 2400 });
});

/* Android 16 rewrote the shape of this dump rather than what it says: every
   heading inside it is underlined with a rule, the modes carry two fields
   between their id and their size, and a logical display names its device
   with the unique id hung on the end of the name. Each of those cost the
   reader something, and the first cost it everything. */
test('an Android 16 dump is read past the rules it underlines its headings with', () => {
  const s = parseDisplayManagerDump(read('fixtures/display-a16-sample.txt'));

  assert.equal(s.ok, true);
  assert.deepEqual(s.displays.map((d) => d.id), [0, 2],
    'the rule under `Display States:` is not the end of the section');
  assert.equal(s.globals.devices, 2);

  const [panel, overlay] = s.displays;
  assert.deepEqual(panel.real, { w: 1080, h: 2400 });
  assert.equal(panel.density, 420);
  assert.equal(panel.installRotation, 0);
  assert.deepEqual(panel.nodes.map((n) => n.title), ['panel', 'input viewport', 'cutout 1']);
  assert.deepEqual(panel.nodes[2].frame, { l: 492, t: 0, r: 610, b: 128 },
    'the cutout, and not a rect out of the path parser printed beside it');

  assert.equal(overlay.name, 'Overlay #1');
  assert.deepEqual(overlay.real, { w: 1280, h: 720 });
});

test('a mode is read through the fields Android 16 puts before its size', () => {
  const s = parseDisplayManagerDump(read('fixtures/display-a16-sample.txt'));
  const m = s.displays[0].mode;

  assert.deepEqual({ id: m.id, w: m.w, h: m.h }, { id: 1, w: 1080, h: 2400 },
    '`{id=1, parentModeId=-1, flags=, width=...}`');
  assert.equal(Math.round(m.fps), 60);
  assert.equal(s.displays[0].modes.length, 1);
  /* 60.000004 Hz is the panel being honest and nothing anyone wants on a row. */
  assert.match(s.displays[0].meta, /60 Hz$/);
});

test('a logical display finds its panel through the name the unique id is hung on', () => {
  const s = parseDisplayManagerDump(read('fixtures/display-a16-sample.txt'));
  assert.equal(s.displays[0].device.name, 'Built-in Screen',
    '`mPrimaryDisplayDevice=Built-in Screen(local:4619827259835644672)`');
  assert.equal(s.displays[1].device.name, 'Overlay #1');
  assert.ok(s.displays[0].cutoutInsets, 'and with it what only the device states');
});

test('a text with none of this service in it is not this dump', () => {
  assert.equal(parseDisplayManagerDump('').ok, false);
  assert.equal(parseDisplayManagerDump('WINDOW MANAGER WINDOWS (dumpsys window windows)').ok, false);
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
    ' mTargetPackageName.....: com.android.systemui',
    ' mTargetOverlayableName.: null',
    ' mPriority..............: 11',
  ]);

  assert.equal(f.get('mTargetPackageName'), 'com.android.systemui');
  assert.equal(f.get('mPriority'), '11');
  // the manager concatenates a null field, so `null` is a value that arrives
  assert.equal(f.get('mTargetOverlayableName'), 'null');
  assert.equal(f.has('mNotPrinted'), false);
});

test('overlayStateLabel says the constant the way a person would', () => {
  assert.equal(overlayStateLabel('STATE_MISSING_TARGET'), 'missing target');
  assert.equal(overlayStateLabel('STATE_ENABLED'), 'enabled');
  assert.equal(overlayStateLabel(''), null);
});

/* Android 16 added `mConstraints` to the block. `None` is the manager saying
   there are none; anything else is a list of `{type: X, value: Y}`. */
test('overlayConstraints reads what an overlay is held to', () => {
  assert.deepEqual(overlayConstraints('None'), []);
  assert.deepEqual(overlayConstraints(undefined), [], 'a build before 16 prints no field');
  assert.deepEqual(overlayConstraints('[{type: DISPLAY_ID, value: 2}]'), ['display id 2']);
  assert.deepEqual(overlayConstraints('[{type: DISPLAY_ID, value: 2},{type: DEVICE_ID, value: 7}]'),
    ['display id 2', 'device id 7']);
  // a shape this reader has never seen is kept rather than thrown away
  assert.deepEqual(overlayConstraints('something new'), ['something new']);
});

test('the overlay sample groups its overlays under the package each is over', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt'));
  const at = (title, user) => s.nodes.find((n) => n.title === title && n.userId === user);

  assert.deepEqual(s.displays.map((d) => d.id), [0, 10], 'a display is a user');
  assert.equal(s.globals.overlays, 13);
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

/* A state this build of the manager has no name for is printed as
   `<unknown state>`, which is not a state that is over anything. */
test('a state the manager could not name is not read as applied', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt')
    .replace('mState.................: STATE_ENABLED\n mIsEnabled.............: true\n mIsMutable.............: true\n mPriority..............: 1',
             'mState.................: <unknown state>\n mIsEnabled.............: true\n mIsMutable.............: true\n mPriority..............: 1'));
  const n = s.nodes.find((x) => x.state === '<unknown state>');

  assert.ok(n, 'the block still read');
  assert.equal(n.on, false);
  assert.equal(n.family, 'overlay-off');
});

/* A fabricated overlay is not a package on the device: the manager names it
   after the thing that made it, in the head line and again in the block. */
test('a fabricated overlay keeps the name it was registered under', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt'));
  const frro = s.nodes.find((n) => n.fabricated);

  assert.equal(frro.overlayPkg, 'com.android.systemui');
  assert.equal(frro.overlayName, 'ThemeOverlayController_accent');
  assert.equal(frro.title, 'com.android.systemui · ThemeOverlayController_accent');
  assert.equal(frro.identifier, 'com.android.systemui:ThemeOverlayController_accent');
  assert.equal(frro.userId, 0);
});

/* Android 16 holds an overlay to a display or a device. One that is held to
   another display is over nothing on this one, and no other field says so. */
test('a constrained overlay says what it is held to', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt'));
  const held = s.nodes.find((n) => n.title === 'com.example.cluster.theme');

  assert.deepEqual(held.constraints, ['display id 2']);
  assert.ok(held.badges.some((b) => b[0] === 'display id 2'));
  assert.equal(s.globals.constrained, 1);
  assert.equal(s.nodes.find((n) => n.title === 'com.example.kiosk.launcher').constraints.length, 0);
});

/* The manager prints the idmap of every overlay under the blocks, once per
   overlay rather than once per user. `<missing idmap>` is the whole of the
   answer to a STATE_NO_IDMAP, so the two are brought together. */
test('an idmap is read and hung on the overlay it belongs to', () => {
  const s = parseOverlayDump(read('fixtures/overlay-sample.txt'));
  const at = (title, user) => s.nodes.find((n) => n.title === title && n.userId === user);

  assert.equal(s.globals.idmaps, 4);
  assert.equal(s.globals.missingIdmaps, 1);

  const mapped = at('com.android.theme.icon_pack.rounded.android', 0);
  assert.equal(mapped.idmap.missing, false);
  assert.equal(mapped.idmap.mapped, 2);
  assert.equal(mapped.idmap.targetPath, '/system/framework/framework-res.apk');

  // the same idmap belongs to the same overlay for every user it is set up for
  assert.equal(at('com.android.theme.icon_pack.rounded.android', 10).idmap.mapped, 2);

  assert.equal(at('com.android.theme.color.cinnamon', 0).idmap.missing, true);
  assert.equal(at('com.example.kiosk.launcher', 10).idmap, null,
    'a dump that printed no idmap for one is not given another overlay\'s');
});

/* The idmaps and the configuration list are thousands of lines on a real
   device. Nothing of them may leak into the bag of lines this reader keeps
   for whatever a future build starts printing. */
test('what the reader could not account for is kept, and kept short', () => {
  const text = read('fixtures/overlay-sample.txt');
  assert.equal(parseOverlayDump(text).globals.tail, null,
    'every line of the sample was accounted for');
  assert.equal(parseOverlayDump(text).globals.configured, 3);

  const surprise = parseOverlayDump(text + '\n' +
    Array.from({ length: 40 }, (_, i) => `Something new ${i}`).join('\n'));
  assert.equal(surprise.globals.tail.split(' · ').length, 8, 'capped rather than dumped');
  assert.ok(surprise.globals.tail.startsWith('Something new 0'));
});

/* The blocks lost `mOverlayName` and `mConstraints` at different releases and
   the idmaps are printed by a service that can fail to print them at all. A
   dump without any of it is a dump this reader still reads. */
test('a dump from a build before Android 16 is read the same way', () => {
  const old = read('fixtures/overlay-sample.txt')
    .split('\n')
    .filter((l) => !/^\s*m(?:OverlayName|Constraints)\.+:/.test(l))
    .join('\n')
    .replace(/IDMAP OF [\s\S]*?(?=Default overlays:)/, '');
  const s = parseOverlayDump(old);

  assert.equal(s.ok, true);
  assert.equal(s.globals.overlays, 13);
  assert.equal(s.globals.idmaps, 0);
  assert.equal(s.globals.constrained, 0);
  // the head line still names a fabricated overlay when the block no longer does
  const frro = s.nodes.find((n) => n.fabricated);
  assert.equal(frro.overlayName, 'ThemeOverlayController_accent');
});

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
  const cut = read('fixtures/overlay-sample.txt').split('\n').slice(0, 8).join('\n');
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
    ['system log', 'radio log', 'kernel log']);
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

test('a crash is found by what the log itself says', () => {
  const s = parseLogcatDump(read('fixtures/logcat-sample.txt'));
  const crashed = [...new Set(s.nodes.filter((n) => n.crash).map((n) => n.tag))];
  assert.deepEqual(crashed.sort(), ['AndroidRuntime'],
    'FATAL EXCEPTION in the main log; the `am_crash` the framework logged for the'
    + ' same thing is in the event buffer, which this reader leaves alone');
  assert.equal(s.globals.crashes, 1);
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

/* ---------------- system properties ---------------- */

test('a property name is a namespace, a thing inside it, and the rest', () => {
  assert.equal(propNamespace('ro.build.version.sdk'), 'ro');
  assert.equal(propNamespace('selinux'), '', 'a name of one segment is in no namespace');
  assert.equal(propSectionOf('ro.build.version.sdk'), 'ro.build');
  assert.equal(propSectionOf('init.svc.adbd'), 'init.svc');
  assert.equal(propSectionOf('sys.boot_completed'), null, 'two segments is already its own thing');
  assert.equal(propSectionOf('selinux'), null);
  // `ro.` is not a convention: init refuses to set one of these twice
  assert.equal(propReadOnly('ro.debuggable'), true);
  assert.equal(propReadOnly('persist.sys.locale'), false);
  assert.equal(propReadOnly('vendor.ro.thing'), false, 'the prefix is the front of the name');
});

test('propFlag answers only for the values that are a finding', () => {
  assert.equal(propFlag('init.svc.adbd', 'running'), null);
  assert.equal(propFlag('init.svc.adbd', 'stopped'), 'stopped');
  assert.equal(propFlag('init.svc.vendor.sensors-hal', 'restarting'), 'restarting');
  assert.equal(propFlag('ro.debuggable', '0'), null);
  assert.equal(propFlag('ro.debuggable', '1'), 'debuggable');
  assert.equal(propFlag('ro.secure', '0'), 'insecure');
  assert.equal(propFlag('ro.adb.secure', '0'), 'adb unsecured');
  assert.equal(propFlag('ro.boot.flash.locked', '0'), 'bootloader unlocked');
  assert.equal(propFlag('ro.boot.verifiedbootstate', 'green'), null);
  assert.equal(propFlag('ro.boot.verifiedbootstate', 'orange'), 'verified boot orange');
  assert.equal(propFlag('ro.build.type', 'user'), null);
  assert.equal(propFlag('ro.build.type', 'userdebug'), 'userdebug');
  assert.equal(propFlag('ro.build.tags', 'release-keys'), null);
  assert.equal(propFlag('ro.build.tags', 'test-keys'), 'test-keys');
  assert.equal(propFlag('sys.boot_completed', '1'), null);
  assert.equal(propFlag('sys.boot_completed', ''), 'boot not completed');
  assert.equal(propFlag('ro.product.model', 'Pixel 7'), null, 'a fact is not a finding');
});

test('the property sample comes out as its namespaces, the biggest first', () => {
  const s = parseSystemPropertiesDump(read('fixtures/props-sample.txt'));

  assert.equal(s.ok, true);
  assert.equal(s.globals.count, 94);
  assert.equal(s.displays[0].label, 'ro', 'which on every device is the one holding what it is');
  assert.equal(s.displays.at(-1).label, 'no namespace', 'and a name with no dot in it still lands somewhere');
  const counts = s.displays.map((d) => d.nodes.filter((n) => n.prop).length);
  assert.deepEqual([...counts].sort((a, b) => b - a), counts, 'the strip is in the order of its own counts');
  assert.equal(counts.reduce((a, b) => a + b, 0), s.globals.count, 'every property is in exactly one group');
});

test('a section is opened by the first property in it and holds all of them', () => {
  const s = parseSystemPropertiesDump(read('fixtures/props-sample.txt'));
  const at = (title) => s.nodes.find((n) => n.title === title);

  const build = at('ro.build');
  assert.equal(build.propSection, true);
  assert.equal(build.subCount, 19);
  assert.equal(at('ro.build.fingerprint').parentHash, build.hash);
  assert.equal(at('ro.build.fingerprint').section, 'ro.build');
  // a two-segment name has nothing to hang under, and hangs under nothing
  assert.equal(at('sys.boot_completed').parentHash, null);
  assert.equal(at('selinux').parentHash, null);
  // the section reads as the run of lines it was printed as
  assert.equal(build.body.length, 19);
  assert.equal(build.bodyAt, build.at);
});

test('a row says which line of the file it came off', () => {
  const lines = read('fixtures/props-sample.txt').split('\n');
  const s = parseSystemPropertiesDump(lines.join('\n'));
  for (const n of s.nodes.filter((x) => x.prop)) {
    assert.equal(lines[n.at - 1], `[${n.name}]: [${n.value}]`,
      `${n.name} points at a line it was not printed on`);
  }
});

test('a value is whatever was between the brackets, brackets and all', () => {
  const s = parseSystemPropertiesDump([
    '[persist.test.rect]: [[0,0][1080,2400]]',
    '[persist.test.empty]: []',
    '[persist.test.colon]: [google/panther:14/UQ1A]',
    '[persist.test.spaces]: [Fri Jan  5 11:20:41 UTC 2024]',
  ].join('\n'));
  const value = (name) => s.nodes.find((n) => n.name === name).value;

  assert.equal(value('persist.test.rect'), '[0,0][1080,2400]');
  assert.equal(value('persist.test.empty'), '');
  assert.equal(value('persist.test.colon'), 'google/panther:14/UQ1A');
  assert.equal(value('persist.test.spaces'), 'Fri Jan  5 11:20:41 UTC 2024');
  assert.equal(s.nodes.find((n) => n.name === 'persist.test.empty').meta, '—',
    'an empty value is said to be empty rather than left as a blank row');
});

test('the globals are the answer to what device this is', () => {
  const g = parseSystemPropertiesDump(read('fixtures/props-sample.txt')).globals;

  assert.equal(g.fingerprint,
    'google/panther/panther:14/UQ1A.240105.004/11129216:user/release-keys');
  assert.equal(g.model, 'Pixel 7');
  assert.equal(g.device, 'panther');
  assert.equal(g.sdk, '34');
  assert.equal(g.release, '14');
  assert.equal(g.patch, '2024-01-05');
  assert.equal(g.buildType, 'user');
  assert.equal(g.firstApi, '33', 'which is not the SDK it is running now');
  assert.equal(g.locale, 'en-GB', 'what the user picked, not what the build shipped with');
  assert.equal(g.bootState, 'green');
  assert.equal(g.locked, '1');
  assert.equal(g.services, 11);
  assert.equal(g.servicesRunning, 8);
  assert.deepEqual(g.flagged.map((f) => f.name),
    ['init.svc.bootanim', 'init.svc.vendor.sensors-hal', 'init.svc.vendor.tcpdump_logger']);
});

test('a fingerprint is taken from whichever image printed one', () => {
  const g = parseSystemPropertiesDump([
    '[ro.vendor.build.fingerprint]: [google/panther/panther:14/UQ1A/9:user/release-keys]',
    '[ro.product.model]: [Pixel 7]',
  ].join('\n')).globals;
  assert.match(g.fingerprint, /^google\/panther/);
});

test('a text with no properties in it is not this dump', () => {
  assert.equal(parseSystemPropertiesDump('').ok, false);
  assert.equal(parseSystemPropertiesDump('Users:\n  UserInfo{0:null:13}').ok, false);
  assert.equal(parseSystemPropertiesDump('[not a property line').ok, false);
});

/* ---------------- the event log ---------------- */

test('a field list splits on its own commas and on nobody else\'s', () => {
  assert.deepEqual(eventSplit('0,5210,com.example').map((s) => s.trim()),
    ['0', '5210', 'com.example']);
  assert.deepEqual(eventSplit('0,[1,2],x').map((s) => s.trim()),
    ['0', '[1,2]', 'x'], 'a field holding a list of its own is one field');
  assert.deepEqual(eventSplit('a,(b,c)').map((s) => s.trim()), ['a', '(b,c)']);
});

test('a free-text field takes back the commas somebody typed into it', () => {
  const names = ['user', 'pid', 'process', 'flags', 'exception', 'message', 'file', 'line'];
  const { fields } = eventFields(
    '[0,5210,com.example,538968133,java.lang.IllegalStateException,' +
    'Overlay not permitted, and nothing to fall back on,Overlay.java,88]',
    names, 'message');

  assert.equal(fields.user, '0');
  assert.equal(fields.pid, '5210');
  assert.equal(fields.process, 'com.example');
  assert.equal(fields.exception, 'java.lang.IllegalStateException');
  assert.equal(fields.message, 'Overlay not permitted, and nothing to fall back on',
    'the space after the comma is the one somebody typed, not a separator');
  assert.equal(fields.file, 'Overlay.java', 'the fields after it are still counted from the end');
  assert.equal(fields.line, '88');
});

test('a tag that printed fewer fields than it declares is read as far as it goes', () => {
  const { fields } = eventFields('[0,5210]', ['user', 'pid', 'process'], null);
  assert.equal(fields.user, '0');
  assert.equal(fields.pid, '5210');
  assert.equal(fields.process, null, 'and the rest is missing rather than wrong');
});

test('a configuration mask is read as which part of the configuration changed', () => {
  assert.deepEqual(configChanges(1152), ['orientation', 'screenSize']);
  assert.deepEqual(configChanges(4), ['locale']);
  assert.deepEqual(configChanges(0), []);
  // the top bit is a bit, not a sign
  assert.deepEqual(configChanges(-2147483648), ['assetsPaths']);
  assert.deepEqual(configChanges('not a number'), []);
});

test('an activity is named by its package and the last part of its class', () => {
  assert.equal(shortComponent('com.android.settings/.homepage.SettingsHomepageActivity'),
    'com.android.settings/SettingsHomepageActivity');
  assert.equal(shortComponent('com.example/.MainActivity'), 'com.example/MainActivity');
  assert.equal(shortComponent('com.example'), 'com.example', 'a package on its own is itself');
  assert.equal(shortComponent(null), '');
});

test('the event sample comes out as sentences, filed by what kind of thing happened', () => {
  const s = parseEventLogDump(read('fixtures/events-sample.txt'));
  const at = (tag) => s.nodes.find((n) => n.tag === tag);

  assert.equal(s.ok, true);
  assert.equal(s.displays.length, 1, 'one buffer, one group');
  assert.equal(s.globals.events, s.nodes.length);
  assert.equal(at('am_proc_start').title, 'com.android.systemui started · pid 2914 · for activity');
  assert.equal(at('am_proc_start').kind, 'process');
  assert.equal(at('wm_activity_launch_time').title,
    'com.android.launcher3/QuickstepLauncher launched in 802 ms');
  assert.equal(at('configuration_changed').title, 'Configuration changed · orientation, screenSize');
  assert.equal(at('am_low_memory').title, 'Low memory · 42 processes left');
  assert.equal(at('am_kill').kind, 'trouble');
  assert.equal(at('am_kill').who, 'com.example.sync');
});

test('the same lifecycle event is read whether the build logs it as am_ or wm_', () => {
  const am = parseEventLogDump(
    '--------- beginning of events\n' +
    '09-21 11:02:12.995  1631  1668 I am_resume_activity: [0,220157453,4,com.example/.MainActivity]');
  const wm = parseEventLogDump(
    '--------- beginning of events\n' +
    '09-21 11:02:12.995  1631  1668 I wm_resume_activity: [0,220157453,4,com.example/.MainActivity]');

  assert.equal(am.nodes[0].title, 'com.example/MainActivity resumed');
  assert.equal(wm.nodes[0].title, am.nodes[0].title);
  assert.equal(wm.nodes[0].kind, 'activity');
});

test('a tag Telltale has never seen is still a line of the log', () => {
  const s = parseEventLogDump(read('fixtures/events-sample.txt'));
  const n = s.nodes.find((x) => x.tag === 'sysui_multi_action');

  assert.equal(n.kind, 'other');
  assert.equal(n.known, false);
  assert.equal(n.title, 'sysui_multi_action [757,803,799,ml,802,1,806,1]',
    'kept as it came rather than guessed at');
  assert.deepEqual(n.fields, {});
  assert.equal(n.parts.length, 8, 'and its fields are still there to read');
  assert.equal(s.globals.unknown, 1);
});

test('the globals answer what crashed, what hung and what the system took', () => {
  const g = parseEventLogDump(read('fixtures/events-sample.txt')).globals;

  assert.deepEqual(g.anrs.map((a) => a.who), ['com.example.tracker']);
  assert.deepEqual(g.crashes.map((c) => c.who), ['system_server', 'com.example.tracker']);
  assert.deepEqual(g.kills.map((k) => k.who), ['com.example.sync']);
  assert.equal(g.lowMemory, 1);
  assert.equal(g.started, 2);
  assert.equal(g.died, 1);
  assert.equal(g.configChanges, 1);
  assert.equal(g.boot.length, 11, 'and the marks the framework left on its way up');
  assert.equal(g.boot[g.boot.length - 1].step, 'screen enabled');
  assert.equal(g.boot[g.boot.length - 1].ms, '20038');
});

/* The event reader is handed the whole bugreport, and every other buffer in it
   is prose. A reader that took any threadtime line for an event would turn a
   system log into a few thousand events with tags it did not know. */
test('the prose in another buffer is not read as events', () => {
  const s = parseEventLogDump([
    '------ SYSTEM LOG (logcat -b main -v threadtime -d *:v) ------',
    '--------- beginning of main',
    '09-21 11:02:31.400  1631  1668 I ActivityManager: Start proc 5210:com.example/u0a233',
    '09-21 11:02:34.780  1631  1668 E ActivityManager: ANR in com.example.tracker',
    '09-21 11:02:34.781  1631  1668 I chatty  : uid=1000 expire 4 lines',
  ].join('\n'));

  assert.equal(s.ok, false, 'a system log is not this dump');
  assert.equal(s.nodes.length, 0);
});

test('an event tag printed outside the events buffer is still an event', () => {
  /* Which is what a pasted line or a vendor log that copied one looks like,
     and the tag is enough on its own to say what it is. */
  const s = parseEventLogDump(
    '09-21 11:02:34.780  1631  1668 I am_anr: [0,5210,com.example,0,Input dispatching timed out]');
  assert.equal(s.ok, true);
  assert.equal(s.nodes.length, 1);
  assert.equal(s.nodes[0].kind, 'trouble');
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

/* The properties are printed under a rule of their own, which is what scopes
   them — and the reason it has to is that a vendor section later in the same
   file often prints its own `getprop`, and those are not the store the section
   was taken at. */
test('a getprop printed again further down the file is another section', () => {
  const own = read('fixtures/props-sample.txt');
  const text = [
    '------ SYSTEM PROPERTIES ------',
    own.trimEnd(),
    '--------- 0.1s was the duration of system properties',
    '',
    '------ VENDOR PROPERTIES (getprop) ------',
    '[vendor.later.thing]: [1]',
    '[ro.later.thing]: [2]',
  ].join('\n');
  const s = parseSystemPropertiesDump(text);

  assert.equal(s.globals.count, 94, 'the section stopped at the rule under it');
  assert.ok(!s.nodes.some((n) => /\.later\./.test(n.title)));

  /* The same properties, off the same lines, as the dump read on its own —
     only shifted by the rule that now sits above them. */
  const alone = parseSystemPropertiesDump(own);
  assert.deepEqual(s.nodes.map((n) => n.title), alone.nodes.map((n) => n.title));
  assert.deepEqual(s.nodes.map((n) => n.at), alone.nodes.map((n) => n.at + 1),
    'and a row still says which line of the whole file it came off');
});

test('a pasted getprop has no rule above it and is read whole', () => {
  const s = parseSystemPropertiesDump(read('fixtures/props-sample.txt'));
  assert.equal(s.globals.count, 94);
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

/* `getevent -lt /dev/input/event2` watches one device and so prints no node in
   front of its events. That is the form anyone reaches for once they know
   which node the panel is, and it is the form a reader keyed on `/dev/input/`
   silently reads as nothing at all. */

const gevBare = read('fixtures/getevent-bare-sample.txt');

test('a capture taken with a device argument reads, node or no node', () => {
  const s = parseGeteventCapture(gevBare);
  assert.equal(s.displays.length, 1);
  const panel = s.displays[0];
  /* Nothing in the capture says which device it was, so nothing claims one. */
  assert.equal(panel.path, '');
  assert.equal(panel.label, 'unnamed device');
  assert.deepEqual(s.nodes.filter((n) => n.stroke).map((n) => n.kind),
    ['tap', 'swipe up']);
});

test('the command that took a node-less capture names the device it came off', () => {
  const s = parseGeteventCapture(
    `generic:/ # getevent -lt /dev/input/event2\n${gevBare}`);
  assert.equal(s.displays.length, 1);
  assert.equal(s.displays[0].label, 'event2');
  assert.equal(s.displays[0].nodes.filter((n) => n.stroke).length, 2);
});

/* `getevent -lp` above the capture describes the whole input stack, of which
   exactly one device reports positions. A node-less capture is that device's:
   there is nowhere else for it to have come from. */
test('ranges pasted above a node-less capture are the capture\'s own', () => {
  const head = read('fixtures/getevent-sample.txt').split('\n')
    .slice(0, 14).join('\n');
  const s = parseGeteventCapture(`${head}\n${gevBare}`);
  const panel = s.displays.find((d) => d.strokes);
  assert.equal(panel.label, 'event2');
  assert.equal(panel.name, 'fts_ts');
  assert.deepEqual(panel.size, { w: 1080, h: 2340 });
  assert.equal(panel.synthesised, false);
});

/* Three hex words are not an event. Without a stamp, a node or an `EV_` label
   there is nothing in a line to tell a capture from any other text. */
test('a line with nothing but three hex words is not read as an event', () => {
  const s = parseGeteventCapture('0003 0035 0000001a\n0000 0000 00000000\n');
  assert.equal(s.ok, false);
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
