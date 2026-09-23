/* ================ parse: dumpsys SurfaceFlinger ================ */

/* SurfaceFlinger prints the same scene several times over, and which of the
 * lists a build prints has changed more than once. Telltale reads all of them and
 * joins on the `Name#id` every one of them carries:
 *
 *   the layer list — `+ BufferStateLayer (Name#3) uid=10046` on older builds,
 *   `+ Layer (Name#3) uid=10046` or `* Layer 0x… (Name#3)` on newer ones.
 *   Carries layerStack, z, pos, crop, colour, flags, the regions, the parent
 *   and the active buffer. Every layer is in it, composited or not.
 *
 *   the composition layers — `* Layer 0x… (Name#3)` under `Composition
 *   layers`, the compositor's own view of each layer: geomLayerBounds, alpha,
 *   blend and composition type, but no position and no layer stack.
 *
 *   the output layers — `- Output Layer 0x…(Name#3)` nested under each
 *   display, which is where the newer builds keep the geometry that matters:
 *   `displayFrame`, already in display coordinates, plus the visible region
 *   and what the composer did with the layer.
 *
 *   the HWC table — under `Display … HWC layers:`, two lines per layer that
 *   reached the compositor: its z, its window type, how it was composited and
 *   the frame it was composited into.
 *
 * Android 15 replaced the first two of those with the new frontend's own
 * lists, and Android 16 is the first release where nothing else is left:
 *
 *   the composition list — `Layer [105] Name#105` under `Composition list`,
 *   one entry per layer with something to draw, carrying the bounds already
 *   in display coordinates, the transform that got them there, the input
 *   config, and a `reason=` that spells out what the layer is made of.
 *
 *   the input list — the same entries for every layer input knows about,
 *   invisible ones included, each with the reason it is not drawn.
 *
 *   the hierarchy — `Layer Hierarchy`, a drawn tree of every layer there is,
 *   which is where a modern dump keeps parentage, the owning pid and uid, and
 *   the layers that reach neither the screen nor input. `Offscreen Hierarchy`
 *   is the same tree for the layers detached from any display.
 *
 * A layer's blocks are collected in the order the file prints them and parsed
 * as one, so the first block to state a field is the one that wins and a
 * build that only prints half of them still resolves. The lists disagree on
 * how much of a long name they print, so they are joined on the layer id in
 * the `#12` every one of them ends with rather than on the name itself. */

/* One head shape covers all four lists: an optional class (one or two words),
   an optional handle, and a parenthesised name ending in the sequence number
   SurfaceFlinger appended to it. That trailing `#12` is what makes a name a
   usable key, and what keeps this off the `* DefaultTaskDisplayArea
   (organized)` lines a window dump prints in the same shape. */
const SF_LAYER_HEAD =
  /^(\s*)[-+*]\s+((?:[A-Za-z]\w*\s+)*?)(0x[0-9a-fA-F]+)?\s*\((.+#\d+)\)(?:\s+uid=(\d+))?\s*$/;
/* The new frontend's head: no bullet, no class and no parentheses — the
   layer's own id in brackets, the roots it is mirrored from if it is a
   mirror, a `(Secure)` marker if it holds protected content, then the name. */
const SF_SNAP_HEAD =
  /^(\s*)Layer \[(\d+)(?:\s+mirrored from\s+([\d,\s]*?))?\]\s+(?:(\(Secure\))\s+)?(\S.*?)\s*$/;
/* The lists the new frontend prints, and the layer stack header inside them.
   Which way round a list is printed changed between Android 16 and its first
   quarterly release, so the direction is read rather than assumed. */
const SF_LIST_HEAD = /^(Composition list|Input list)(?:\s+\((top to bottom|bottom to top)\))?\s*$/;
const SF_STACK_HEAD = /^\s*LayerStack=(\d+)\s*$/;
const SF_TREE_HEAD = /^(Layer Hierarchy|Offscreen Hierarchy|Mergeable Hierarchies)\s*$/;
/* A row of one of those trees: the box-drawing prefix says how deep it is. */
const SF_TREE_ROW = /^([ \u2502]*)(?:\u251c\u2500|\u2514\u2500)\s(.*)$/;
/* What a tree row says about a layer, in the order RequestedLayerState prints
   it: the name, then whatever of these the layer has, then pid and uid. */
const SF_TREE_BODY =
  /^(?:\((Relative|Mirroring)\)\s+)?(.+?)(?:\s+parent=(\d+))?(\s+handleNotAlive)?(?:\s+requestedFrameRate:\s*\{([^}]*)\})?(?:\s+dropInputMode=(\d+))?\s+pid=(-?\d+)\s+uid=(-?\d+)\s*$/;
const SF_DISPLAY_HEAD = /^(\s*)(?:[-+*]\s+)?(?:DisplayDevice|CompositionDisplay|Display)\b(.*)$/;
const SF_DISPLAY_LIST = /^\s*(?:Virtual\s+)?Display\s+(\d+)\s*$/;
/* Android 16's quarterly release prints `HWC layers (top to bottom):`, and
   the releases either side of it print `HWC layers:`. Neither the marker in
   the middle — `(active)` on some builds — nor the one on the end is worth
   losing the table over. */
const SF_HWC_HEAD = /^\s*Display\s+\S+.*\bHWC layers\b.*:\s*$/;
const SF_REGION_HEAD = /Region (\w+) \(.*?count=(\d+)\)/;
const SF_REGION_RECT = /^\s*\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\]\s*$/;
const SF_RULE = /^-{4,}\s*$/;
/* A block never runs past the next head or the next line at column 0, and
   never past this many lines — a dump that loses its shape should cost one
   wrong block, not the whole file. */
const SF_BLOCK_MAX = 400;

/* One head, whichever list printed it, read into the same shape: what the
   layer is called, the class and handle the older lists give it, and the id
   and markers the newer ones do. */
function sfHead(line) {
  const m = line.match(SF_LAYER_HEAD);
  if (m) {
    return { indent: m[1].length, cls: (m[2] || '').trim() || null, handle: m[3] || null,
             name: m[4].trim(), uid: m[5] === undefined ? null : +m[5],
             id: null, secure: false, mirrorOf: null };
  }
  const s = line.match(SF_SNAP_HEAD);
  if (!s) return null;
  return { indent: s[1].length, cls: null, handle: null, name: s[5].trim(), uid: null,
           id: +s[2], secure: !!s[4],
           mirrorOf: s[3] ? s[3].split(/[,\s]+/).filter(Boolean) : null };
}

/* The key every list agrees on. The hierarchy and the HWC table elide the
   middle of a long name, so the name itself will not join them; the layer id
   in the trailing `#12` will. */
function sfKey(name) {
  const m = name.match(/#(\d+)$/);
  return m ? m[1] : name;
}

/* The bits `flags=` prints, from layer_state_t. The text is what
   SurfaceControl documents each one as doing. */
const SF_FLAG_DOCS = {
  HIDDEN: { c:'eLayerHidden', v:'0x00000001', d:'The layer and everything parented under it is hidden. This is what SurfaceControl.Transaction.hide() sets.' },
  OPAQUE: { c:'eLayerOpaque', v:'0x00000002', d:'The layer is declared fully opaque, so SurfaceFlinger may skip drawing whatever it covers instead of blending over it.' },
  SKIP_SCREENSHOT: { c:'eLayerSkipScreenshot', v:'0x00000040', d:'The layer is left out of screenshots and screen recordings.' },
  SECURE: { c:'eLayerSecure', v:'0x00000080', d:'The layer holds protected content: it is excluded from screenshots and is not shown on non-secure displays.' },
  ENABLE_BACKPRESSURE: { c:'eEnableBackpressure', v:'0x00000100', d:'Frames from this layer are not dropped when the producer runs ahead of the compositor; the queue applies back pressure to the producer instead.' },
  DISPLAY_DECORATION: { c:'eLayerIsDisplayDecoration', v:'0x00000200', d:'The layer is display decoration — a rounded-corner or cutout overlay — which the composer may be able to place on dedicated hardware.' },
  REFRESH_RATE_INDICATOR: { c:'eLayerIsRefreshRateIndicator', v:'0x00000400', d:'The layer is the developer-option refresh rate indicator, and is ignored when refresh rate is chosen.' },
};
const SF_FLAG_BITS = [
  [0x001, 'HIDDEN'], [0x002, 'OPAQUE'], [0x040, 'SKIP_SCREENSHOT'], [0x080, 'SECURE'],
  [0x100, 'ENABLE_BACKPRESSURE'], [0x200, 'DISPLAY_DECORATION'], [0x400, 'REFRESH_RATE_INDICATOR'],
];

/* Name the bits that are set and keep whatever is left over as a hex chip, so
   a flag from a build newer than the table above still shows up. */
function sfFlagNames(hex) {
  if (!hex) return [];
  const bits = parseInt(hex, 16);
  if (!Number.isFinite(bits)) return [];
  const out = [];
  let rest = bits;
  for (const [bit, name] of SF_FLAG_BITS) {
    if (bits & bit) { out.push(name); rest &= ~bit; }
  }
  if (rest) out.push('0x' + (rest >>> 0).toString(16));
  return out;
}

const sfRect = (a, b, c, d) =>
  ({ l: Math.round(+a), t: Math.round(+b), r: Math.round(+c), b: Math.round(+d) });

/* SurfaceFlinger prints a rect of four numbers several ways depending on which
   struct is doing the printing — commas or spaces between them, ints or
   floats. One matcher covers the lot. */
function sfNamedRect(block, key) {
  const m = block.match(new RegExp('\\b' + key +
    '=\\[\\s*(-?[\\d.]+)[,\\s]+(-?[\\d.]+)[,\\s]+(-?[\\d.]+)[,\\s]+(-?[\\d.]+)\\s*\\]'));
  return m ? sfRect(m[1], m[2], m[3], m[4]) : null;
}

function unionRect(rects) {
  const ok = rects.filter(rectValid);
  if (!ok.length) return null;
  return ok.reduce((acc, rc) => ({
    l: Math.min(acc.l, rc.l), t: Math.min(acc.t, rc.t),
    r: Math.max(acc.r, rc.r), b: Math.max(acc.b, rc.b),
  }));
}

/* `0`/`1`, `true`/`false`, or absent. */
function sfBool(block, key) {
  const m = block.match(new RegExp('\\b' + key + '=(true|false|[01])\\b'));
  return m ? (m[1] === 'true' || m[1] === '1') : null;
}

/* ---- the HWC table -------------------------------------------------------

   Read by its own header row, so the four-column layout on older builds and
   the newer one with window type and transform both parse. Entries come in
   pairs — the name on one line, the numbers on the next — and newer builds
   rule off between every pair rather than only at the ends. */
function sfHwcTables(lines) {
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!SF_HWC_HEAD.test(lines[i])) continue;
    const table = { label: lines[i].trim().replace(/\s*HWC layers:$/, ''), rows: [] };
    let cols = null, name = null;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) break;                      // a blank line ends the table
      if (SF_RULE.test(line)) continue;             // rules sit between the rows
      if (indentOf(line) === 0) break;
      if (!line.includes('|')) { name = line.trim(); continue; }

      const cells = line.split('|').map((c) => c.trim());
      /* The z cell carries a `rel` marker when the layer is z-ordered relative
         to another one rather than to its parent. */
      const z = cells[0].match(/^(?:rel\s+)?(-?\d+)$/);
      if (!z) { if (!cols) cols = cells; continue; }
      const at = (want) => {
        const k = cols ? cols.findIndex((c) => c.startsWith(want)) : -1;
        return k < 0 ? null : cells[k];
      };
      const four = (s) => {
        const m = s && s.match(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
        return m ? sfRect(m[1], m[2], m[3], m[4]) : null;
      };
      table.rows.push({
        name, z: +z[1], relative: /^rel/.test(cells[0]),
        winType: at('Window Type'), comp: at('Comp Type'), transform: at('Transform'),
        frame: four(at('Disp Frame')), crop: four(at('Source Crop')),
        focused: /\[\*\]/.test(line),
      });
      name = null;
    }
    if (table.rows.length) tables.push(table);
  }
  return tables;
}

/* The table elides the middle of a long name — `com.foo/com.f[...]Activity#301`
   — so a name that carries the marker is matched on its two ends instead. */
function sfHwcLookup(tables) {
  const exact = new Map(), byId = new Map(), elided = [];
  for (const t of tables) {
    for (const row of t.rows) {
      if (!row.name) continue;
      /* Whatever the table did to the middle of the name, the layer id on the
         end of it survives, and that is what the other lists are keyed on. */
      const id = sfKey(row.name);
      if (id !== row.name && !byId.has(id)) byId.set(id, row);
      const cut = row.name.indexOf('[...]');
      if (cut < 0) { if (!exact.has(row.name)) exact.set(row.name, row); continue; }
      elided.push({ head: row.name.slice(0, cut), tail: row.name.slice(cut + 5), row });
    }
  }
  return (name) => exact.get(name)
    || byId.get(sfKey(name))
    || (elided.find((e) => name.startsWith(e.head) && name.endsWith(e.tail)) || {}).row
    || null;
}

/* ---- the hierarchy -------------------------------------------------------

   The tree under `Layer Hierarchy` is the only list a modern dump prints that
   holds every layer: the composition list stops at what is drawn and the input
   list at what can be touched. It is also the only place parentage is left,
   now that a layer block no longer prints `parent=`. Siblings are printed in
   z order, back to front, so the order this reads them in is the order they
   are drawn in — which is what the older lists were being read for too.

   `Offscreen Hierarchy` is the same tree for the layers hanging off no
   display at all; they are kept, marked, and left without a frame. */
function sfHierarchy(lines) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(SF_TREE_HEAD);
    if (!head) continue;
    const offscreen = head[1] !== 'Layer Hierarchy';
    /* The layer at each depth, and the display its subtree belongs to: a row
       is a child of whatever was last seen one step shallower. */
    const parents = [], stacks = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (/^\s*ROOT\s*$/.test(lines[j])) continue;
      const row = lines[j].match(SF_TREE_ROW);
      if (!row) break;                       // a blank line ends the tree
      const body = row[2].match(SF_TREE_BODY);
      if (!body) continue;                   // the `...` under a mirror root
      const depth = Math.floor(row[1].length / 3);   // `│  ` or three spaces a level
      const name = body[2].trim();
      const id = (name.match(/#(\d+)$/) || [])[1] || null;
      /* A tree's top layer is the display itself, and SurfaceFlinger names it
         after the layer stack everything under it is on. */
      const display = name.match(/^Display\s+(\d+)\b/);
      const parentId = depth > 0 ? parents[depth - 1] ?? null : null;
      const displayId = display ? +display[1] : depth > 0 ? stacks[depth - 1] ?? null : null;
      parents[depth] = id;
      stacks[depth] = displayId;
      parents.length = stacks.length = depth + 1;
      if (!id || seen.has(id)) continue;     // a mirror shows up under both roots
      seen.add(id);
      out.push({
        id, name, parentId, displayId, offscreen,
        order: out.length,
        /* A row printed `(Relative)` is z-ordered against a layer other than
           its parent, and that is the layer the `parent=` after it names. */
        relativeParent: body[3] || null,
        handleAlive: !body[4],
        frameRate: body[5] ? body[5].trim() : null,
        dropInputMode: body[6] ? +body[6] : null,
        pid: +body[7],
        uid: +body[8],
      });
    }
    /* Back one, so the line the tree stopped at — the next tree's own head,
       when two are printed one after the other — is looked at again. */
    i = j - 1;
  }
  return out;
}

/* ---- displays ------------------------------------------------------------

   SurfaceFlinger identifies a display to its layers by the layer stack, so
   that is the id Telltale keys on. Everything else about a display is printed
   under its composer id, in a separate list, so the two are joined on that. */
function sfDisplayList(lines) {
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SF_DISPLAY_LIST);
    if (!m) continue;
    const { text: block, next } = takeBlock(lines, i, indentOf(lines[i]));
    i = next - 1;
    if (!/name=|powerMode=|resolution=/.test(block)) continue;
    const one = (re) => (block.match(re) || [])[1] || null;
    out.set(m[1], {
      name: one(/^\s*name="([^"]*)"/m),
      powerMode: one(/\bpowerMode=(\w+)/),
      res: block.match(/\bresolution=(\d+)x(\d+)/),
      dpi: one(/\bdpi=([\d.]+)/),
      virtual: /^\s*Virtual\s+Display/.test(lines[i - (next - 1 - i)] || '') || null,
    });
  }
  return out;
}

function sfDisplayBlocks(lines, byComposerId) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!SF_DISPLAY_HEAD.test(lines[i]) || sfHead(lines[i])) continue;
    /* Two extents. The display's own text stops where the first output layer
       starts — that is what the details pane shows. The section runs on to
       the next line at column 0, output layers included, and which section a
       layer block falls inside is the only thing that says which display it
       is on when the layer itself never names a layer stack. */
    const head = indentOf(lines[i]);
    let end = i + 1;
    while (end < lines.length && end - i < SF_BLOCK_MAX) {
      const line = lines[end];
      if (line.trim() && (indentOf(line) <= head || sfHead(line))) break;
      end++;
    }
    let section = end;
    while (section < lines.length && !(lines[section].trim() && indentOf(lines[section]) === 0)) section++;
    const block = lines.slice(i, end).join('\n');
    const stack = block.match(/layerStack(?:Id)?=\s*(\d+)/);
    if (!stack) continue;                          // not a display after all
    const from = i;
    i = end - 1;

    const one = (re) => (block.match(re) || [])[1] || null;
    const pair = (re) => { const m = block.match(re); return m ? { w: +m[1], h: +m[2] } : null; };
    const composerId = one(/^\s*(?:[-+*]\s+)?Display\s+(\d+)\b/m);
    const listed = composerId ? byComposerId.get(composerId) : null;

    out.push({
      id: +stack[1],
      from, to: section,
      composerId,
      name: one(/displayName="([^"]*)"/) || one(/^\s*(?:[-+*]\s+)?Display\s+\d+\s*\((?:physical|virtual),\s*"([^"]*)"/m)
         || one(/^\s*[-+*]\s+DisplayDevice:\s*(.+)$/m) || (listed && listed.name) || null,
      size: pair(/(?:^|[^A-Za-z])displaySpace=ProjectionSpace\{bounds=Rect\(\s*-?\d+,\s*-?\d+,\s*(\d+),\s*(\d+)\)/)
         || pair(/orientedDisplaySpace=ProjectionSpace\{bounds=Rect\(\s*-?\d+,\s*-?\d+,\s*(\d+),\s*(\d+)\)/)
         || pair(/layerStackSpace=ProjectionSpace\{bounds=Rect\(\s*-?\d+,\s*-?\d+,\s*(\d+),\s*(\d+)\)/)
         || pair(/\((\d+)x(\d+)\)/)
         || pair(/(\d+)\s*x\s*(\d+),\s*ANativeWindow/)
         || pair(/\bframe:\s*\[\s*-?\d+[,\s]+-?\d+[,\s]+(\d+)[,\s]+(\d+)\s*\]/)
         || (listed && listed.res ? { w: +listed.res[1], h: +listed.res[2] } : null),
      dpi: listed && listed.dpi ? Math.round(+listed.dpi) : null,
      rotation: one(/\borient(?:ation)?=\s*(?:ROTATION_)?(\d)/)
             || one(/orientation=ROTATION_(\d)/),
      powerMode: (listed && listed.powerMode) || one(/\bpowerMode=(\w+)/),
      secure: sfBool(block, 'isSecure'),
      virtual: sfBool(block, 'isVirtual'),
      enabled: sfBool(block, 'isEnabled'),
      deviceComposition: sfBool(block, 'usesDeviceComposition'),
      clientComposition: sfBool(block, 'usesClientComposition'),
      insets: [],
      raw: block,
    });
  }
  return out;
}

/* ---- layers --------------------------------------------------------------

   Every rect a layer's blocks name, with the region rects folded in. */
function sfRegions(block) {
  const out = {};
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(SF_REGION_HEAD);
    if (!h) continue;
    const rects = [];
    for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j].match(SF_REGION_RECT);
      if (!m) break;
      rects.push(sfRect(m[1], m[2], m[3], m[4]));
    }
    if (!(h[1] in out)) out[h[1]] = rects;
    else out[h[1]] = out[h[1]].concat(rects);
  }
  return out;
}

/* The layer list spells it `VisibleRegion` and the output layers spell it
   `visibleRegion`; a layer can carry both, and either one having a rect in it
   means the layer reached the screen. */
const SF_VISIBLE_REGION = /^visibleRegion$/i;
const sfVisibleRects = (regions) =>
  Object.entries(regions).filter(([k]) => SF_VISIBLE_REGION.test(k)).flatMap(([, v]) => v);
const sfHasVisibleRegion = (regions) => Object.keys(regions).some((k) => SF_VISIBLE_REGION.test(k));

/* ---- one layer -----------------------------------------------------------

   `front` is what the lists outside this block said about the layer: its row
   in the hierarchy, which of the new frontend's lists it turned up in, and
   the markers its head carried. Everything else is read out of the block. */
function parseSfLayer(name, block, heads, index, hwcRow, sectionId, front) {
  const one = (re) => { const m = block.match(re); return m ? m[1] : null; };
  const int = (re) => { const v = one(re); return v === null ? null : Math.round(+v); };
  const flt = (re) => { const v = one(re); return v === null ? null : +v; };
  const tree = (front && front.tree) || null;

  /* Of the class names the several lists give one layer, the useful one is
     whichever is more specific than the bare `Layer` they all fall back to. */
  const classes = heads.map((h) => h.cls).filter(Boolean);
  const cls = classes.find((c) => /Layer$/.test(c) && c !== 'Layer' && c !== 'Output Layer')
           || classes.find((c) => c !== 'Output Layer') || null;
  const handle = (heads.find((h) => h.handle) || {}).handle || null;
  const uid = int(/\buid=(\d+)/) ?? (tree ? tree.uid : null);

  /* The new frontend prints one line per layer, and what it draws is spelled
     out in the `reason=` on it: `visible reason= buffer=99 frame=7 alpha=0.5
     contentDirty`, or `invisible reason=nothing to draw`. */
  const snap = block.match(/^\s*(visible|invisible) reason=(.*)$/m);
  const why = snap ? snap[2].trim() : null;
  const snapColor = snap && block.match(/\bcolor\{\s*(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/);
  const snapBuffer = snap ? one(/^\s*visible reason=.*?\bbuffer=(\d+)/m) : null;

  /* The input config the snapshot carries is the same set of flags the input
     dispatcher prints, and the only thing in a modern dump that says what a
     layer is for when the HWC table does not name a window type. */
  const inputLine = (block.match(/^\s*input\{.*$/m) || [''])[0];
  const inputFlags = (inputLine.match(/^\s*input\{\(([^)]*)\)/) || [])[1];

  /* What it took to get the layer's own coordinates onto the display: a
     rotation, a scale, a translation, or any two of them. */
  const td = (block.match(/toDisplayTransform=\{([^}]*)\}/) || [])[1] || null;
  const tdNum = (re) => { const m = td && td.match(re); return m ? +m[1] : null; };
  const toDisplay = td ? {
    rotate: (td.match(/\b(ROT_\d+|FLIP_[HV]|ROT_INVALID)\b/) || [])[1] || null,
    sx: tdNum(/\bscale x=(-?[\d.]+)/), sy: tdNum(/\by=(-?[\d.]+)/),
    tx: tdNum(/\btx=(-?[\d.]+)/), ty: tdNum(/\bty=(-?[\d.]+)/),
  } : null;

  const pos = block.match(/\bpos=\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
  const size = block.match(/\bsize=\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
  const color = block.match(/\bcolor=[([]\s*(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)(?:[,\s]+(-?[\d.]+))?\s*[)\]]/);
  const buffer = block.match(/\bactiveBuffer=\[\s*(\d+)\s*x\s*(\d+)\s*:\s*(\d+),\s*([^\]]*)\]/);
  const tr = block.match(/\btr=\[\s*(-?[\d.]+),\s*(-?[\d.]+)\]\[\s*(-?[\d.]+),\s*(-?[\d.]+)\]/);
  const regions = sfRegions(block);
  const flags = one(/\bflags=(0x[0-9a-fA-F]+)/);

  /* A build that prints no activeBuffer line still says whether the layer is
     holding a buffer handle, which tells a buffer layer from a container even
     though it gives no size. */
  const bufferSize = !!(buffer && +buffer[1] > 0 && +buffer[2] > 0);
  const hasBuffer = bufferSize || /\bbuffer:\s*buffer=0x0*[1-9a-f]/.test(block)
    || +snapBuffer > 0;

  const x = pos ? Math.round(+pos[1]) : null;
  const y = pos ? Math.round(+pos[2]) : null;
  const w = size ? Math.round(+size[1]) : null;
  const h = size ? Math.round(+size[2]) : null;

  /* Only rects already in the display's own coordinates are worth drawing
     from. A crop and the compositor's geomLayerBounds are in the layer's, so
     drawing one as a screen rect would put a bottom bar at the top of the
     sheet; they are read and shown but never drawn. */
  const rects = {};
  if (hwcRow && rectValid(hwcRow.frame)) rects['hwc frame'] = hwcRow.frame;
  for (const [key, as] of [['displayFrame', 'display frame'],
                           ['screenBounds', 'screen bounds'],
                           ['bounds', 'bounds']]) {
    const rc = sfNamedRect(block, key);
    if (rectValid(rc)) rects[as] = rc;
  }
  /* The new frontend prints a layer's bounds already transformed into display
     coordinates — and prints them left, top, bottom, right, the order the
     struct is laid out in rather than the order every other rect in the dump
     comes in. Same for a touchable region. */
  /* The four numbers as the dump wrote them come back with the rect, because
     anyone reading the pane against the dump is looking for those numbers and
     not for the ones they mean: a rect that quietly reorders itself reads as a
     rect that is missing. */
  const printed = {};
  const braceRect = (re, from, as) => {
    const m = from.match(re);
    if (!m) return null;
    printed[as] = `${m[1]},${m[2]},${m[3]},${m[4]}`;
    return sfRect(m[1], m[2], m[4], m[3]);
  };
  const snapBounds = braceRect(/\bbounds=\{\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\}/, block, 'bounds');
  if (!rects.bounds && rectValid(snapBounds)) rects.bounds = snapBounds;
  if (x !== null && w > 0 && h > 0) rects['pos+size'] = { l: x, t: y, r: x + w, b: y + h };
  const seen = unionRect(sfVisibleRects(regions));
  if (rectValid(seen)) rects['visible region'] = seen;
  const touchRect = braceRect(/\btouchableRegion=\{\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\}/, inputLine, 'touchable region');
  if (rectValid(touchRect)) rects['touchable region'] = touchRect;
  if (bufferSize && x !== null) {
    rects.buffer = { l: x, t: y, r: x + +buffer[1], b: y + +buffer[2] };
  }
  for (const [key, as] of [['crop', 'crop (layer space)'],
                           ['geomLayerBounds', 'geom bounds (layer space)'],
                           ['sourceCrop', 'source crop (layer space)']]) {
    const rc = sfNamedRect(block, key);
    if (rectValid(rc)) rects[as] = rc;
  }
  if (hwcRow && rectValid(hwcRow.crop)) rects['source crop (layer space)'] = hwcRow.crop;

  /* The composer's own display frame first: absolute, post-transform, and the
     rect the layer really occupied. What follows is what is left when a build
     does not print it. */
  const order = ['hwc frame', 'display frame', 'screen bounds', 'bounds',
                 'pos+size', 'visible region', 'buffer'];
  const exact = new Set(['hwc frame', 'display frame', 'screen bounds', 'bounds', 'pos+size']);
  const key = order.find((k) => rectValid(rects[k])) || null;

  const flagNames = sfFlagNames(flags);
  /* A colour of -1 is how an unset colour prints; alpha is stated on its own
     by the composition list and as the fourth channel by the layer list. */
  const rgb = color && +color[1] >= 0 ? [+color[1], +color[2], +color[3]]
    : snapColor ? [+snapColor[1], +snapColor[2], +snapColor[3]] : null;
  const alpha = flt(/(?:^|[^\w])alpha=([\d.]+)/) ?? (color && color[4] !== undefined ? +color[4] : null);
  /* The new frontend says outright whether a layer is visible, and why it is
     not. A layer it knows only from the hierarchy reached neither the screen
     nor input, and the dump says no more about it than that. */
  const visible = snap ? snap[1] === 'visible'
    : tree && !block ? false
    : flagNames.includes('HIDDEN') || alpha === 0 ? false
    : sfHasVisibleRegion(regions) ? sfVisibleRects(regions).some(rectValid)
    : true;
  const secure = flagNames.includes('SECURE') || heads.some((h) => h.secure);

  /* Newer builds print every layer as plain `Layer`, so where the class name
     says nothing, say what the layer is made of instead. */
  const kind = cls && cls !== 'Layer' ? cls
    : hasBuffer ? 'Buffer layer'
    : snapColor ? 'Effect layer'
    : 'Container layer';

  /* The HWC table's window type is the one thing in a SurfaceFlinger dump that
     says what a layer is *for*, and it is the same number `dumpsys window`
     prints as `ty=`. Colour and group by it wherever it is there, so one
     device reads in one set of colours whichever dump you are looking at.
     A window type of 0 means the layer is not a window at all. */
  const winTypeNum = hwcRow && /^-?\d+$/.test(hwcRow.winType || '') ? +hwcRow.winType : null;
  const winType = winTypeNum ? TYPE_INTS[winTypeNum] || null : null;

  const comp = (hwcRow && hwcRow.comp)
    || one(/\bcomposition=([A-Z][A-Z_]+)/)
    || one(/\bcomposition type=([A-Z][A-Z_]+)/);

  return {
    hash: 'sf' + index,
    index,
    title: name,
    layerId: (name.match(/#(\d+)$/) || [])[1] || null,
    cls, handle, uid,
    pid: tree ? tree.pid : null,
    displayId: int(/\blayerStack=\s*(-?\d+)/) ?? (tree && tree.displayId) ?? sectionId ?? 0,
    z: index,                       // the lists are printed back to front
    layerZ: int(/(?:^|[,\s])z=\s*(-?\d+)/) ?? (hwcRow ? hwcRow.z : null),
    parent: notNull((one(/^\s*parent=(.+)$/m) || '').trim() || null),
    parentId: tree ? tree.parentId : null,
    relativeOf: notNull((one(/^\s*zOrderRelativeOf=(.+)$/m) || '').trim() || null),
    relativeParent: tree ? tree.relativeParent : null,
    offscreen: !!(tree && tree.offscreen),
    mirrorOf: (heads.find((h) => h.mirrorOf) || {}).mirrorOf || null,
    frameRate: tree ? tree.frameRate : null,
    handleAlive: tree ? tree.handleAlive : null,
    dropInput: tree ? tree.dropInputMode : null,
    frame: key ? rects[key] : null,
    frameSource: key,
    frameDerived: !!key && !exact.has(key),
    rects,
    pos: x === null ? null : { x, y },
    size: w > 0 && h > 0 ? { w, h } : null,
    alpha,
    color: rgb,
    flags: flagNames,
    flagsHex: flags,
    opaque: sfBool(block, 'isOpaque'),
    isProtected: sfBool(block, 'isProtected'),
    trustedOverlay: sfBool(block, 'isTrustedOverlay'),
    cornerRadius: flt(/\bcornerRadius=([\d.]+)/),
    blurRadius: int(/\bbackgroundBlurRadius=(\d+)/),
    shadowRadius: flt(/\bshadowRadius=([\d.]+)/),
    /* The layer list ends the value at a comma, but an output layer writes
       it mid-line with the next field right behind it — `dataspace=V0_SRGB
       (142671872) whitePointNits=-1.0`. The value itself has spaces in it
       (`BT709 sRGB Full range`), so it runs to the comma, the end of the
       line, or the next `name=`, whichever comes first. */
    dataspace: notNull((one(/\bdataspace=(.*?)(?=,|$|\s+[\w.]+=)/m) || '').trim() || null),
    pixelFormat: one(/\b(?:defaultPixelFormat|pixelFormat)=([^,\s]+)/),
    buffer: bufferSize ? { w: +buffer[1], h: +buffer[2], stride: +buffer[3], format: buffer[4].trim() } : null,
    hasBuffer,
    bufferId: snapBuffer,
    frameNumber: snap ? int(/^\s*visible reason=.*?\bframe=(\d+)/m) : null,
    contentDirty: /\bcontentDirty\b/.test(block),
    queued: int(/queued-frames=(\d+)/),
    transform: tr ? [+tr[1], +tr[2], +tr[3], +tr[4]] : null,
    toDisplay,
    regions,
    /* Why the frontend drew it, or why it did not. Empty on a visible layer
       that is nothing but a buffer, which is most of them. */
    reason: why,
    /* Keyed by the same names `rects` uses, for the rects the new frontend
       printed in its own order. */
    printed,
    inputFlags: inputFlags ? inputFlags.split(/\s*\|\s*/).map((f) => f.trim()).filter(Boolean) : null,
    touchable: rectValid(touchRect) ? touchRect : null,
    touchCropId: (inputLine.match(/touchCropId=(\d+)/) || [])[1] || null,
    touchCrop: /replaceTouchableRegionWithCrop/.test(inputLine),
    secure,
    comp: comp === 'INVALID' ? null : comp,
    winType, winTypeNum, kind,
    hwcTransform: hwcRow ? hwcRow.transform : null,
    focused: !!(hwcRow && hwcRow.focused),
    visible,
    family: winType ? typeFamily(winType)
          : /Container/i.test(kind) ? 'sf-container'
          : /Effect|Color|Dim/i.test(kind) ? 'sf-effect'
          : 'sf-buffer',
    typeLabel: winType || kind,
    badges: [
      ...(comp && comp !== 'INVALID' ? [[comp.toLowerCase(), 'badge-comp']] : []),
      ...(flagNames.includes('HIDDEN') ? [['hidden', 'badge-exit']] : []),
      ...(secure ? [['secure', 'badge-exit']] : []),
      ...(tree && tree.offscreen ? [['offscreen', 'badge-exit']] : []),
    ],
    search: `${name} ${cls || ''} ${kind} ${winType || ''} ${comp || ''} ${why || ''} ${inputFlags || ''}`.toLowerCase(),
    raw: block,
  };
}

/* ---- what does not fit on the display ------------------------------------

   A layer's rect is only wrong relative to something, and the something is the
   display. Two readings go wrong without it: the new frontend prints bounds
   left, top, bottom, right, so a layer that kept the previous rotation reads
   as a perfectly plausible rect in the list, and a layer that has walked off
   the screen entirely reads as one too.

   Only where the display stated a size of its own — a size Telltale worked out
   from how far the layers reach cannot be overrun, and flagging it would flag
   the layer the size was taken from. Only visible layers, because a modern
   dump is full of input sinks whose bounds are deliberately larger than any
   screen and which are drawn by nothing. */
function sfOffDisplay(display, n) {
  if (!display || !display.size || display.synthesised) return null;
  if (!n.visible || !rectValid(n.frame)) return null;
  const { w, h } = display.size;
  const over = {
    l: Math.max(0, -n.frame.l), t: Math.max(0, -n.frame.t),
    r: Math.max(0, n.frame.r - w), b: Math.max(0, n.frame.b - h),
  };
  if (!(over.l || over.t || over.r || over.b)) return null;
  const fw = n.frame.r - n.frame.l, fh = n.frame.b - n.frame.t;
  return {
    size: { w, h },
    over,
    /* The frame is the display's own size the other way round, which is what a
       layer left in the other rotation looks like. */
    transposed: w !== h && fw === h && fh === w,
    /* No part of it is on the display at all. */
    clear: n.frame.l >= w || n.frame.t >= h || n.frame.r <= 0 || n.frame.b <= 0,
  };
}

function parseSurfaceFlingerDump(input) {
  const text = dumpText(input);
  const lines = text.split('\n');

  const tables = sfHwcTables(lines);
  const hwcFor = sfHwcLookup(tables);
  const displayBlocks = sfDisplayBlocks(lines, sfDisplayList(lines));
  const stackAt = (line) => {
    const d = displayBlocks.find((x) => line > x.from && line < x.to);
    return d ? d.id : null;
  };

  const tree = sfHierarchy(lines);
  const treeFor = new Map(tree.map((t) => [t.id, t]));

  /* Collect every block each layer appears in, in the order the file prints
     them, then parse the lot as one text. First to state a field wins, which
     puts the lists in the order they were printed. Blocks are filed under the
     layer id rather than the name, because the lists that elide a long name
     are not the lists that print the fields. */
  const order = [], blocks = new Map(), heads = new Map(), section = new Map();
  const names = new Map(), lists = new Map();
  /* Two things only the lines between the heads say: which layer stack the
     entries that follow are on, and which of the new frontend's lists they
     belong to. Both last until the next unindented line. */
  let listStack = null, list = null, topFirst = false;
  for (let i = 0; i < lines.length; i++) {
    const stack = lines[i].match(SF_STACK_HEAD);
    if (stack) { listStack = +stack[1]; continue; }
    const listHead = lines[i].match(SF_LIST_HEAD);
    if (listHead) {
      list = listHead[1];
      if (listHead[2] && list === 'Composition list') topFirst = listHead[2] === 'top to bottom';
      listStack = null;
      continue;
    }
    if (lines[i].trim() && indentOf(lines[i]) === 0) { list = null; listStack = null; }

    const head = sfHead(lines[i]);
    if (!head) continue;
    let end = i + 1;
    while (end < lines.length && end - i < SF_BLOCK_MAX) {
      const line = lines[end];
      if (line.trim() && (indentOf(line) === 0 || sfHead(line))) break;
      end++;
    }
    while (end > i + 1 && !lines[end - 1].trim()) end--;
    const key = sfKey(head.name);
    if (!blocks.has(key)) {
      order.push(key);
      blocks.set(key, []); heads.set(key, []); lists.set(key, new Set());
    }
    const block = lines.slice(i, end).join('\n');
    /* The composition list and the input list print the same entry twice, word
       for word, when a layer is in both. Reading it twice changes nothing;
       showing it twice in the raw block only makes it harder to read. */
    if (!blocks.get(key).includes(block)) blocks.get(key).push(block);
    heads.get(key).push(head);
    /* The hierarchy elides the middle of a long name and the lists that carry
       the fields do not, so the longest name any list gave it wins. */
    if ((names.get(key) || '').length < head.name.length) names.set(key, head.name);
    if (list) lists.get(key).add(list);
    // The composition list is printed outside any display's section, so keep
    // looking until a block turns up inside one.
    if (section.get(key) == null) section.set(key, stackAt(i) ?? listStack);
    i = end - 1;
  }

  /* Which layers there are, and in which order. A dump with a hierarchy in it
     has every layer there, drawn back to front, including the ones no other
     list mentions because they reach neither the screen nor input; without
     one, the lists themselves are all there is. */
  const keys = [];
  const taken = new Set();
  /* Offscreen first, so the layers hanging off no display at all sit under
     everything that is on one rather than on top of it. */
  for (const t of [...tree].sort((a, b) => (a.offscreen ? 0 : 1) - (b.offscreen ? 0 : 1))) {
    keys.push(t.id); taken.add(t.id);
  }
  /* Which way round the composition list is printed changed between Android
     16 and its first quarterly release, and the header says which it is. A
     dump with no hierarchy in it has nothing else to go on. */
  const rest = topFirst && !tree.length ? [...order].reverse() : order;
  for (const k of rest) if (!taken.has(k)) { keys.push(k); taken.add(k); }

  /* Through finaliseScene rather than by hand: the shape a parser hands back
     is stated in one place, so an empty reading of this dump is the same kind
     of thing as an empty reading of any other. */
  if (!keys.length) return finaliseScene('sf', [], [], {});

  const layers = keys.map((key, i) => {
    const name = names.get(key) || (treeFor.get(key) || {}).name || key;
    return parseSfLayer(name, (blocks.get(key) || []).join('\n\n'),
                        heads.get(key) || [], i, hwcFor(name), section.get(key),
                        { tree: treeFor.get(key) || null,
                          lists: lists.get(key) || new Set() });
  });

  /* Resolve parentage to the layers it names. A modern dump parents
     everything to something — a task, a window token, an animation leash —
     and walking that chain is usually how you find out why a layer is where
     it is, or why it is nowhere. The older lists name the parent; the
     hierarchy gives its id, which is the one the lists elide nothing of. */
  const byTitle = new Map(layers.map((l) => [l.title, l]));
  const byLayerId = new Map(layers.map((l) => [l.layerId, l]));
  const up = (l) => (l.parentId ? byLayerId.get(l.parentId) : byTitle.get(l.parent)) || null;
  const kids = new Map();
  for (const l of layers) {
    const chain = [], seen = new Set([l.hash]);
    for (let a = up(l); a && !seen.has(a.hash); a = up(a)) {
      seen.add(a.hash);
      chain.unshift(a);
    }
    l.ancestors = chain.map((a) => ({ hash: a.hash, title: a.title }));
    l.parentHash = chain.length ? chain[chain.length - 1].hash : null;
    if (l.parentHash) kids.set(l.parentHash, (kids.get(l.parentHash) || 0) + 1);
  }
  for (const l of layers) l.childCount = kids.get(l.hash) || 0;

  const byId = buildDisplays(displayBlocks, layers, null);

  /* The HWC tables are headed by a composer display id, not by a layer stack.
     Match them on that id where a display block named one, and fall back to
     taking them in order — right for the single-display case, a guess past it. */
  const displays = [...byId.values()].sort((a, b) => a.id - b.id);
  const spare = tables.filter((t) => !displays.some((d) => d.composerId && t.label.includes(d.composerId)));
  displays.forEach((d, i) => {
    d.hwc = (d.composerId && tables.find((t) => t.label.includes(d.composerId))) || spare.shift() || null;
  });

  /* Held against the display at last: which visible layers do not fit on it.
     Nothing before this point knows how big the display is. */
  for (const d of displays) {
    for (const l of layers) {
      if (l.displayId !== d.id) continue;
      const off = sfOffDisplay(d, l);
      if (!off) continue;
      l.offDisplay = off;
      l.badges.push([off.transposed ? 'transposed' : off.clear ? 'off display' : 'past display',
                     'badge-exit']);
      l.search += ' off display';
    }
  }

  const one = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const globals = {
    build: one(/^Build configuration:\s*(.+)$/m),
    hwcVersion: one(/Hardware Composer state \(version ([^)]+)\)/),
    visibleLayers: one(/Visible layers \(count = (\d+)\)/),
    totalLayers: one(/Total layers \(count = (\d+)\)/),
    /* What Android 15 and up print instead of those two, and what says the
       dump came from the new frontend at all. */
    activeLayers: one(/Active Layers[^(\n]*\(count = (\d+)\)/),
    frontend: tree.length || /New Frontend Enabled:\s*true/.test(text) ? 'new' : null,
  };

  return finaliseScene('sf', displays, layers, globals);
}
