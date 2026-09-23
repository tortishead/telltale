
/* Every parser is handed the same thing — whatever came off the device — and
   starts by agreeing on what a line is. A dump pulled over adb on Windows, or
   off a browser that normalised nothing, carries CRLF or lone CRs; a parser
   that split on \n alone would hang a \r on the end of every field it read.
   So the normalising is spelled once here rather than ten times below, which
   is also what stops one reader disagreeing with another about what it was
   handed when it was handed nothing. */
const dumpText = (input) => String(input === null || input === undefined ? '' : input)
  .replace(/\r\n?/g, '\n');
const dumpLines = (input) => dumpText(input).split('\n');

/* Where one service's dump stops inside a bugreport. Three readers — car,
   user and input — are handed the whole file and have to read only their own
   part of it, because a heading of theirs is a common enough shape that
   another service's output would be read as more of the same. What ends a
   section is the same for all three: a bugreport rule, the line naming the
   next service, or the `(dumpsys <service>)` trailer a section heading carries.
   A reader with siblings of its own — `dumpsys input` prints three — passes
   them in as well. */
const DUMP_BOUNDARY = '-{3,}|={3,}|DUMP OF SERVICE\\b|\\S.*\\(dumpsys \\S+\\)\\s*$';
const DUMP_BOUNDARY_RE = new RegExp(`^(?:${DUMP_BOUNDARY})`);

/* The span of the file one reader should look at: from the first line its
   start pattern matches to the first boundary after it. `missing` says what to
   do when nothing said where the section starts — a pasted dump of one service
   prints no bugreport heading, so most readers take the whole text ('all'),
   and a reader that is one of several in the same text takes nothing
   ('none'). */
function sectionSpan(lines, startRe, endRe, missing) {
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) return missing === 'none' ? null : { start: 0, end: lines.length };
  const stop = endRe || DUMP_BOUNDARY_RE;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (stop.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

const RECT_RE = /\[(-?\d+),\s*(-?\d+)\]\[(-?\d+),\s*(-?\d+)\]/;
const NAMED_RECT_RE = /([A-Za-z_][\w.]*)=\[(-?\d+),\s*(-?\d+)\]\[(-?\d+),\s*(-?\d+)\]/g;
/* Some sections print a rect as one bracket of four: frame=[l,t,r,b]. */
const FLAT_RECT_RE = /([A-Za-z_][\w.]*)=\[(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\]/g;
/* Dumps from some builds print ty= as the raw int instead of the name, and the
   SurfaceFlinger HWC table only ever prints the int. */
const TYPE_INTS = {
  1:'BASE_APPLICATION', 2:'APPLICATION', 3:'APPLICATION_STARTING', 4:'DRAWN_APPLICATION',
  1000:'APPLICATION_PANEL', 1001:'APPLICATION_MEDIA', 1002:'APPLICATION_SUB_PANEL',
  1003:'APPLICATION_ATTACHED_DIALOG', 1004:'APPLICATION_MEDIA_OVERLAY',
  1005:'APPLICATION_ABOVE_SUB_PANEL',
  2000:'STATUS_BAR', 2001:'SEARCH_BAR', 2002:'PHONE', 2003:'SYSTEM_ALERT', 2004:'KEYGUARD',
  2005:'TOAST', 2006:'SYSTEM_OVERLAY', 2007:'PRIORITY_PHONE', 2008:'SYSTEM_DIALOG',
  2009:'KEYGUARD_DIALOG', 2010:'SYSTEM_ERROR', 2011:'INPUT_METHOD', 2012:'INPUT_METHOD_DIALOG',
  2013:'WALLPAPER', 2014:'STATUS_BAR_PANEL', 2015:'SECURE_SYSTEM_OVERLAY', 2016:'DRAG',
  2017:'STATUS_BAR_SUB_PANEL', 2018:'POINTER', 2019:'NAVIGATION_BAR', 2020:'VOLUME_OVERLAY',
  2021:'BOOT_PROGRESS', 2022:'INPUT_CONSUMER', 2024:'NAVIGATION_BAR_PANEL', 2026:'DISPLAY_OVERLAY',
  2027:'MAGNIFICATION_OVERLAY', 2030:'PRESENTATION', 2031:'PRIVATE_PRESENTATION',
  2032:'VOICE_INTERACTION', 2033:'ACCESSIBILITY_OVERLAY', 2034:'VOICE_INTERACTION_STARTING',
  2035:'DOCK_DIVIDER', 2036:'QS_DIALOG', 2037:'SCREENSHOT', 2038:'APPLICATION_OVERLAY',
  2039:'ACCESSIBILITY_MAGNIFICATION_OVERLAY', 2040:'NOTIFICATION_SHADE',
  2041:'STATUS_BAR_ADDITIONAL',
};
/* Window types are printed with the TYPE_ prefix the constant carries and read
   without it everywhere. It sits here rather than with the other one-line
   helpers because a parser names a window's type while parsing it, and the
   parse layer is not allowed to reach forward into the render layer. */
const shortType = (t) => t ? t.replace(/^TYPE_/,'') : '—';
const KV_RE = /([A-Za-z_][\w.()]*)=("[^"]*"|[A-Za-z_]\w*\{[^{}]*\}|\{[^{}]*\}|\[[^\][]*\]|[^\s,]+)/g;
const WIN_HEAD_RE = /^(\s*)Window #(-?\d+) Window\{(\S+?)(?:\s+(u\d+))?\s+(.+?)\}:\s*$/;
const DISPLAY_HEAD_RE = /^(\s*)Display:\s*mDisplayId=(\d+)/;

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function rectFrom(m, i) {
  return { l: +m[i], t: +m[i + 1], r: +m[i + 2], b: +m[i + 3] };
}

function rectValid(r) {
  return r && r.r > r.l && r.b > r.t;
}

/* Collect an indented block: every following line indented deeper than the head. */
function takeBlock(lines, start, headIndent) {
  const out = [lines[start]];
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { out.push(line); continue; }
    if (indentOf(line) <= headIndent) break;
    out.push(line);
  }
  // trim trailing blanks
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { text: out.join('\n'), next: i };
}

/* A display section mixes indentation levels — the head sits at the same depth
   as lines that belong to it — so it runs to whatever starts the next one. */
function takeDisplaySection(lines, start) {
  const out = [lines[start]];
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { out.push(line); continue; }
    if (DISPLAY_HEAD_RE.test(line) || WIN_HEAD_RE.test(line) || indentOf(line) === 0) break;
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { text: out.join('\n'), next: i };
}

function harvest(text) {
  const rects = {};
  let m;
  NAMED_RECT_RE.lastIndex = 0;
  while ((m = NAMED_RECT_RE.exec(text)) !== null) {
    const key = m[1];
    if (!(key in rects)) rects[key] = rectFrom(m, 2);
  }
  FLAT_RECT_RE.lastIndex = 0;
  while ((m = FLAT_RECT_RE.exec(text)) !== null) {
    const key = m[1];
    if (!(key in rects)) rects[key] = rectFrom(m, 2);
  }
  const props = {};
  KV_RE.lastIndex = 0;
  while ((m = KV_RE.exec(text)) !== null) {
    const key = m[1];
    if (key in rects || key in props) continue;
    props[key] = m[2];
  }
  return { rects, props };
}

/* mAttrs spans several lines and holds ty=/fl=/gr=. Pull the whole {...}. */
function attrsOf(text) {
  const at = text.indexOf('mAttrs={');
  if (at < 0) return null;
  let depth = 0;
  for (let i = at + 7; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(at + 8, i).replace(/\s+/g, ' ').trim();
    }
  }
  return text.slice(at + 8).replace(/\s+/g, ' ').trim();
}

function pickFrame(rects) {
  for (const k of ['mFrame', 'frame', 'mWindowFrames.mFrame', 'parent', 'containing', 'display']) {
    if (rectValid(rects[k])) return { rect: rects[k], source: k };
  }
  return null;
}

/* ---- geometry recovery ----------------------------------------------------
   A plain `dumpsys window` (no -a) prints window blocks with no mFrame and no
   Frames:. The frames are still in the dump, just in other sections, so gather
   them into lookup tables keyed by window hash and by task id. */

/* "<hash> <title>, frame=[l,t,r,b], touchableRegion=..." — accessibility
   observer lists and input window handles. */
const HANDLE_RE = /\b([0-9a-f]{4,10})\s+[^\n,]{0,240}?,\s*frame=\[(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\]/g;
/* "Task{hash #id ...}" followed by an indented "bounds=[l,t][r,b]". */
const TASK_BOUNDS_RE = /Task\{\S+\s+#(\d+)[^\n]*\n\s*bounds=\[(-?\d+),\s*(-?\d+)\]\[(-?\d+),\s*(-?\d+)\]/g;
/* "displayId=0, mLogicalSize=3904x1320" — display size without a Display block. */
const LOGICAL_SIZE_RE = /displayId=(\d+),\s*mLogicalSize=(\d+)x(\d+)/g;

function buildGeometry(text) {
  const byHash = new Map();
  const byTask = new Map();
  const sizeById = new Map();
  let m;

  HANDLE_RE.lastIndex = 0;
  while ((m = HANDLE_RE.exec(text)) !== null) {
    const rect = rectFrom(m, 2);
    if (!byHash.has(m[1]) && rectValid(rect)) byHash.set(m[1], { rect, source: 'window handle' });
  }

  /* InsetsSourceProvider blocks: mSourceFrame=Rect(l, t - r, b) then
     mWindowContainer=Window{hash ...}. Only the bars appear here, but they are
     exactly the windows a gravity guess gets least right. */
  let pending = null;
  for (const line of text.split('\n')) {
    if (/InsetsSourceProvider\b/.test(line)) { pending = null; continue; }
    const f = line.match(/mSourceFrame=Rect\((-?\d+),\s*(-?\d+)\s*-\s*(-?\d+),\s*(-?\d+)\)/);
    if (f) { pending = rectFrom(f, 1); continue; }
    const c = line.match(/mWindowContainer=Window\{(\S+)/);
    if (c && pending) {
      if (!byHash.has(c[1]) && rectValid(pending)) byHash.set(c[1], { rect: pending, source: 'insets source' });
      pending = null;
    }
  }

  TASK_BOUNDS_RE.lastIndex = 0;
  while ((m = TASK_BOUNDS_RE.exec(text)) !== null) {
    const rect = rectFrom(m, 2);
    if (!byTask.has(+m[1]) && rectValid(rect)) byTask.set(+m[1], { rect, source: 'task bounds' });
  }

  LOGICAL_SIZE_RE.lastIndex = 0;
  while ((m = LOGICAL_SIZE_RE.exec(text)) !== null) {
    if (!sizeById.has(+m[1])) sizeById.set(+m[1], { w: +m[2], h: +m[3] });
  }

  return { byHash, byTask, sizeById };
}

/* Last resort: lay the window out from mAttrs — the requested size placed on
   the display by gravity. Gravity is printed with its component bits, so LEFT
   arrives as "LEFT CENTER_HORIZONTAL"; an explicit edge always wins over the
   centre bit it contains. */
function deriveFrame(w, disp) {
  if (!disp || !disp.size) return null;
  const dw = disp.size.w, dh = disp.size.h;
  const spec = (w.attrs || '').match(/^\((-?\d+),\s*(-?\d+)\)\(([-\w]+)x([-\w]+)\)/);
  const dim = (s, full) => (s === 'fill' ? full : /^-?\d+$/.test(s) ? +s : null);

  const x = spec ? +spec[1] : 0;
  const y = spec ? +spec[2] : 0;
  const ww = w.requested && w.requested.w > 0 ? w.requested.w : spec ? dim(spec[3], dw) : null;
  const hh = w.requested && w.requested.h > 0 ? w.requested.h : spec ? dim(spec[4], dh) : null;
  if (!(ww > 0 && hh > 0)) return null;

  const g = w.gravity || '';
  const has = (t) => new RegExp('\\b' + t + '\\b').test(g);
  /* Gravity.toString collapses CENTER_HORIZONTAL|CENTER_VERTICAL back to the
     one word CENTER, so a centred window prints `gr=CENTER` and never names
     the axis. Reading only the axis words placed it at the origin instead. */
  const centred = (axis) => has(axis) || has('CENTER');

  let l;
  if (has('RIGHT') && !has('LEFT')) l = dw - ww - x;
  else if (!has('LEFT') && (centred('CENTER_HORIZONTAL') || has('FILL_HORIZONTAL'))) l = Math.round((dw - ww) / 2) + x;
  else l = x;

  let t;
  if (has('BOTTOM') && !has('TOP')) t = dh - hh - y;
  else if (!has('TOP') && (centred('CENTER_VERTICAL') || has('FILL_VERTICAL'))) t = Math.round((dh - hh) / 2) + y;
  else t = y;

  return { l, t, r: l + ww, b: t + hh };
}

function parseWindowBlock(text, index, hash, user, title) {
  const { rects, props } = harvest(text);
  const attrs = attrsOf(text);
  const attrText = attrs || '';

  let ty = (attrText.match(/\bty=([A-Z0-9_]+)/) || [])[1] || null;
  if (ty && /^\d+$/.test(ty)) ty = TYPE_INTS[+ty] || ('TYPE ' + ty);
  const gravity = (attrText.match(/\bgr=([A-Z_ ]+?)(?=\s+\w+=|$)/) || [])[1] || null;
  const flags = (attrText.match(/\bfl=([A-Z0-9_ ]+?)(?=\s+\w+=|$)/) || [])[1] || null;
  const privFlags = (attrText.match(/\bpfl=([A-Z0-9_ ]+?)(?=\s+\w+=|$)/) || [])[1] || null;
  const format = (attrText.match(/\bfmt=([A-Z0-9_]+)/) || [])[1] || null;

  const num = (k) => (props[k] !== undefined && /^-?\d+$/.test(props[k]) ? +props[k] : null);
  const bool = (k) => (props[k] === 'true' ? true : props[k] === 'false' ? false : null);

  const framePick = pickFrame(rects);
  const req = text.match(/Requested w=(-?\d+)\s+h=(-?\d+)/);
  const reqW = req && req[1];
  const reqH = req && req[2];

  let visible = bool('isVisible');
  if (visible === null) {
    const vv = props['mViewVisibility'];
    const surf = bool('mHasSurface');
    if (vv !== undefined) visible = vv === '0x0' && surf !== false;
  }

  return {
    index,
    hash,
    user: user || null,
    title: title.replace(/\s+EXITING$/, ''),
    exiting: /\sEXITING$/.test(title) || props['mAnimatingExit'] === 'true',
    pkg: props['package'] || null,
    displayId: num('mDisplayId') !== null ? num('mDisplayId') : 0,
    rootTaskId: num('rootTaskId'),
    ownerUid: num('mOwnerUid'),
    type: ty,
    gravity,
    flags: flags ? flags.trim().split(/\s+/) : [],
    privFlags: privFlags ? privFlags.trim().split(/\s+/) : [],
    format,
    baseLayer: num('mBaseLayer'),
    subLayer: num('mSubLayer'),
    token: props['mToken'] || null,
    viewVisibility: props['mViewVisibility'] || null,
    hasSurface: bool('mHasSurface'),
    obscured: bool('mObscured'),
    onScreen: bool('isOnScreen'),
    visible: visible === null ? false : visible,
    requested: req ? { w: +reqW, h: +reqH } : null,
    frame: framePick ? framePick.rect : null,
    frameSource: framePick ? framePick.source : null,
    rects,
    props,
    attrs,
    raw: text,
  };
}

const notNull = (v) => (v === undefined || v === null || v === 'null' ? null : v);

/* Windows of one family are drawn as one colour, so the family is also what
   decides which windows need telling apart from each other. */
const TYPE_FAMILIES = [
  [/WALLPAPER/, 'wallpaper'],
  [/INPUT_METHOD/, 'ime'],
  [/(STATUS_BAR|NAVIGATION_BAR|NOTIFICATION_SHADE|SYSTEM_BAR)/, 'bar'],
  [/(TOAST|SYSTEM_ALERT|APPLICATION_OVERLAY|SYSTEM_OVERLAY|SCREENSAVER)/, 'alert'],
  [/(PANEL|DIALOG|MEDIA|ATTACHED)/, 'panel'],
  [/APPLICATION/, 'app'],
];
function typeFamily(type) {
  if (!type) return 'other';
  for (const [re, name] of TYPE_FAMILIES) if (re.test(type)) return name;
  return 'other';
}

function parseDisplayBlock(text, id) {
  const init = text.match(/init=(\d+)x(\d+)/);
  const cur = text.match(/cur=(\d+)x(\d+)/);
  const app = text.match(/app=(\d+)x(\d+)/);
  const rng = text.match(/rng=(\d+)x(\d+)-(\d+)x(\d+)/);
  const dpi = text.match(/(\d+)dpi/);
  const rot = text.match(/mCurrentRotation=(?:ROTATION_)?(\w+)/)
           || text.match(/\bmRotation=(?:ROTATION_)?(\w+)/)
           || text.match(/\bmDisplayRotation=(?:ROTATION_)?(\w+)/)
           || text.match(/DisplayFrames w=\d+ h=\d+ r=(\d+)/)
           || text.match(/\brotation=(\w+)/);
  const name = text.match(/mDisplayInfo=DisplayInfo\{"([^"]+)"/);
  const dp = text.match(/\bsw(\d+)dp\s+w(\d+)dp\s+h(\d+)dp/);
  const cfg = text.match(/overrideConfig=\{([^\n]*)/);
  const cfgTok = (re) => (cfg ? (cfg[1].match(re) || [])[1] : null) || null;
  const cfgWord = (alts) => cfgTok(new RegExp('(?<![?\\w])(' + alts + ')\\b'));
  const cutout = text.match(/mDisplayCutout=DisplayCutout\{insets=Rect\((-?\d+),\s*(-?\d+)\s*-\s*(-?\d+),\s*(-?\d+)\)/);
  const cutIns = cutout ? { l: +cutout[1], t: +cutout[2], r: +cutout[3], b: +cutout[4] } : null;

  // Every insets source the display publishes — the bars, the IME, the cutout.
  const insets = [];
  const seenIns = new Set();
  const INSET_RE = /InsetsSource id=(\S+) type=(\w+) frame=\[(-?\d+),\s*(-?\d+)\]\[(-?\d+),\s*(-?\d+)\] visible=(\w+)/g;
  let m;
  while ((m = INSET_RE.exec(text)) !== null) {
    if (seenIns.has(m[1])) continue;
    seenIns.add(m[1]);
    insets.push({ id: m[1], type: m[2], rect: rectFrom(m, 3), visible: m[7] === 'true' });
  }

  return {
    id,
    name: name ? name[1] : null,
    size: cur ? { w: +cur[1], h: +cur[2] } : init ? { w: +init[1], h: +init[2] } : null,
    initSize: init ? { w: +init[1], h: +init[2] } : null,
    appSize: app ? { w: +app[1], h: +app[2] } : null,
    sizeRange: rng ? { minW: +rng[1], minH: +rng[2], maxW: +rng[3], maxH: +rng[4] } : null,
    dpi: dpi ? +dpi[1] : null,
    dpSize: dp ? { sw: +dp[1], w: +dp[2], h: +dp[3] } : null,
    rotation: rot ? rot[1] : null,
    organized: /^\s*Display:[^\n]*\(organized\)/.test(text),
    orientation: cfgWord('land|port|square'),
    uiMode: cfgWord('car|television|watch|appliance|vrheadset|desk'),
    night: cfgWord('night|notnight'),
    cutoutInsets: cutIns && (cutIns.l || cutIns.t || cutIns.r || cutIns.b) ? cutIns : null,
    insets,
    focus: notNull((text.match(/^\s*mCurrentFocus=(.+)$/m) || [])[1]),
    focusedApp: notNull((text.match(/^\s*mFocusedApp=(.+)$/m) || [])[1]),
    imeTarget: null,
    raw: text,
  };
}

/* ---- the shape every parser hands back ---------------------------------- */

/* A parsed dump is displays plus nodes: things that sit on a display, carry a
   frame and stack in a z order. `dumpsys window` calls them windows and
   SurfaceFlinger calls them layers, but the list, the sheet and the z-order
   view need no more than that, so that is all the shared shape says:

     hash         unique in the dump; what selection and hit-testing key on
     title        what the row and the label read
     displayId    which display it sits on
     frame        the rect to draw in display pixels, or null to leave undrawn
     frameSource  where that rect came from, named for the details pane
     z            bigger is nearer the front
     family       picks the colour; typeLabel is what groups the legend
     search       what the filter box matches against
     badges       [label, class] pairs shown after the title
     raw          the block of dump text the node was read out of

   Anything else a parser harvests is its own business and shows up only in
   the details pane its tool renders. */

/* The display list: blocks the dump described win, a display some node names
   but the dump never described is synthesised, and a display with no stated
   size takes one from a hint or from how far its own nodes reach. */
function buildDisplays(blocks, nodes, sizeHints) {
  const byId = new Map();
  for (const d of blocks) if (!byId.has(d.id)) byId.set(d.id, d);
  for (const n of nodes) {
    if (byId.has(n.displayId)) continue;
    byId.set(n.displayId, { id: n.displayId, name: null, size: null, insets: [], raw: '' });
  }
  for (const d of byId.values()) {
    if (d.size) continue;
    const hint = sizeHints && sizeHints.get(d.id);
    if (hint) { d.size = hint; d.synthesised = true; continue; }
    let w = 0, h = 0;
    for (const n of nodes) {
      if (n.displayId !== d.id || !n.frame) continue;
      w = Math.max(w, n.frame.r);
      h = Math.max(h, n.frame.b);
    }
    d.size = w && h ? { w, h } : { w: 1080, h: 1920 };
    d.synthesised = true;
  }
  return byId;
}

/* Ordering is shared too: sort each display's nodes by the z its parser worked
   out, hand out the rank the labels read, and give the nodes of one family the
   shades that keep them apart. */
function finaliseScene(tool, displays, nodes, globals) {
  const out = [...displays].sort((a, b) => a.id - b.id);
  for (const d of out) {
    d.nodes = nodes.filter((n) => n.displayId === d.id).sort((a, b) => b.z - a.z);
    d.nodes.forEach((n, i) => { n.zRank = i; n.zCount = d.nodes.length; });
    const seen = new Map();
    for (const n of d.nodes) {
      const c = seen.get(n.family) || 0;
      n.tint = c;
      seen.set(n.family, c + 1);
    }
  }
  return { tool, displays: out, nodes, globals: globals || {}, ok: nodes.length > 0 };
}
