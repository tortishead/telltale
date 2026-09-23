/* ================ parse: getevent ================ */

/* `adb shell getevent -lt` is the kernel's own account of a gesture: one line
   per event — a type, a code, a value, and the monotonic clock in front of it.
   Nothing in it is a touch. A touch is what a run of those lines adds up to,
   so this is the one reader that has to rebuild its subject rather than read
   it off a line.

   Three multitouch protocols reach the same file. Protocol B names a slot and
   a tracking id and states only what changed, which is what every phone made
   in the last decade emits. Protocol A states every contact in every frame and
   separates them with SYN_MT_REPORT, which cheap panels and emulated devices
   still do. A single-touch device states ABS_X/ABS_Y with BTN_TOUCH around
   them. All three are read here into the same thing: a stroke, which is one
   finger from the moment it lands to the moment it leaves, with every sample
   it reported stamped.

   The labels are what `-l` adds and the stamps are what `-t` adds; a capture
   missing either still reads, and one missing the stamps simply has no clock
   to play back against.

       adb shell getevent -lp                  # the ranges, so raw units scale
       adb shell getevent -lt                  # every device, labelled, stamped
       adb shell getevent -lt /dev/input/event2

   Paste the `-lp` output above the capture and the strokes come out in the
   panel's own coordinate space rather than one inferred from how far the
   finger happened to travel. */

/* The node is what getevent prints when it is watching every device at once.
   Given one to watch — `getevent -lt /dev/input/event2` — it prints the events
   and nothing in front of them, so the path is optional here and worked out
   afterwards. */
const GEV_EVENT_RE =
  /^(?:\[\s*(\d+(?:\.\d+)?)\s*\]\s*)?(?:(\/dev\/input\/[\w.-]+)\s*:\s*)?(EV_[A-Z]+|[0-9a-fA-F]{4})\s+(\w+)\s+([0-9a-fA-F]{1,8})\s*$/;
/* The device a node-less capture came off, until the paste says otherwise. */
const GEV_BARE = '';
const GEV_ADD_RE  = /^add device\s+\d+\s*:\s*(\/dev\/input\/[\w.-]+)\s*$/;
const GEV_NAME_RE = /^\s+name:\s*"(.*)"\s*$/;
/* A range line out of `getevent -p`, with or without the `ABS (0003):` that
   opens the first of them and with or without the labels `-l` puts on. */
const GEV_RANGE_RE =
  /^\s*(?:[A-Z]+\s*\(\d{4}\)\s*:\s*)?(ABS_[A-Z0-9_]+|[0-9a-fA-F]{4})\s*:\s*value\s+(-?\d+),\s*min\s+(-?\d+),\s*max\s+(-?\d+)/;

/* Enough of `input-event-codes.h` to read a capture taken without `-l`.
   Anything not in here keeps its hex, which is still something to search for. */
const GEV_TYPES = { 0x00:'EV_SYN', 0x01:'EV_KEY', 0x02:'EV_REL', 0x03:'EV_ABS',
                    0x04:'EV_MSC', 0x05:'EV_SW', 0x11:'EV_LED', 0x15:'EV_FF' };
const GEV_CODES = {
  EV_SYN: { 0:'SYN_REPORT', 1:'SYN_CONFIG', 2:'SYN_MT_REPORT', 3:'SYN_DROPPED' },
  EV_ABS: {
    0x00:'ABS_X', 0x01:'ABS_Y', 0x18:'ABS_PRESSURE', 0x19:'ABS_DISTANCE',
    0x28:'ABS_MISC',
    0x2f:'ABS_MT_SLOT', 0x30:'ABS_MT_TOUCH_MAJOR', 0x31:'ABS_MT_TOUCH_MINOR',
    0x32:'ABS_MT_WIDTH_MAJOR', 0x33:'ABS_MT_WIDTH_MINOR', 0x34:'ABS_MT_ORIENTATION',
    0x35:'ABS_MT_POSITION_X', 0x36:'ABS_MT_POSITION_Y', 0x37:'ABS_MT_TOOL_TYPE',
    0x38:'ABS_MT_BLOB_ID', 0x39:'ABS_MT_TRACKING_ID', 0x3a:'ABS_MT_PRESSURE',
    0x3b:'ABS_MT_DISTANCE', 0x3c:'ABS_MT_TOOL_X', 0x3d:'ABS_MT_TOOL_Y',
  },
  EV_KEY: {
    0x66:'KEY_HOME', 0x72:'KEY_VOLUMEDOWN', 0x73:'KEY_VOLUMEUP', 0x74:'KEY_POWER',
    0x8b:'KEY_MENU', 0x8f:'KEY_WAKEUP', 0x9e:'KEY_BACK', 0xac:'KEY_HOMEPAGE',
    0x110:'BTN_LEFT', 0x111:'BTN_RIGHT', 0x112:'BTN_MIDDLE',
    0x140:'BTN_TOOL_PEN', 0x145:'BTN_TOOL_FINGER', 0x14a:'BTN_TOUCH',
    0x14d:'BTN_TOOL_DOUBLETAP', 0x14e:'BTN_TOOL_TRIPLETAP', 0x14f:'BTN_TOOL_QUADTAP',
    0x244:'KEY_APPSELECT',
  },
  EV_REL: { 0x00:'REL_X', 0x01:'REL_Y', 0x06:'REL_HWHEEL', 0x08:'REL_WHEEL' },
};

/* A value is eight hex digits of two's complement. The one that matters is
   ABS_MT_TRACKING_ID's ffffffff, which is the kernel saying a finger left. */
function gevSigned(hex) {
  const v = parseInt(hex, 16);
  if (!Number.isFinite(v)) return 0;
  return hex.length >= 8 && v > 0x7fffffff ? v - 0x100000000 : v;
}

/* The name a code goes by, whichever way the capture was taken: `-l` printed
   it already, and without `-l` it is four hex digits to look up. */
function gevLabel(table, raw) {
  if (/^[A-Za-z]/.test(raw) && !/^[0-9a-fA-F]{4}$/.test(raw)) return raw;
  const n = parseInt(raw, 16);
  return (table && table[n]) || `0x${raw}`;
}

/* One pass over the file: the add-device lines that name the nodes, the range
   lines that scale them, and the events themselves, kept per device. */
function gevRead(input) {
  const lines = String(input || '').split(/\r?\n/);
  const devs = new Map();
  const dev = (path) => {
    if (!devs.has(path)) devs.set(path, { path, name:null, ranges:new Map(), events:[], head:[] });
    return devs.get(path);
  };

  let head = null;               // the device whose `add device` block we are in
  for (const line of lines) {
    const add = line.match(GEV_ADD_RE);
    if (add) { head = dev(add[1]); head.head.push(line.trim()); continue; }

    const m = line.match(GEV_EVENT_RE);
    /* A line with no node, no stamp and no `EV_` label is three hex words,
       which is too little to claim as an event. */
    if (m && (m[2] || m[1] !== undefined || /^EV_/.test(m[3]))) {
      head = null;
      const d = dev(m[2] || GEV_BARE);
      const type = gevLabel(GEV_TYPES, m[3]);
      d.events.push({
        t: m[1] === undefined ? null : +m[1],
        type,
        code: gevLabel(GEV_CODES[type], m[4]),
        value: gevSigned(m[5]),
      });
      continue;
    }

    if (!head) continue;
    head.head.push(line.trim());
    const nm = line.match(GEV_NAME_RE);
    if (nm) { head.name = nm[1]; continue; }
    const rg = line.match(GEV_RANGE_RE);
    if (rg) head.ranges.set(gevLabel(GEV_CODES.EV_ABS, rg[1]),
                            { value:+rg[2], min:+rg[3], max:+rg[4] });
  }
  gevName(devs, lines);
  return devs;
}

/* Events that arrived with no node in front of them. The paste often still
   says which device they came off — the command that took them is in the
   scrollback, or a `-lp` block above them describes exactly one touch device
   — and either is better than a group with no name. Failing both they stay
   their own device, which is honest: the capture never said. */
function gevName(devs, lines) {
  const bare = devs.get(GEV_BARE);
  if (!bare) return;
  if (!bare.events.length) { devs.delete(GEV_BARE); return; }

  let said = null;
  for (const line of lines) {
    const m = line.match(/getevent\b[^\n]*?(\/dev\/input\/[\w.-]+)/);
    if (m) { said = m[1]; break; }
  }

  const idle = [...devs.values()].filter(d => d !== bare && !d.events.length);
  const touch = idle.filter(d => d.ranges.has('ABS_MT_POSITION_X') || d.ranges.has('ABS_X'));
  const host = (said && idle.find(d => d.path === said))
            || (touch.length === 1 ? touch[0] : null);

  if (host) { host.events = bare.events; devs.delete(GEV_BARE); return; }
  if (said) { bare.path = said; devs.delete(GEV_BARE); devs.set(said, bare); }
}

/* ---- from events to strokes ---- */

/* A contact being built: what the last frame said about it, and where it has
   been. `id` is the kernel's tracking id where there is one and the slot
   otherwise, which is all a protocol A or single-touch device gives. */
function gevStroke(seq, slot, id, t) {
  return { seq, slot, id, start:t, end:t, samples:[], open:true };
}

function gevPush(s, t, p) {
  if (p.x === null || p.y === null) return;
  const last = s.samples[s.samples.length - 1];
  s.end = t;
  /* A device that reports at 120Hz with a finger held still prints the same
     point a hundred times. One sample per position keeps the path honest and
     the duration is still read off `start` and `end`. */
  if (last && last.x === p.x && last.y === p.y && last.pressure === p.pressure) {
    last.held = (last.held || 1) + 1;
    last.tEnd = t;
    return;
  }
  s.samples.push({ t, x:p.x, y:p.y, pressure:p.pressure, major:p.major, tEnd:t });
}

/* The three protocols, read in one pass. Which one a device speaks is not
   declared anywhere — it is whichever codes turn up — so all three are
   followed at once and the one that produced strokes is the one it spoke. */
function gevTracks(events) {
  const strokes = [], keys = [];
  const openBySlot = new Map();          // protocol B: slot -> stroke
  const pending = new Map();             // slot -> what this frame has said
  const at = (slot) => {
    if (!pending.has(slot)) pending.set(slot, { x:null, y:null, pressure:null, major:null });
    return pending.get(slot);
  };
  const keyDown = new Map();
  let slot = 0, seq = 0, clock = 0;
  let protoB = false, protoA = false, legacy = false;
  let frameA = [];                       // protocol A: contacts stated this frame
  let single = null;                     // single-touch: the one open stroke
  let touching = false;

  const nearest = (pt, pool) => {
    let best = null, bestD = Infinity;
    for (const s of pool) {
      const l = s.samples[s.samples.length - 1];
      const d = l ? Math.hypot(l.x - pt.x, l.y - pt.y) : Infinity;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  };

  for (const e of events) {
    if (e.t !== null) clock = e.t;
    const t = e.t === null ? clock : e.t;

    if (e.type === 'EV_ABS') {
      const c = at(slot);
      switch (e.code) {
        case 'ABS_MT_SLOT': slot = e.value; break;
        case 'ABS_MT_TRACKING_ID': {
          protoB = true;
          if (e.value < 0) {
            const s = openBySlot.get(slot);
            if (s) { s.open = false; openBySlot.delete(slot); }
            pending.delete(slot);
          } else {
            const s = gevStroke(seq++, slot, e.value, t);
            strokes.push(s);
            openBySlot.set(slot, s);
          }
          break;
        }
        case 'ABS_MT_POSITION_X': case 'ABS_MT_TOOL_X': c.x = e.value; break;
        case 'ABS_MT_POSITION_Y': case 'ABS_MT_TOOL_Y': c.y = e.value; break;
        case 'ABS_MT_PRESSURE': c.pressure = e.value; break;
        case 'ABS_MT_TOUCH_MAJOR': c.major = e.value; break;
        case 'ABS_X': legacy = true; at(0).x = e.value; break;
        case 'ABS_Y': legacy = true; at(0).y = e.value; break;
        case 'ABS_PRESSURE': at(0).pressure = e.value; break;
        default: break;
      }
      continue;
    }

    if (e.type === 'EV_KEY') {
      if (e.code === 'BTN_TOUCH') {
        touching = e.value > 0;
        if (!touching && single) { single.open = false; single = null; }
        continue;
      }
      if (/^BTN_TOOL_/.test(e.code)) continue;      // how many fingers, not a key
      if (e.value === 1) keyDown.set(e.code, t);
      else if (e.value === 0) {
        const down = keyDown.get(e.code);
        keys.push({ seq:seq++, code:e.code, start:down === undefined ? t : down, end:t,
                    held:down !== undefined });
        keyDown.delete(e.code);
      }
      continue;
    }

    if (e.type !== 'EV_SYN') continue;

    if (e.code === 'SYN_MT_REPORT') {
      protoA = true;
      const c = pending.get(0) || pending.get(slot);
      if (c && c.x !== null && c.y !== null) frameA.push({ ...c });
      pending.delete(0); pending.delete(slot);
      continue;
    }
    if (e.code !== 'SYN_REPORT') continue;

    /* A frame is over. Protocol B commits whatever each open slot has said,
       protocol A matches this frame's contacts onto the strokes still open,
       and a single-touch device commits the one point it has. */
    if (protoB) {
      for (const [sl, s] of openBySlot) {
        const c = pending.get(sl);
        const last = s.samples[s.samples.length - 1];
        const pt = {
          x: c && c.x !== null ? c.x : last ? last.x : null,
          y: c && c.y !== null ? c.y : last ? last.y : null,
          pressure: c && c.pressure !== null ? c.pressure : last ? last.pressure : null,
          major: c && c.major !== null ? c.major : last ? last.major : null,
        };
        gevPush(s, t, pt);
      }
      pending.clear();
    }

    if (frameA.length || (protoA && !frameA.length)) {
      const live = strokes.filter(s => s.open && s.proto === 'a');
      const spare = [...live];
      for (const pt of frameA) {
        const s = nearest(pt, spare);
        const use = s || (() => {
          const made = gevStroke(seq, -1, seq, t); seq++;
          made.proto = 'a';
          strokes.push(made);
          return made;
        })();
        if (s) spare.splice(spare.indexOf(s), 1);
        gevPush(use, t, pt);
      }
      for (const s of spare) s.open = false;         // a finger that stopped being reported
      frameA = [];
    }

    if (legacy && !protoB && !protoA) {
      const c = pending.get(0);
      if (touching && !single) {
        single = gevStroke(seq, 0, seq, t); seq++;
        strokes.push(single);
      }
      if (single && c) gevPush(single, t, {
        x: c.x, y: c.y, pressure: c.pressure, major: null,
      });
    }
  }

  for (const s of strokes) s.open = false;           // the capture ended mid-gesture
  return { strokes: strokes.filter(s => s.samples.length), keys,
           protocol: protoB ? 'B' : protoA ? 'A' : legacy ? 'single-touch' : null };
}

/* ---- what a stroke turned out to be ---- */

/* A gesture is named from its own numbers and nothing else: how long the
   finger was down, how far it went, and whether where it ended is where it was
   heading the whole time. The thresholds are the ones Android itself uses in
   spirit — a tap is a touch that did not move, a long press is one that stayed
   — scaled to the panel rather than fixed in device units, because a 1080-wide
   panel and a 4096-wide digitiser count the same finger differently. */
const GEV_TAP_MS   = 180;    // under this and a still finger is a tap
const GEV_PRESS_MS = 500;    // over this and a still finger is a long press

function gevGeometry(samples) {
  let travel = 0;
  const box = { l:Infinity, t:Infinity, r:-Infinity, b:-Infinity };
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    box.l = Math.min(box.l, s.x); box.r = Math.max(box.r, s.x);
    box.t = Math.min(box.t, s.y); box.b = Math.max(box.b, s.y);
    if (i) travel += Math.hypot(s.x - samples[i-1].x, s.y - samples[i-1].y);
  }
  const a = samples[0], z = samples[samples.length - 1];
  return { box, travel, net: Math.hypot(z.x - a.x, z.y - a.y),
           dx: z.x - a.x, dy: z.y - a.y };
}

function gevDirection(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left')
                                      : (dy >= 0 ? 'down' : 'up');
}

/* The speed the finger was doing as it left, which is what decides whether the
   list keeps scrolling after it. Measured over the last 100ms of the stroke
   rather than the whole of it, the way a VelocityTracker does. */
function gevFling(samples) {
  const z = samples[samples.length - 1];
  if (samples.length < 2 || z.t === null) return null;
  let i = samples.length - 1;
  while (i > 0 && z.t - samples[i - 1].t < 0.1) i--;
  const a = samples[i === samples.length - 1 ? samples.length - 2 : i];
  const dt = z.t - a.t;
  if (!(dt > 0)) return null;
  return { x: (z.x - a.x) / dt, y: (z.y - a.y) / dt,
           speed: Math.hypot(z.x - a.x, z.y - a.y) / dt };
}

function gevClassify(s, slop) {
  const ms = (s.end - s.start) * 1000;
  if (s.geo.travel <= slop) {
    return ms >= GEV_PRESS_MS ? { kind:'long press', family:'gev-press' }
                              : { kind:'tap', family:'gev-tap' };
  }
  /* A stroke that ended where it was heading is a swipe; one that wandered and
     came back is a drag, and the difference is the only thing that tells a
     fling apart from a scribble. */
  if (s.geo.net > s.geo.travel * 0.7) {
    return { kind:`swipe ${gevDirection(s.geo.dx, s.geo.dy)}`, family:'gev-swipe',
             direction: gevDirection(s.geo.dx, s.geo.dy) };
  }
  return { kind:'drag', family:'gev-drag' };
}

/* Strokes that were down at the same time are one gesture. Two fingers whose
   distance apart changed by more than a third of what it started at is a
   pinch, which is the one multi-finger gesture worth naming; the rest is said
   as what it is, which is several fingers at once. */
function gevGroup(strokes) {
  const sorted = [...strokes].sort((a, b) => a.start - b.start);
  const groups = [];
  for (const s of sorted) {
    const g = groups[groups.length - 1];
    if (g && s.start <= g.end) { g.members.push(s); g.end = Math.max(g.end, s.end); }
    else groups.push({ members:[s], start:s.start, end:s.end });
  }
  for (const g of groups) {
    if (g.members.length < 2) { g.kind = g.members[0].kind; continue; }
    const span = (a) => {
      const pts = g.members.map(s => a === 'first' ? s.samples[0] : s.samples[s.samples.length - 1]);
      let most = 0;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        most = Math.max(most, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
      return most;
    };
    const from = span('first'), to = span('last');
    const dirs = new Set(g.members.map(s => s.direction).filter(Boolean));
    g.kind = to > from * 1.33 ? 'pinch out'
           : from > to * 1.33 ? 'pinch in'
           : dirs.size === 1 ? `${g.members.length}-finger swipe ${[...dirs][0]}`
           : `${g.members.length} fingers`;
    g.pinch = to > from * 1.33 || from > to * 1.33;
    g.from = from; g.to = to;
  }
  return groups;
}

/* ---- the scene ---- */

/* The coordinate space a stroke is drawn in. `getevent -p` states it outright;
   without it the only honest answer is how far the fingers in this capture
   actually reached, which is said to be inferred wherever it is shown. */
function gevSpace(dev, strokes) {
  const rx = dev.ranges.get('ABS_MT_POSITION_X') || dev.ranges.get('ABS_X');
  const ry = dev.ranges.get('ABS_MT_POSITION_Y') || dev.ranges.get('ABS_Y');
  if (rx && ry && rx.max > rx.min && ry.max > ry.min) {
    return { x0:rx.min, y0:ry.min, w:rx.max - rx.min + 1, h:ry.max - ry.min + 1,
             synthesised:false };
  }
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const s of strokes) {
    l = Math.min(l, s.geo.box.l); t = Math.min(t, s.geo.box.t);
    r = Math.max(r, s.geo.box.r); b = Math.max(b, s.geo.box.b);
  }
  if (!Number.isFinite(l)) return { x0:0, y0:0, w:1080, h:1920, synthesised:true };
  /* Round out to something that reads like a panel rather than to the exact
     pixel the finger happened to stop at. */
  const round = (v) => Math.max(1, Math.ceil(v / 16) * 16);
  return { x0:0, y0:0, w:round(r + 1), h:round(b + 1), synthesised:true };
}

const gevMs = (s) => s < 0.1 ? `${Math.round(s * 1000)} ms`
                   : s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)} s`
                   : `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`;
const gevPt = (p) => `${Math.round(p.x)}, ${Math.round(p.y)}`;

function parseGeteventCapture(input) {
  const devs = gevRead(input);
  const displays = [];
  const nodes = [];
  let first = Infinity, last = -Infinity, events = 0, stamped = false;

  /* A device node is `event2`, and the number in it is the id every group in
     Telltale is keyed by. A path that is not `eventN` — a symlink under
     `/dev/input/by-path`, say — still gets an id, taken in the order it was
     seen, so it is a group like any other. */
  let spare = 900;
  const idOf = (path) => {
    const m = path.match(/event(\d+)$/);
    return m ? +m[1] : spare++;
  };

  for (const dev of devs.values()) {
    const { strokes, keys, protocol } = gevTracks(dev.events);
    events += dev.events.length;
    if (!strokes.length && !keys.length) continue;

    for (const s of strokes) s.geo = gevGeometry(s.samples);
    const space = gevSpace(dev, strokes);
    const slop = Math.max(8, Math.max(space.w, space.h) * 0.012);
    for (const s of strokes) Object.assign(s, gevClassify(s, slop));

    const id = idOf(dev.path);
    const groups = gevGroup(strokes);
    const mine = [];

    groups.forEach((g, gi) => {
      const multi = g.members.length > 1;
      const parentHash = multi ? `gev:${id}:g${gi}` : null;

      if (multi) {
        const box = g.members.reduce((acc, s) => ({
          l:Math.min(acc.l, s.geo.box.l), t:Math.min(acc.t, s.geo.box.t),
          r:Math.max(acc.r, s.geo.box.r), b:Math.max(acc.b, s.geo.box.b),
        }), { l:Infinity, t:Infinity, r:-Infinity, b:-Infinity });
        mine.push({
          hash: parentHash,
          title: g.kind,
          typeLabel: g.pinch ? 'pinch' : 'multi-touch',
          family: 'gev-multi',
          displayId: id,
          gesture: true,
          fingers: g.members.length,
          start: g.start, end: g.end,
          frame: box,
          z: -gi * 1000,
          visible: true,
          badges: [[`${g.members.length} fingers`, 'badge-focus'],
                   [gevMs(g.end - g.start), 'badge-comp']],
          search: `${g.kind} ${g.members.length} fingers`.toLowerCase(),
          samples: [],
          raw: '',
        });
      }

      g.members.forEach((s, si) => {
        const dur = s.end - s.start;
        const fling = gevFling(s.samples);
        mine.push({
          hash: `gev:${id}:s${s.seq}`,
          parentHash,
          ancestors: parentHash ? [{ hash: parentHash }] : [],
          title: `${s.kind} at ${gevPt(s.samples[0])}`,
          typeLabel: s.kind.split(' ')[0] === 'swipe' ? 'swipe' : s.kind,
          family: s.family,
          displayId: id,
          gesture: false,
          stroke: true,
          slot: s.slot,
          trackingId: s.id,
          start: s.start, end: s.end, duration: dur,
          samples: s.samples,
          geo: s.geo,
          fling,
          direction: s.direction || null,
          kind: s.kind,
          frame: s.geo.box,
          z: -gi * 1000 - si,
          visible: true,
          badges: [
            [gevMs(dur), 'badge-comp'],
            ...(s.geo.travel > slop ? [[`${Math.round(s.geo.travel)} px`, 'badge-vis']] : []),
            ...(fling && fling.speed > Math.max(space.w, space.h) ? [['fling', 'badge-focus']] : []),
          ],
          search: `${s.kind} slot ${s.slot} id ${s.id} ${gevPt(s.samples[0])}`.toLowerCase(),
          raw: '',
        });
      });
    });

    /* A key or a button is not a place on the panel, so it has no frame and
       simply sits in the list where its moment puts it. */
    keys.forEach((k, ki) => {
      mine.push({
        hash: `gev:${id}:k${k.seq}`,
        title: k.code,
        typeLabel: /^BTN_/.test(k.code) ? 'button' : 'key',
        family: 'gev-key',
        displayId: id,
        key: true,
        start: k.start, end: k.end,
        frame: null,
        z: -1e6 - ki,
        visible: true,
        badges: [[gevMs(k.end - k.start), 'badge-comp'],
                 ...(k.held ? [] : [['no down', 'badge-exit']])],
        search: `${k.code} key`.toLowerCase(),
        samples: [],
        raw: '',
      });
    });

    for (const n of mine) {
      if (n.start < first) first = n.start;
      if (n.end > last) last = n.end;
    }
    if (dev.events.some(e => e.t !== null)) stamped = true;

    nodes.push(...mine);
    displays.push({
      id,
      label: dev.path ? dev.path.replace(/^\/dev\/input\//, '') : 'unnamed device',
      name: dev.name,
      path: dev.path,
      size: { w: space.w, h: space.h },
      origin: { x: space.x0, y: space.y0 },
      synthesised: space.synthesised,
      /* A device that only ever reported keys has no panel to draw on. It is
         still a group — its keys happened — and says so rather than drawing a
         screen that was never measured. */
      noGeometry: !strokes.length,
      meta: [`${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`,
             keys.length ? `${keys.length} key${keys.length === 1 ? '' : 's'}` : null,
             strokes.length ? `${space.w} × ${space.h}${space.synthesised ? '?' : ''}` : null,
            ].filter(Boolean).join(' \u00b7 '),
      protocol,
      ranges: dev.ranges,
      strokes: strokes.length,
      keys: keys.length,
      events: dev.events.length,
      start: mine.length ? Math.min(...mine.map(n => n.start)) : 0,
      end: mine.length ? Math.max(...mine.map(n => n.end)) : 0,
      raw: dev.head.join('\n'),
    });
  }

  const globals = {
    devices: displays.length,
    events,
    stamped,
    start: Number.isFinite(first) ? first : 0,
    end: Number.isFinite(last) ? last : 0,
    span: Number.isFinite(first) && last > first ? last - first : 0,
  };
  return finaliseScene('getevent', displays, nodes, globals);
}
