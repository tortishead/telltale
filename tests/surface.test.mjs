/* One window as three services describe it.
 *
 * `dumpsys window` says where the policy put it, SurfaceFlinger says what was
 * composited, `dumpsys input` says what the dispatcher will hit-test, and the
 * bug is usually that two of them disagree. These are the disagreements the
 * page is supposed to find, and the shapes of name that have to be read as one
 * window before it can find any of them.
 *
 * The bugreport fixture is a real device's three dumps of one moment. The two
 * dumps written out below are the one case a fixture off a working device
 * cannot hold: a window the policy believes is showing and the compositor drew
 * at alpha 0.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openPage } from '../tools/page-harness.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const bytes = readFileSync(dir('fixtures/bugreport-sample.zip'));

async function report(){
  const page = openPage();
  const { text, label, from } = await page.readDump(new File([bytes], 'bugreport.zip'));
  await page.load(text, null, from || label, from ? label : null);
  /* Open the reader, the display and the node the way the pane has them when
     it draws the card: the card reads the open document to decide which of the
     dumps on the desk are readings of the same file. */
  page.at = (toolId, title) => {
    const doc = page.docs().find((d) => d.found[0].tool.id === toolId);
    const entry = doc.found[0];
    for(const display of entry.scene.displays){
      const node = display.nodes.find((n) => n.title === title);
      if(!node) continue;
      page.open(doc);
      page.display(display.id);
      page.select(node.hash);
      return { doc, entry, display, node };
    }
    throw new Error(`${toolId} has no node called ${title}`);
  };
  return page;
}

const plain = (s) => String(s).replace(/<[^>]+>/g, '');
const titles = (found) => found.map(([title]) => plain(title));

test('one window is three readings, left to right as the stack is described', async () => {
  const page = await report();
  const at = page.at('window', 'NavigationBar0');
  const sides = page.sides(at.node, at.display);
  assert.deepEqual(sides.map((s) => s.entry.tool.id), ['window', 'sf', 'input'],
    'laid out, then composited, then hit-tested');
  assert.ok(sides.every((s) => s.node), 'and all three of them have this window');
});

/* The three services spell one name three ways: the compositor hangs the layer
   id on the end, the dispatcher hangs its handle on the front. */
test('a layer id and an input handle are not part of the name', async () => {
  const page = await report();
  for(const title of ['NavigationBar0', 'StatusBar', 'InputMethod']){
    const at = page.at('window', title);
    const sides = page.sides(at.node, at.display);
    assert.equal(sides.filter((s) => s.node).length, 3, `${title} was matched in all three`);
    assert.equal(sides[1].node.title, `${title}#${sides[1].node.layerId}`,
      'the layer carries its layer id and is still the same window');
  }
});

test('frames that disagree are grouped by the rect, not listed by the reader', async () => {
  const page = await report();
  const at = page.at('window', 'NavigationBar0');
  const found = page.findings(at.node, at.display);
  const frames = found.find(([title]) => plain(title) === 'The frames disagree');
  assert.ok(frames, 'the input dump has this one 48px lower and 60px taller');
  const why = plain(frames[1]);
  assert.match(why, /Windows and SurfaceFlinger have it at \[0,2208\]\[1080,2340\]/,
    'the two that agree are one voice');
  assert.match(why, /Input windows has it at \[0,2256\]\[1080,2400\]/);
});

test('a window stacked either side is said once, not once per pair of readers', async () => {
  const page = await report();
  const at = page.at('window', 'NavigationBar0');
  const found = page.findings(at.node, at.display).filter(
    ([title]) => plain(title).includes('stacked either side'));
  assert.equal(found.length, 1, 'three readers are three pairs and one finding');
  assert.match(plain(found[0][0]), /StatusBar/);
  assert.match(plain(found[0][1]), /Input windows has it above this window/);
  assert.match(plain(found[0][1]), /Windows and SurfaceFlinger have it below/);
});

test('a reader that has no window of this name says so, and calls it nothing worse', async () => {
  const page = await report();
  const at = page.at('window', 'com.example.player/com.example.player.MainActivity');
  const sides = page.sides(at.node, at.display);
  assert.deepEqual(sides.filter((s) => !s.node).map((s) => s.entry.tool.id), ['input']);

  const html = page.detail();
  assert.match(html, /The same window elsewhere/, 'two readings are still worth a table');
  assert.match(html, /No window of this name in Input windows/);
  /* Absence is not a finding: a service that renames what it holds looks the
     same from here as one that never had it. */
  assert.ok(!titles(page.findings(at.node, at.display)).some((t) => /Input windows/.test(t)));
});

/* ---------------- the case a working device cannot produce ---------------- */

const WINDOWS = `WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)
  Display: mDisplayId=0 rootDisplayAreaId=0
    init=1080x2340 420dpi cur=1080x2340 app=1080x2340 rng=1080x1005-2210x2135

WINDOW MANAGER WINDOWS (dumpsys window windows)
  Window #0 Window{aa11bb2 u0 com.example.ghost/com.example.ghost.MainActivity}:
    mDisplayId=0 rootTaskId=7 mSession=Session{cc33dd4 4242:10233} mClient=android.os.BinderProxy@1
    mOwnerUid=10233 package=com.example.ghost appop=NONE
    mAttrs={(0,0)(fillxfill) ty=BASE_APPLICATION fmt=TRANSLUCENT}
    Requested w=1080 h=2340 mLayoutSeq=10
    mBaseLayer=21000 mSubLayer=0    mToken=ActivityRecord{ee55ff6 u0 com.example.ghost/.MainActivity t7}
    mViewVisibility=0x0 mHaveFrame=true mObscured=false
    mHasSurface=true isReadyForDisplay()=true mWindowRemovalAllowed=false
    Frames: containing=[0,0][1080,2340] parent=[0,0][1080,2340]
        display=[0,0][1080,2340]
        frame=[0,0][1080,2340] last=[0,0][1080,2340]
    isOnScreen=true
    isVisible=true
`;

/* The same window, composited at alpha 0 — `color=(r,g,b,a)` with the alpha
   last, which is where SurfaceFlinger puts it. */
const LAYERS = `Display Devices:
+ DisplayDevice: Built-in Screen
   type=0, hwcId=0, layerStack=0, (1080x2340), ANativeWindow=0x1, orient=  0 (type=0), flips=1, isSecure=1, isVirtual=0, powerMode=2, activeConfig=0, numLayers=1
   v:[0,0,1080,2340], f:[0,0,1080,2340], s:[0,0,1080,2340], transform:-2 (0)

Visible layers (count = 1)
Total layers (count = 1)

+ BufferStateLayer (com.example.ghost/com.example.ghost.MainActivity#4) uid=10233
  Region TransparentRegion (this=0x0 count=0)
  Region VisibleRegion (this=0x0 count=1)
    [    0,    0, 1080, 2340]
  Region SurfaceDamageRegion (this=0x0 count=0)
      layerStack=   0, z=    21000, pos=(0,0), size=(1080,2340), crop=[0, 0, 1080, 2340], cornerRadius=0.000000, isProtected=0, isTrustedOverlay=0, isOpaque=0, invalidate=0, dataspace=BT709 sRGB Full range, defaultPixelFormat=RGBA_8888, backgroundBlurRadius=0, color=(0.000,0.000,0.000,0.000), flags=0x00000000, tr=[1.00, 0.00][0.00, 1.00]
      parent=none
      zOrderRelativeOf=none
      activeBuffer=[1080x2340:1088,  1], tr=[1.00, 0.00][0.00, 1.00] queued-frames=0, mRefreshPending=0
`;

async function pasted(files){
  const page = openPage();
  for(const [label, text] of files) await page.load(text, null, label);
  return page;
}

test('two dumps pasted one at a time are still one window', async () => {
  const page = await pasted([['windows.txt', WINDOWS], ['layers.txt', LAYERS]]);
  const doc = page.docs().find((d) => d.found[0].tool.id === 'window');
  const display = doc.found[0].scene.displays[0];
  const node = display.nodes[0];
  page.open(doc);
  page.select(node.hash);

  const sides = page.sides(node, display);
  assert.deepEqual(sides.map((s) => s.entry.tool.id), ['window', 'sf'],
    'a reader read once on the desk is that reader, whatever file it came out of');

  const found = titles(page.findings(node, display));
  assert.ok(found.includes('Windows says it is showing'),
    'the policy believes the window is up');
  assert.ok(found.includes('SurfaceFlinger drew it at alpha 0'),
    'and nothing of it reached the panel');

  const html = page.detail();
  assert.match(html, /layers\.txt/, 'a column off another file says which file');
});

test('a window dump on its own draws no table of one column', async () => {
  const page = await pasted([['windows.txt', WINDOWS]]);
  const doc = page.docs()[0];
  const display = doc.found[0].scene.displays[0];
  page.open(doc);
  page.select(display.nodes[0].hash);
  assert.ok(!page.detail().includes('The same window elsewhere'),
    'one reading of one window is the tab you are already reading');
});

/* A desk holding the same reader twice is a before-and-after desk, and a
   window from one file must never be diffed against a layer from the other. */
test('two readings of one reader are told apart by the file they came from', async () => {
  const page = await pasted([
    ['before.txt', WINDOWS],
    ['after.txt', WINDOWS.replace('isVisible=true', 'isVisible=false')],
    ['layers.txt', LAYERS],
  ]);
  const after = page.docs().find((d) => d.label === 'after.txt');
  const display = after.found[0].scene.displays[0];
  const node = display.nodes[0];
  page.open(after);
  page.select(node.hash);

  const sides = page.sides(node, display);
  assert.deepEqual(sides.map((s) => s.doc.label), ['after.txt', 'layers.txt'],
    'the window column is the file being read, not the other one on the desk');
  assert.ok(!titles(page.findings(node, display)).includes('Windows says it is showing'),
    'and this reading says the window is gone, which the layer agrees with');
});
