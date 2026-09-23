/* ================ parse: the spellings a release changed ================ */

/* Telltale reads dumps from builds years apart, and a release does not change
   what a service says so much as how it spells it. A rect is the spelling that
   changed most often and in the most places: `dumpsys window` has printed
   `[l,t][r,b]` since forever, input handles print `frame=[l,t,r,b]`,
   `dumpsys display` prints `Rect(l, t - r, b)`, Android 16 moved the activity
   manager's task bounds onto that third spelling, and SurfaceFlinger prints
   floats with spaces between them.

   Until this file each reader carried its own matcher for whichever spellings
   its own dumps happened to use, which is how a regex loosened for one build
   turns into a silent null on another: the field is still printed, the reader
   simply does not recognise it any more. So the spellings live here, once, and
   a reader asks for a rect rather than for a shape.

   Nothing here decides which release it is looking at. A pasted dump states no
   build, so the union is read and whichever spelling is present wins. */

/* The three shapes, as sources rather than expressions, so the same three can
   be built for ints and for floats. Four capture groups each, in l, t, r, b
   order — the caller takes whichever four of the twelve matched. */
const DIA_RECT_SHAPES = (n) => [
  /* `[l,t][r,b]` — window, activity and overlay bounds. */
  `\\[\\s*(${n}),\\s*(${n})\\s*\\]\\s*\\[\\s*(${n}),\\s*(${n})\\s*\\]`,
  /* `[l,t,r,b]` — input window handles, and SurfaceFlinger with spaces. */
  `\\[\\s*(${n})[,\\s]+(${n})[,\\s]+(${n})[,\\s]+(${n})\\s*\\]`,
  /* `Rect(l, t - r, b)` — android.graphics.Rect's own toString, which is what
     display has always printed and what Android 16 moved task bounds to. */
  `Rect\\(\\s*(${n}),\\s*(${n})\\s*-\\s*(${n}),\\s*(${n})\\s*\\)`,
];

const DIA_INT = '-?\\d+';
const DIA_FLOAT = '-?[\\d.]+';

/* A number pattern per option, so a reader that wants only whole numbers does
   not start matching the scale factors and alphas printed alongside them. */
const diaNum = (opts) => (opts && opts.float ? DIA_FLOAT : DIA_INT);

const diaAny = (opts) => `(?:${DIA_RECT_SHAPES(diaNum(opts)).join('|')})`;

/* The four numbers out of a match of the alternation above: eight of the
   twelve groups belong to the shapes that did not match and are undefined.
   Rounding is SurfaceFlinger's business — it is the only service that prints a
   rect as floats — but it is spelled here so a reader asking for floats gets
   numbers it can draw with rather than numbers it has to tidy. */
function diaRectOf(m, opts) {
  const n = m.slice(1).filter((v) => v !== undefined);
  if (n.length < 4) return null;
  const f = opts && opts.round ? (v) => Math.round(+v) : (v) => +v;
  return { l: f(n[0]), t: f(n[1]), r: f(n[2]), b: f(n[3]) };
}

/* The first rect anywhere in a text, in whichever spelling it is printed. */
function diaRect(text, opts) {
  if (!text) return null;
  const m = String(text).match(new RegExp(diaAny(opts)));
  return m ? diaRectOf(m, opts) : null;
}

/* The rect of one named field — `mBounds=`, `frame=`, `logicalFrame=` — in
   whichever spelling the build printed it. */
function diaRectField(text, key, opts) {
  if (!text) return null;
  const m = String(text).match(new RegExp(`\\b${key}=${diaAny(opts)}`));
  return m ? diaRectOf(m, opts) : null;
}

/* Every named rect in a text, keyed by the name in front of it. The first of a
   name wins, because a block prints the container's copy of a field after its
   own and the reader is being asked about the block it was handed. */
function diaRectFields(text, opts) {
  const out = {};
  if (!text) return out;
  const re = new RegExp(`\\b([A-Za-z_][\\w.]*)=${diaAny(opts)}`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] in out) continue;
    const rect = diaRectOf([m[0], ...m.slice(2)], opts);
    if (rect) out[m[1]] = rect;
  }
  return out;
}
