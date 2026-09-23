/* ================ parse: dumpsys input ================ */

/* `dumpsys input` is three dumps printed one after another: what the manager
   itself is set to, the devices the reader found, and the windows the
   dispatcher hands events to. The windows sit on a display, carry a frame and
   stack in an order, so they are drawn; a device sits nowhere, so it is read.
   That is two scenes out of one text, and the page already knows how to hold
   several readers for one dump, so this file registers two rather than
   inventing a third kind of pane.

   The dispatcher's window line has been rewritten twice. Android 12 and
   earlier printed `flags=`, `type=` and `inputFeatures=` as hex, Android 13
   replaced all three with the `inputConfig=` name list, and both spellings
   turn up in the bugreports people still open. Everything below reads the
   older spelling into the newer names, so one vocabulary reaches the panes and
   an old dump answers the same questions as a new one. */

/* The source of an event is a bitmask whose low bits are the class of device
   it came from, and a dump prints it either as those names or as the raw hex.
   The class bits are part of every source that contains them, so a source is
   only present when all of its bits are. */
const INPUT_SOURCES = [
  ['KEYBOARD', 0x00000101], ['DPAD', 0x00000201], ['GAMEPAD', 0x00000401],
  ['TOUCHSCREEN', 0x00001002], ['MOUSE', 0x00002002], ['STYLUS', 0x00004002],
  ['BLUETOOTH_STYLUS', 0x0000c002], ['TRACKBALL', 0x00010004],
  ['MOUSE_RELATIVE', 0x00020004], ['TOUCHPAD', 0x00100008],
  ['TOUCH_NAVIGATION', 0x00200000], ['ROTARY_ENCODER', 0x00400000],
  ['JOYSTICK', 0x01000010], ['HDMI', 0x02000001], ['SENSOR', 0x04000000],
];

/* What a device is for, in the order a device that answers to several should
   be called: a stylus-capable touchscreen is a touchscreen. */
const INPUT_KINDS = [
  [/TOUCHSCREEN/, 'touchscreen', 'input-touch'],
  [/TOUCHPAD|TOUCH_NAVIGATION/, 'touchpad', 'input-touch'],
  [/MOUSE|TRACKBALL/, 'pointer', 'input-pointer'],
  [/JOYSTICK|GAMEPAD/, 'joystick', 'input-stick'],
  [/ROTARY_ENCODER/, 'rotary', 'input-stick'],
  [/STYLUS/, 'stylus', 'input-touch'],
  [/SENSOR/, 'sensor', 'input-sensor'],
  [/KEYBOARD|DPAD/, 'keyboard', 'input-key'],
];

const INPUT_KEYBOARD_TYPES = { 0:'none', 1:'non-alphabetic', 2:'alphabetic', 3:'alphabetic' };

/* `INTERNAL` is how a viewport names itself and `Internal` is how a display
   picker reads. The render layer has its own `cap`, which the parse layer is
   not allowed to reach forward into. */
const inputCap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

function inputSources(field) {
  const raw = String(field == null ? '' : field).trim();
  const hex = raw.match(/^0x([0-9a-fA-F]+)$/);
  if (!hex) {
    const names = raw.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
    return { names, mask: null, raw };
  }
  const mask = parseInt(hex[1], 16);
  const names = INPUT_SOURCES.filter(([, bits]) => bits && (mask & bits) === bits)
    .map(([name]) => name);
  return { names, mask, raw };
}

function inputKind(names) {
  const hay = names.join(' ');
  for (const [re, label, family] of INPUT_KINDS) {
    if (re.test(hay)) return { label, family };
  }
  return { label: names.length ? 'other' : 'unknown', family: 'input-device' };
}

/* `Window{9a1b2c3 u0 StatusBar}` on the older builds, `9a1b2c3 StatusBar` on
   the newer ones. Either way the leading word is the handle the rest of the
   dump names this window by, which is what selection and the focus line join
   on, so it is worth pulling out of the title rather than left in it. */
function inputWindowName(name) {
  const s = String(name == null ? '' : name).trim();
  const brace = s.match(/^\w+\{(\S+)(?:\s+(u\d+))?\s+(.*)\}$/);
  if (brace) return { hash: brace[1], user: brace[2] || null, title: brace[3] };
  const bare = s.match(/^([0-9a-f]{4,10})\s+(.+)$/);
  if (bare) return { hash: bare[1], user: null, title: bare[2] };
  return { hash: null, user: null, title: s };
}

/* A touchable region is printed as the rects it is made of, joined by bars, or
   as `<empty>` when the window takes no touches at all. */
function inputRegion(field) {
  const s = String(field == null ? '' : field);
  if (!s || /<empty>/.test(s)) return [];
  const out = [];
  const re = /\[(-?\d+),\s*(-?\d+)\]\[(-?\d+),\s*(-?\d+)\]/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push(rectFrom(m, 1));
  return out;
}

/* The three older fields, read into the names the newer dump prints. Only the
   bits that decide whether an event reaches the window are translated: the
   rest of `flags` is a WindowManager concern the window reader already tells
   you about, and repeating half of it here under a different name would be
   worse than leaving it out. */
const INPUT_OLD_FLAGS = [[0x8, 'NOT_FOCUSABLE'], [0x10, 'NOT_TOUCHABLE'],
                         [0x40000, 'WATCH_OUTSIDE_TOUCH']];
const INPUT_OLD_FEATURES = [[0x1, 'NO_INPUT_CHANNEL'], [0x2, 'DISABLE_USER_ACTIVITY'],
                            [0x4, 'SPY']];

function inputConfigOf(line) {
  const named = line.match(/inputConfig=([^,]*)/);
  if (named) {
    return named[1].trim().split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  }
  const out = [];
  const bits = (re, table) => {
    const m = line.match(re);
    if (!m) return;
    const v = parseInt(m[1], 16);
    if (!Number.isFinite(v)) return;
    for (const [bit, name] of table) if (v & bit) out.push(name);
  };
  bits(/(?:^|[\s,])flags=0x([0-9a-fA-F]+)/, INPUT_OLD_FLAGS);
  bits(/inputFeatures=0x([0-9a-fA-F]+)/, INPUT_OLD_FEATURES);
  const vis = line.match(/\b(?:is)?[Vv]isible=(true|false)/);
  if (vis && vis[1] === 'false') out.push('NOT_VISIBLE');
  return out;
}

/* Viewports are the only place in the whole dump that states how big a display
   is, so they are what the sheet draws its screen from. A dump taken without
   them still draws — the displays fall back to how far their own windows
   reach — but it draws a screen the size of the windows on it. */
const INPUT_VIEWPORT_RE =
  /Viewport\s+(\w+):\s*displayId=(-?\d+)(?:,\s*uniqueId=(\S*?))?,[^\n]*?orientation=(-?\d+)[^\n]*?logicalFrame=\[(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\]/g;

function inputViewports(text) {
  const out = new Map();
  let m;
  INPUT_VIEWPORT_RE.lastIndex = 0;
  while ((m = INPUT_VIEWPORT_RE.exec(text)) !== null) {
    const id = +m[2];
    if (out.has(id)) continue;
    const l = +m[5], t = +m[6], r = +m[7], b = +m[8];
    out.set(id, {
      id,
      type: m[1],
      uniqueId: m[3] && m[3] !== ',' ? m[3].replace(/,$/, '') : null,
      rotation: String(+m[4]),
      size: r > l && b > t ? { w: r - l, h: b - t } : null,
    });
  }
  return out;
}

/* A bugreport is every dumpsys one after another in one file, and this parser
   is handed all of it. So each half of `dumpsys input` is read inside its own
   section rather than by scanning to the end of the file, where another
   service's `Device 3: ...` would be read as one of the reader's. A section
   ends at the next thing that is plainly a heading: a sibling of its own, a
   bugreport rule, or the line naming the next service. */
const INPUT_SECTION_END = new RegExp(
  '^(?:\\s*(?:Input Dispatcher State|Input Reader State|Input Manager State'
  + '|Event Hub State|Input Manager Service)\\b|' + DUMP_BOUNDARY + ')');

/* Unlike the other two, a missing heading here is an answer: the dispatcher's
   half and the reader's half are both in `dumpsys input`, so a text that
   states neither is not this reader's to read at all. */
const inputSection = (lines, headRe) => sectionSpan(lines, headRe, INPUT_SECTION_END, 'none');

/* A window line, and nothing else that happens to start with a number: the
   touch state lists its windows in the same shape and the monitors list its
   channels in another, and neither of them states a frame. */
/* The name is quoted through Android 15 and printed bare from 16 on, so the
   quotes are optional and the bare form simply ends at its comma. */
const INPUT_WIN_RE = /^(\s*)(\d+)\s*:\s*name='?(.*?)'?,(.*\bframe=\[.*)$/;
const INPUT_DISPLAY_RE = /^\s*Display:\s*(-?\d+)\s*$/;
const INPUT_MON_HEAD_RE = /^(\s*)(?:Global monitors on display\s+(-?\d+)|displayId=(-?\d+),\s*gesture monitors)/;
const INPUT_MON_RE = /^\s*(?:monitor\s+)?(\d+)\s*:\s*'([^']*)'(.*)$/;

const INPUT_BIG_ALPHA = 0.001;   // what SurfaceFlinger still calls opaque enough to block a touch

function inputContains(a, b) {
  return a.l <= b.l && a.t <= b.t && a.r >= b.r && a.b >= b.b;
}

/* The question this dump gets opened with is why a touch went somewhere other
   than where it was aimed. A window that can take touch, sitting under one
   whose touchable region covers all of it, is the answer often enough to be
   worth saying on the row rather than leaving to be worked out from eight
   rects. A spy sees a touch without consuming it, so it never covers. */
function inputCoverage(nodes) {
  const eats = (n) => n.touchable && !n.spy && n.regions.length;
  for (const n of nodes) {
    if (!eats(n)) continue;
    const above = nodes.filter((m) => m !== n && m.displayId === n.displayId
                                   && m.z > n.z && eats(m));
    n.coveredBy = above.find((m) =>
      n.regions.every((rc) => m.regions.some((mr) => inputContains(mr, rc)))) || null;
  }
}

/* An untrusted overlay in front of a window is the state a window asking for
   DROP_INPUT_IF_OBSCURED is guarding against, so which windows are in that
   state is worked out rather than left as a flag that might mean nothing. */
function inputObscured(nodes) {
  const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  for (const n of nodes) {
    if (!n.dropsIfObscured || !n.frame) continue;
    n.obscuredBy = nodes.find((m) => m !== n && m.displayId === n.displayId
      && m.z > n.z && m.occludes && m.frame && overlaps(m.frame, n.frame)) || null;
  }
}

function parseInputDump(input) {
  const text = dumpText(input);
  const lines = text.split('\n');
  const viewports = inputViewports(text);

  const nodes = [];
  const focusByDisplay = new Map();
  const appByDisplay = new Map();
  const touchByDisplay = new Map();

  /* Which display a window is on is on the window's own line; the `Display:`
     heading above it is there for the builds that print the heading and leave
     the field off the line. */
  let head = null, monDisplay = null, monIndent = -1, touchAt = null;
  const monitors = [];

  /* Where the dispatcher's own section is. A dump pasted without its heading
     is still read — the window line is specific enough to find on its own —
     but a file that has the heading is read only between its bounds. */
  const span = inputSection(lines, /^\s*Input Dispatcher State\b/)
            || { start: -1, end: lines.length };

  for (let i = span.start + 1; i < span.end; i++) {
    const line = lines[i];
    const dm = line.match(INPUT_DISPLAY_RE);
    if (dm) { head = +dm[1]; touchAt = null; continue; }

    const mh = line.match(INPUT_MON_HEAD_RE);
    if (mh) {
      monDisplay = +(mh[2] !== undefined ? mh[2] : mh[3]);
      monIndent = mh[1].length;
      touchAt = null;
      continue;
    }
    if (monDisplay !== null && line.trim() && indentOf(line) <= monIndent) monDisplay = null;

    const wm = line.match(INPUT_WIN_RE);
    if (wm) {
      nodes.push(inputWindowNode(wm, i + 1, head, lines));
      continue;
    }

    if (monDisplay !== null) {
      const mm = line.match(INPUT_MON_RE);
      if (mm) {
        monitors.push({ display: monDisplay, index: +mm[1], name: mm[2],
                        tail: mm[3] || '', at: i + 1, raw: line.trim() });
      }
      continue;
    }

    const fw = line.match(/^\s*displayId=(-?\d+),\s*name='(.*)'\s*$/);
    if (fw) { focusByDisplay.set(+fw[1], fw[2]); continue; }

    const fa = line.match(/^\s*displayId=(-?\d+),\s*name='(.*)',\s*dispatchingTimeout=(\S+)\s*$/);
    if (fa) { appByDisplay.set(+fa[1], { name: fa[2], timeout: fa[3] }); continue; }

    const ts = line.match(/^\s*displayId=(-?\d+),\s*down=(\w+)(.*)$/);
    if (ts) {
      const tail = ts[3];
      touchAt = {
        down: ts[2] === 'true',
        split: /split=true/.test(tail),
        deviceId: (tail.match(/deviceId=(-?\d+)/) || [])[1] || null,
        source: (tail.match(/source=(\S+?)(?:,|$)/) || [])[1] || null,
        windows: [],
      };
      touchByDisplay.set(+ts[1], touchAt);
      continue;
    }

    /* The windows a touch is going to right now are listed under the state
       that owns them, in the same `n: name=` shape a window line has and with
       no frame on them, so they are picked up here rather than above. */
    const tw = touchAt && line.match(/^\s*\d+\s*:\s*name='?(.*?)'?,\s*pointerIds=/);
    if (tw) touchAt.windows.push(inputWindowName(tw[1]).hash || tw[1]);
  }

  for (const m of monitors) {
    nodes.push({
      hash: `input:mon:${m.display}:${m.index}`,
      title: m.name,
      displayId: m.display,
      frame: null, frameSource: null,
      /* A global monitor is handed every touch on its display before any
         window sees it, so it belongs above all of them. */
      z: 1e6 - m.index,
      family: 'input-monitor', typeLabel: 'global monitor',
      badges: [['sees every touch', 'badge-comp']],
      search: `${m.name} monitor ${m.raw}`.toLowerCase(),
      raw: m.raw, at: m.at,
      visible: true, focused: false,
      monitor: true, index: m.index,
      config: [], regions: [], touchable: true, spy: false,
      ownerPid: (m.tail.match(/ownerPid=(?:Pid\{)?(-?\d+)/) || [])[1] || null,
      ownerUid: (m.tail.match(/ownerUid=(?:Uid\{)?(-?\d+)/) || [])[1] || null,
    });
  }

  /* Focus is stated by name, once per display, and the name is the one the
     window's own line carries, so the join is on the handle in it. */
  const focusHash = new Map();
  for (const [id, name] of focusByDisplay) focusHash.set(id, inputWindowName(name).hash || name);
  for (const n of nodes) {
    const want = focusHash.get(n.displayId);
    n.focused = !!want && !n.monitor && (n.handle ? n.handle === want : n.title === want);
  }

  inputCoverage(nodes);
  inputObscured(nodes);

  for (const n of nodes) {
    if (n.monitor) continue;
    const touching = (touchByDisplay.get(n.displayId) || { windows: [] }).windows;
    n.touched = !!n.handle && touching.includes(n.handle);
    inputClassify(n);
    n.badges = inputBadges(n);
  }

  const sizeHints = new Map();
  for (const [id, v] of viewports) if (v.size) sizeHints.set(id, v.size);

  const blocks = [];
  for (const [id, v] of viewports) {
    /* A viewport with no window on it is still a display the dispatcher knows
       about, and a display with nothing to dispatch to is itself an answer. */
    blocks.push({
      id, name: v.type ? inputCap(v.type) : null,
      size: v.size, rotation: v.rotation, uniqueId: v.uniqueId,
      viewportType: v.type, insets: [], raw: '',
    });
  }
  const byId = buildDisplays(blocks, nodes, sizeHints);
  for (const d of byId.values()) {
    d.focus = focusByDisplay.get(d.id) || null;
    d.focusedApp = (appByDisplay.get(d.id) || {}).name || null;
    d.dispatchTimeout = (appByDisplay.get(d.id) || {}).timeout || null;
    d.touch = touchByDisplay.get(d.id) || null;
  }

  const one = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const bool = (re) => { const v = one(re); return v === null ? null : /^(true|1)$/i.test(v); };
  const globals = {
    dispatchEnabled: bool(/^\s*DispatchEnabled:\s*(\S+)\s*$/m),
    dispatchFrozen: bool(/^\s*DispatchFrozen:\s*(\S+)\s*$/m),
    inputFilter: bool(/^\s*InputFilterEnabled:\s*(\S+)\s*$/m),
    focusedDisplay: one(/^\s*FocusedDisplayId:\s*(-?\d+)\s*$/m),
    interactive: bool(/^\s*Interactive:\s*(\S+)\s*$/m),
    showTouches: bool(/^\s*Show Touches:\s*(\S+)\s*$/m),
    pointerCapture: one(/^\s*Pointer Capture:\s*(.+)$/m),
    pointerSpeed: one(/^\s*Pointer Speed:\s*(-?\d+)\s*$/m),
    appSwitch: one(/^\s*AppSwitch:\s*(.+)$/m),
    keyRepeatTimeout: one(/^\s*KeyRepeatTimeout:\s*(\S+)\s*$/m),
    keyRepeatDelay: one(/^\s*KeyRepeatDelay:\s*(\S+)\s*$/m),
    windows: nodes.filter((n) => !n.monitor).length,
    monitors: monitors.length,
    viewports: viewports.size,
    /* Whether this dump's windows were printed in the newer vocabulary, which
       is what decides how much of a window's behaviour it can be asked. */
    named: nodes.some((n) => n.config && n.config.length && !n.monitor),
  };

  return finaliseScene('input', [...byId.values()], nodes, globals);
}

/* One window, out of the line that states it and the transform printed under
   it. The line is one long list of `key=value`, so the fields are picked out
   by name and the ones a build does not print are simply absent. */
function inputWindowNode(m, at, headDisplay, lines) {
  const line = m[0];
  const tail = m[4];
  const named = inputWindowName(m[3]);
  const config = inputConfigOf(line);
  const has = (f) => config.includes(f);

  const num = (re) => { const v = line.match(re); return v ? +v[1] : null; };
  const str = (re) => { const v = line.match(re); return v && v[1].trim() ? v[1].trim() : null; };

  const displayId = num(/[\s,]displayId=(-?\d+)/) ?? (headDisplay === null ? 0 : headDisplay);
  const frame = (tail.match(/\bframe=\[(-?\d+),\s*(-?\d+)\]\[(-?\d+),\s*(-?\d+)\]/) || null);
  const rect = frame ? rectFrom(frame, 1) : null;
  const regionText = (tail.match(/touchableRegion=(<empty>|(?:\[-?\d+,\s*-?\d+\]\[-?\d+,\s*-?\d+\]\|?)+)/) || [])[1];
  const regions = inputRegion(regionText);
  const alpha = num(/\balpha=([\d.]+)/);
  const occlusion = str(/touchOcclusionMode=(\w+)/);
  const visible = !has('NOT_VISIBLE');
  const touchable = !has('NOT_TOUCHABLE') && !has('NO_INPUT_CHANNEL') && visible
                 && (regions.length > 0 || regionText === undefined);

  const handle = named.hash;
  const node = {
    hash: `input:win:${displayId}:${handle || at}`,
    handle,
    title: named.title || m[3] || 'window',
    user: named.user,
    displayId,
    index: +m[2],
    frame: rectValid(rect) ? rect : null,
    frameSource: 'input window',
    z: -m[2],
    visible,
    focused: false,
    at,
    raw: [line.trim(), ...inputTransform(lines, at)].join('\n'),
    config,
    regions,
    regionText: regionText === undefined ? null : regionText,
    id: num(/\bid=(-?\d+)/),
    ownerPid: num(/ownerPid=(?:Pid\{)?(-?\d+)/),
    ownerUid: num(/ownerUid=(?:Uid\{)?(-?\d+)/),
    appName: str(/applicationInfo\.name=([^,]*)/),
    alpha,
    globalScale: num(/globalScale=([\d.]+)/),
    timeout: str(/dispatchingTimeout=(\S+?),/) || str(/dispatchingTimeout=(\S+)\s*$/),
    hasToken: /hasToken=true/.test(line) ? true : /hasToken=false/.test(line) ? false : null,
    occlusion,
    touchable,
    spy: has('SPY'),
    wallpaper: has('IS_WALLPAPER'),
    /* Two different things: one window is never delivered to, the other is
       only not delivered to while something is in front of it. */
    dropsAlways: has('DROP_INPUT'),
    dropsIfObscured: has('DROP_INPUT_IF_OBSCURED'),
    obscuredBy: null,
    trusted: has('TRUSTED_OVERLAY'),
    monitor: false,
    coveredBy: null,
    touched: false,
  };

  /* An overlay a third party put up, still opaque enough to be counted, is the
     one thing in this dump that can stop a touch reaching the app under it
     without appearing to do anything at all. */
  node.occludes = occlusion === 'USE_OPACITY' && !node.trusted
               && alpha !== null && alpha > INPUT_BIG_ALPHA;

  node.search = `${node.title} ${handle || ''} ${node.appName || ''} ${config.join(' ')} ${
    node.ownerUid === null ? '' : 'uid ' + node.ownerUid}`.toLowerCase();
  node.badges = [];
  /* What it is called and what colour it is drawn in wait for the pass that
     knows about the other windows: whether this one is dropping its events
     depends on whether anything is obscuring it. */
  return node;
}

function inputClassify(n){
  n.dropping = n.dropsAlways || (n.dropsIfObscured && !!n.obscuredBy);
  n.family = n.spy ? 'input-spy'
    : n.wallpaper ? 'input-wallpaper'
    : n.dropping ? 'input-drop'
    : !n.touchable ? 'input-untouchable'
    : 'input-window';
  n.typeLabel = n.spy ? 'spy'
    : n.wallpaper ? 'wallpaper'
    : n.dropping ? 'drops input'
    : !n.touchable ? 'not touchable'
    : 'takes touch';
}

/* The transform printed under a window line, which is the only part of a
   window's block that is not on the line itself. */
function inputTransform(lines, at) {
  const out = [];
  for (let i = at; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || !/^\s*(?:transform|applicationInfo|windowToken)/.test(line)) break;
    out.push(line.trim());
  }
  return out;
}

function inputBadges(n) {
  return [
    ...(n.focused ? [['focus', 'badge-focus']] : []),
    ...(n.touched ? [['being touched', 'badge-focus']] : []),
    ...(n.spy ? [['spy', 'badge-comp']] : []),
    ...(n.occludes ? [['untrusted overlay', 'badge-exit']] : []),
    ...(n.dropsAlways ? [['drops input', 'badge-exit']]
      : n.obscuredBy ? [['dropping: obscured', 'badge-exit']]
      : n.dropsIfObscured ? [['drops if obscured', 'badge-comp']] : []),
    ...(n.coveredBy ? [['covered', 'badge-exit']] : []),
    ...(!n.visible ? [['not visible', 'badge-comp']] : []),
    ...(n.hasToken === false ? [['no channel', 'badge-comp']] : []),
  ];
}
