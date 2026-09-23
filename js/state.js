/* ================ state and shared helpers ================ */
const VIEW0 = { yaw:34, pitch:19, sep:38 };   // the view Reset goes back to
/* One dump loaded is one document. Everything the user does to a dump — which
   of its scenes is showing, which display, the filter, the selection, the pose
   — belongs to that document and is stored on it, so opening a tab changes
   which document S reads through rather than copying a dozen fields out of one
   and into another. `docs` and `docId` are the whole of the state; the rest of
   S is a view onto the open one. Pane widths and the theme belong to the page
   rather than to any document and are left alone by a switch. */
/* The documents themselves belong to a workspace — one set of open dumps per
   thing you are working on, so a bugreport opened for one investigation is not
   sitting in the strip while you read another. `spaces` and `spaceId` are the
   only state the page itself keeps; `docs` and `docId` are accessors onto the
   open workspace, so every line below goes on reading and writing S.docs
   without knowing there is more than one set of them. */
let spaceSeq = 0;
function newSpace(name){
  const id = ++spaceSeq;
  return { id, name: String(name || '').trim() || `workspace ${id}`, docs:[], docId:null };
}
const S = { spaces:[newSpace()], spaceId:null };
S.spaceId = S.spaces[0].id;
function currentSpace(){ return S.spaces.find(w => w.id === S.spaceId) || S.spaces[0]; }
for(const key of ['docs', 'docId']){
  Object.defineProperty(S, key, {
    enumerable:true,
    get(){ return currentSpace()[key]; },
    set(v){ currentSpace()[key] = v; },
  });
}

/* The fields a document carries, holding the values one that has never been
   opened starts on. Each is defined on S as an accessor onto the open
   document, so `S.filter` is the open tab's filter and everything below the
   state layer goes on reading S without knowing tabs exist. With no dump open
   the defaults read back and a write goes nowhere, which is what the handlers
   that can still fire on the loader screen want. */
/* `collapsed` holds the hashes of the rows whose children are hidden. It is a
   Set rather than a flag on the node because it is state about the open
   document, not about the dump: two tabs off the same file collapse
   separately, and reloading the dump does not remember what you shut. */
/* `attr` and `attrFilter` are the reading pane's own pick and search — which
   line of the section is being asked about, and what is being looked for
   inside it. They sit here with the rest of what a document remembers, so two
   tabs off the same dump keep their own place in it. */
/* `mapTo` and `mapTurn` are a trace's own: which display out of the other
   dumps on this desk its raw device units are being drawn onto, and how the
   panel is turned against it. `mapTurn` is null until somebody turns it by
   hand, because a display that states how its panel is mounted — which
   `dumpsys display` does and nothing else in a bugreport does — is a better
   answer than any default. `playAt` is where the playhead is, in seconds from
   the start of the capture, so scrubbing one tab does not move another.

   `trace` is the other direction: a capture pasted onto a dump that draws, so
   the gesture plays over that dump's own windows. It is a whole scene, read by
   the same reader that would have opened it as a tab, and it hangs off this
   document rather than being one — which is why it lives here with the rest of
   what a document remembers and not in `found`. `traceDev` is which of its
   devices is playing. */
const DOC_STATE = { toolId:null, displayId:null, selected:null, region:null,
                    filter:'', regex:false, show:'all', dim:true, view:'depth',
                    collapsed:null, attr:null, attrFilter:'',
                    mapTo:null, mapTurn:null, playAt:0,
                    trace:null, traceDev:null, ...VIEW0 };
for(const key of Object.keys(DOC_STATE)){
  Object.defineProperty(S, key, {
    enumerable:true,
    get(){ const doc = currentDoc(); return doc ? doc.ui[key] : DOC_STATE[key]; },
    set(v){ const doc = currentDoc(); if(doc) doc.ui[key] = v; },
  });
}

/* `found` is every scene the open dump's text yielded, one per tool that
   recognised it, and `entry` is the one showing — `tool` and `data` are its
   two halves, which is what the renderers below read. */
Object.defineProperties(S, {
  found: { enumerable:true, get(){ return currentDoc() ? currentDoc().found : []; } },
  entry: { get(){
    const doc = currentDoc();
    return doc ? (doc.found.find(f => f.tool.id === doc.ui.toolId) || doc.found[0]) : null;
  } },
  tool: { enumerable:true, get(){ return S.entry && S.entry.tool; } },
  data: { enumerable:true, get(){ return S.entry && S.entry.scene; } },
});
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const trim = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
/* A tail-trimmed name is no name at all where the names share a prefix, which
   is the normal case for two bugreports off one device: they differ in the
   date at the end. So this one keeps both ends and loses the middle. */
const elide = (s, n) => s.length <= n ? s
  : s.slice(0, Math.ceil((n - 1) / 2)) + '…' + s.slice(s.length - Math.floor((n - 1) / 2));
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const rectW = (r) => r.r - r.l, rectH = (r) => r.b - r.t;
/* Rects go into SVG attributes often enough to be worth spelling once. */
const rectAttrs = (rc) => `x="${rc.l}" y="${rc.t}" width="${rectW(rc)}" height="${rectH(rc)}"`;

/* Every node carries the family its parser put it in; the family picks the
   hue. The window families are window types; the SurfaceFlinger ones are what
   a layer is made of. */
const FAMILY_COLORS = {
  wallpaper:'#8a8f6f', ime:'#2e7d5b', bar:'#b4622a',
  alert:'#a3352f', panel:'#6b5b95', app:'#2f6f8f', other:'#55636f',
  'sf-buffer':'#2f6f8f', 'sf-effect':'#6b5b95', 'sf-container':'#55636f',
  'pkg-app':'#2f6f8f', 'pkg-system':'#55636f', 'pkg-updated':'#b4622a',
  'pkg-priv':'#a3352f', 'pkg-apex':'#2e7d5b', 'pkg-shared':'#6b5b95',
  /* An ANR thread's family is the state it was caught in, which is the one
     thing worth reading off a row of them at a glance. */
  'anr-main':'#a3352f', 'anr-blocked':'#b4622a', 'anr-running':'#2e7d5b',
  'anr-waiting':'#55636f', 'anr-native':'#2f6f8f', 'anr-pool':'#6b5b95',
  'anr-other':'#55636f',
  /* A car_service section is coloured by what it is: a service, one of the
     HALs under it, a subsection of either, or one that threw on its way out. */
  'car-service':'#2f6f8f', 'car-hal':'#6b5b95',
  'car-section':'#55636f', 'car-failed':'#a3352f',
  /* A user is coloured by what kind of user it is, and a section of the dump
     by being one. */
  'user-system':'#55636f', 'user-full':'#2f6f8f', 'user-profile':'#6b5b95',
  'user-guest':'#b4622a', 'user-section':'#55636f',
  /* An activity dump is coloured by what a node of the task tree is: the
     activities themselves, the kind of task that holds them, and a fragment a
     task was split into. */
  'act-activity':'#2f6f8f', 'act-task':'#6b5b95', 'act-home':'#2e7d5b',
  'act-recents':'#b4622a', 'act-assistant':'#8a8f6f', 'act-dream':'#8a8f6f',
  'act-fragment':'#55636f',
  /* A service is coloured by what state it is actually in: running in the
     foreground, started, alive only because something is bound to it, waiting
     to start, dying and restarting, or not running at all. A connection is
     coloured for being one. */
  'svc-foreground':'#b4622a', 'svc-started':'#2e7d5b', 'svc-bound':'#2f6f8f',
  'svc-pending':'#8a8f6f', 'svc-restarting':'#a3352f', 'svc-dead':'#55636f',
  'svc-connection':'#6b5b95',
  /* A display is coloured by which of the rectangles it is made of a node is:
     the panel itself, the part of it apps get, the frame the input stack maps
     a touch through, and the holes in it. */
  'disp-panel':'#2f6f8f', 'disp-app':'#2e7d5b', 'disp-viewport':'#6b5b95',
  'disp-cutout':'#a3352f',
  /* An event is coloured by what kind of thing happened: a process coming and
     going, an activity's lifecycle, something the system did, and the ones
     that are the reason the log was taken. */
  'ev-process':'#2e7d5b', 'ev-activity':'#2f6f8f', 'ev-system':'#6b5b95',
  'ev-trouble':'#a3352f', 'ev-other':'#55636f',
  /* A property is coloured by where its value came from: the build, something
     that persisted it, init saying what it thinks of a service, or the running
     system. One whose value is a finding rather than a fact is coloured as
     one, and a section is the namespace they are grouped into. */
  'prop-section':'#55636f', 'prop-ro':'#2f6f8f', 'prop-persist':'#6b5b95',
  'prop-service':'#2e7d5b', 'prop-runtime':'#b4622a', 'prop-flagged':'#a3352f',
  /* An overlay is coloured by whether it is over anything: on, off, held on by
     being immutable, or broken in a way nothing on the device will fix. A
     target is the package they are all over. */
  'overlay-target':'#6b5b95', 'overlay-on':'#2e7d5b', 'overlay-off':'#55636f',
  'overlay-fixed':'#2f6f8f', 'overlay-broken':'#a3352f',
  /* A binder row is coloured by what it is worth knowing about it: the caller
     it hangs under, a call that came back with an exception, a call whose
     method the dump did not record, and everything else. */
  'binder-caller':'#6b5b95', 'binder-call':'#2f6f8f',
  'binder-threw':'#a3352f', 'binder-unnamed':'#55636f',
  /* An input window is coloured by what it does to a touch: takes it, watches
     it, drops it, or is not in its way at all. */
  'input-window':'#2f6f8f', 'input-spy':'#6b5b95', 'input-monitor':'#6b5b95',
  'input-drop':'#a3352f', 'input-untouchable':'#55636f',
  'input-wallpaper':'#8a8f6f',
  /* An input device is coloured by what kind of thing it is. */
  'input-touch':'#2e7d5b', 'input-key':'#2f6f8f', 'input-pointer':'#b4622a',
  'input-stick':'#6b5b95', 'input-sensor':'#8a8f6f', 'input-device':'#55636f',
  'input-mapper':'#55636f',
  /* A stroke is coloured by what the finger did: the four gestures a touch
     dump is read for, the group a multi-finger one hangs under, and a key,
     which is the one thing in this dump that is not a place on the panel. */
  'gev-tap':'#2e7d5b', 'gev-press':'#b4622a', 'gev-swipe':'#2f6f8f',
  'gev-drag':'#6b5b95', 'gev-multi':'#a3352f', 'gev-key':'#55636f',
  /* A log line is coloured by its level, which is the only thing about it that
     is worth seeing before reading it. */
  'log-verbose':'#8a8f6f', 'log-debug':'#55636f', 'log-info':'#2f6f8f',
  'log-warn':'#b4622a', 'log-error':'#a3352f', 'log-fatal':'#a3352f',
  'log-crash':'#a3352f',
};
function colorFor(n){ return FAMILY_COLORS[n.family] || FAMILY_COLORS.other; }

/* Type sets the hue so the legend still means something; windows sharing a hue
   are separated by shade, so two BASE_APPLICATIONs are never one blur. The
   offsets cycle through a fixed ladder rather than growing — several distinct
   types map to one base colour, and a linear drift turned an orange bar yellow. */
const TINTS = [
  [  0,   0,   0],
  [  7,   6,  13],
  [ -7,  -5, -13],
  [ 13,  -7,  22],
  [-12,  10, -21],
  [  4,  14,   6],
  [ -4, -12,  -7],
  [ 10,   0,  -4],
];
function tintFor(w){
  const base = colorFor(w);
  const [dh, ds, dl] = TINTS[(w.tint || 0) % TINTS.length];
  if(!dh && !ds && !dl) return base;
  const [h, s0, l0] = hexToHsl(base);
  return hslToCss(h + dh, s0 + ds, l0 + dl);
}

function hexToHsl(hex){
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn;
  const l = (mx + mn) / 2;
  if(!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0))
          : mx === g ? (b - r) / d + 2
          : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

const hslToCss = (h, s, l) =>
  `hsl(${((h % 360) + 360) % 360} ${clamp(s, 14, 70).toFixed(1)}% ${clamp(l, 26, 66).toFixed(1)}%)`;
