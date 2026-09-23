/* ---------------- render: a getevent trace ---------------- */

/* A touch dump is the one thing Telltale reads that is not a layout. Nothing
   in it sits anywhere for longer than a frame, so neither the plan nor the
   stack says anything about it: what a stroke is, is a path and a clock. This
   draws the path and runs the clock.

   It reaches a display from either end, and both ends meet in `gevStage()`:

     · A capture opened on its own is the `Touch trace` reader, and the display
       under it is borrowed — any window, input or SurfaceFlinger dump open on
       the same desk, picked under `over`.

     · A window dump open on its own takes a capture pasted into it, and the
       display under it is its own.

   Which way round it was reached changes where the two halves came from and
   nothing else, so everything below this point is written once. */

const gevPlay = { raf:0, last:0, running:false };

/* Where the panel, the display and the strokes meet: the capture being drawn,
   the device inside it, the pixels it is being drawn in, and the projection
   between them. Null when this sheet has no trace on it at all. */
function gevStage(){
  if(!S.data || !S.tool) return null;

  /* Reached as the reader: this document is the capture, and the display is
     whatever was borrowed off another tab. */
  if(S.tool.id === 'getevent'){
    const dev = currentDisplay();
    const target = gevTarget();
    return { scene:S.data, dev, target,
             display: target ? target.display : null,
             P: gevProject(dev, target, gevTurn(target)),
             nodes: gevDrawn(), own:true };
  }

  /* Reached from a layout: this document is the display, and the capture is
     one that was pasted onto it. */
  const trace = S.trace;
  if(!trace || S.tool.layout !== 'spatial') return null;
  const dev = trace.displays.find(d => d.id === S.traceDev)
           || trace.displays.find(d => !d.noGeometry) || trace.displays[0];
  if(!dev) return null;
  const display = currentDisplay();
  const target = { display, tool:S.tool };
  return { scene:trace, dev, target, display,
           P: gevProject(dev, target, gevTurn(target)),
           /* A layout's filter is about its windows, so it does not thin the
              strokes: the whole gesture plays over whatever is being shown. */
           nodes: dev.nodes.filter(n => n.samples && n.samples.length), own:false };
}

const gevClock = (stage) => {
  const g = ((stage || gevStage() || {}).scene || {}).globals || {};
  return { start: g.start || 0, span: Math.max(g.span || 0, 0), stamped: !!g.stamped };
};

/* Every display on this desk that a trace could be drawn over: one entry per
   display of every other dump that draws. The trace's own device is not one of
   them — that is what `its own device units` means. */
function gevTargets(){
  const out = [];
  for(const doc of S.docs){
    for(const f of doc.found){
      if(!f.scene || !f.tool || f.tool.layout !== 'spatial' || f.tool.sheet) continue;
      for(const d of f.scene.displays){
        if(!d.nodes.some(n => n.frame)) continue;
        out.push({ key:`${doc.id}:${f.tool.id}:${d.id}`, doc, tool:f.tool, display:d,
                   label:`${elide(doc.label, 22)} · ${f.tool.name} · display ${d.id}` });
      }
    }
  }
  return out;
}

const gevTarget = () => S.mapTo ? gevTargets().find(t => t.key === S.mapTo) || null : null;

/* The turn a target states for itself, in degrees. Only `dumpsys display`
   prints one — `installOrientation`, which is how the panel is glued to the
   display it drives — so every other reader's display comes back as no turn
   at all rather than as a guess. */
const deg360 = (d) => ((d % 360) + 360) % 360;

function gevInstalledTurn(target){
  const r = target && target.display ? target.display.installRotation : null;
  return typeof r === 'number' ? deg360(r) : 0;
}

/* How far the panel is turned against the display the strokes are drawn onto:
   what that display's own dump says, until somebody says otherwise with the
   button beside the clock. The display is passed in rather than looked up,
   because there are two ways round to this — a trace borrowing a display off
   another tab, and a layout with a capture pasted onto it — and only one of
   them has a display in `mapTo`. */
const gevTurn = (target) => S.mapTurn === null ? gevInstalledTurn(target)
                          : deg360(S.mapTurn);

/* The turn the sheet is actually drawing with, for the button that shows and
   overrides it. */
const gevStageTurn = () => { const st = gevStage(); return st ? gevTurn(st.target) : gevTurn(null); };

/* Device units in, display pixels out. The panel is normalised to 0..1 first,
   so a digitiser that counts to 4096 and a display that counts to 1080 meet in
   the middle; the turn is applied there too, because a panel mounted at 90° to
   its display is the normal case on a tablet and there is nothing in either
   dump that states it. */
function gevProject(dev, target, rot){
  const dst = target ? target.display.size : dev.size;
  const turn = ((rot % 360) + 360) % 360;
  const ox = dev.origin ? dev.origin.x : 0, oy = dev.origin ? dev.origin.y : 0;
  const fn = (x, y) => {
    let u = (x - ox) / dev.size.w, v = (y - oy) / dev.size.h;
    if(turn === 90){ const t = u; u = 1 - v; v = t; }
    else if(turn === 180){ u = 1 - u; v = 1 - v; }
    else if(turn === 270){ const t = u; u = v; v = 1 - t; }
    return [u * dst.w, v * dst.h];
  };
  fn.size = dst;
  return fn;
}

/* Where a stroke was at a moment. Between two samples it is interpolated,
   because a 120Hz panel and a 60Hz screen do not agree on when a frame is and
   a dot that steps looks like a dropped event when it is not one. */
function gevAt(n, t){
  const ss = n.samples;
  if(!ss.length || t < ss[0].t || t > n.end) return null;
  let i = 0;
  while(i < ss.length - 1 && ss[i + 1].t <= t) i++;
  const a = ss[i], b = ss[i + 1];
  if(!b || !(b.t > a.t)) return { x:a.x, y:a.y, pressure:a.pressure, major:a.major };
  const f = clamp((t - a.t) / (b.t - a.t), 0, 1);
  return { x:a.x + (b.x - a.x) * f, y:a.y + (b.y - a.y) * f,
           pressure:a.pressure, major:a.major };
}

const gevPath = (pts) => pts.length
  ? 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') : '';

/* The strokes the reader's own sheet draws: whatever its list is showing,
   minus the gesture rows, which are the group and not a path of their own. */
const gevDrawn = () => visibleNodes().filter(n => n.samples && n.samples.length);

/* The drawing itself, which is the same wherever it is drawn: the whole path
   faint, the part of it that has happened heavy, the dot the finger went down
   on, the ring it came up at, and the finger where it is now.

   `at` maps a point on the panel into whatever space the sheet is drawing in —
   the plan passes the projection straight through, the stack puts it through
   the same rotation the faces went through, so the trace lies on the screen. */
function gevParts(stage, at, r, opts){
  const parts = [];
  const pick = (opts && opts.selected) || null;
  for(const n of stage.nodes){
    const pts = n.samples.map(s => at(s));
    if(!pts.length) continue;
    const a = pts[0], z = pts[pts.length - 1];
    parts.push(
      `<g style="color:${tintFor(n)}" class="gev-g${n.hash === pick ? ' is-sel' : ''}${
        opts && opts.dim ? opts.dim(n) : ''}">` +
      (pts.length > 1 ? `<path class="gev-path" d="${gevPath(pts)}"/>` : '') +
      `<circle class="gev-down" cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="${r}"><title>${
        esc(n.title)}</title></circle>` +
      (pts.length > 1
        ? `<circle class="gev-up" cx="${z[0].toFixed(1)}" cy="${z[1].toFixed(1)}" r="${r * 0.8}"/>`
        : '') +
      `<path class="gev-live" data-live="${esc(n.hash)}" d=""/>` +
      /* `display` rather than `hidden`: the presentation attribute is SVG's
         own and means the same thing in every renderer. */
      `<circle class="gev-tip" data-tip="${esc(n.hash)}" r="${r * 1.9}"
         cx="0" cy="0" display="none"/>` +
      `</g>`);
  }
  return parts;
}

/* A trace laid over somebody else's layout. It is a note on that drawing and
   not part of it: nothing in here takes a click, so picking a window in the
   sheet under it still picks the window.

   `post` is whatever the sheet does to a point after the panel has been scaled
   onto the display — nothing in the plan, the stack's own rotation in the
   z-order view. The playhead is left the same mapping, so it paints onto the
   plane the paths were drawn on rather than through the plan's. */
function gevOverlay(span, post){
  const stage = gevStage();
  gevPlayAt = null;
  if(!stage || stage.own) return '';
  gevPlayAt = (s) => { const [x, y] = stage.P(s.x, s.y); return post ? post(x, y) : [x, y]; };
  return `<g class="gev-over">${gevParts(stage, gevPlayAt, span * 0.011, {}).join('')}</g>`;
}

function geteventSheet(){
  const stage = gevStage();
  const dev = stage.dev;
  const dst = stage.P.size;
  const rect = { l:0, t:0, r:dst.w, b:dst.h };
  const span = Math.max(dst.w, dst.h);
  const pad = span * 0.05;
  const vb = { x:-pad, y:-pad, w:dst.w + pad * 2, h:dst.h + pad * 2 };
  const r = span * 0.011;                       // the dot a finger is drawn as

  const parts = [`<rect class="pw-screen" ${rectAttrs(rect)}/>`];

  /* The borrowed layout, bottom of its stack first, under everything the
     finger did. It is not this dump's and is drawn as a note rather than as a
     thing to pick: the list on the left is still the strokes. */
  if(stage.display){
    for(const w of stage.display.nodes.filter(n => n.frame).sort((a, b) => a.z - b.z)){
      parts.push(`<rect class="gev-under${w.visible === false ? ' is-off' : ''}"
        ${rectAttrs(w.frame)}><title>${esc(w.title)}</title></rect>`);
    }
  }

  parts.push(...gevParts(stage, (s) => stage.P(s.x, s.y), r,
                         { selected:S.selected, dim:dimClass }));

  if(!stage.nodes.length){
    parts.push(`<text class="pw-label" x="${dst.w / 2}" y="${dst.h / 2}"
      text-anchor="middle" dominant-baseline="middle">${
      esc(dev.noGeometry ? `Nothing on ${dev.label} reported a position`
                         : `No ${S.tool.nouns} match this filter`)}</text>`);
  }

  /* Hit targets last, and fat: a path one pixel wide on a 1080-wide panel is
     not something a pointer can land on. */
  for(const n of stage.nodes){
    const pts = n.samples.map(s => stage.P(s.x, s.y));
    parts.push(pts.length > 1
      ? `<path class="pw-hit gev-hit" data-hash="${esc(n.hash)}" stroke-width="${r * 2.4}"
           d="${gevPath(pts)}"><title>${esc(n.title)}</title></path>`
      : `<circle class="pw-hit" data-hash="${esc(n.hash)}" r="${r * 2}"
           cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}"><title>${
           esc(n.title)}</title></circle>`);
  }

  gevPlayAt = null;                 // the reader's own sheet is the plan
  sheetSvg({ vb, parts, label: `Touch trace on ${dev.label}` });
  gevSyncBar();
  gevPaint();
}

/* What the playhead has to say about every stroke on screen: the part of each
   path that has happened by now, and where the finger is at this instant. It
   is worked out apart from the writing below, because this is the half that
   can be wrong and the half below is four calls to setAttribute.

   `at` is the sheet's own mapping again, so a playhead painted onto the stack
   lands on the same plane the paths were drawn on. */
function gevPlayhead(at){
  const stage = gevStage();
  if(!stage) return [];
  const put = at || ((s) => stage.P(s.x, s.y));
  const { start, span } = gevClock(stage);
  const t = start + clamp(S.playAt, 0, span);
  return stage.nodes.map((n) => {
    const pts = [];
    for(const s of n.samples){ if(s.t > t) break; pts.push(put(s)); }
    const now = gevAt(n, t);
    const tip = now ? put(now) : null;
    if(tip) pts.push(tip);
    return { hash:n.hash, d:gevPath(pts), tip };
  });
}

/* The playhead moved, without redrawing the sheet: the paths and the dots are
   already in the DOM and only their `d` and their centre change, so a capture
   with two hundred samples in it plays at frame rate instead of rebuilding an
   SVG sixty times a second. */
function gevPaint(){
  const svg = document.querySelector('svg.plan');
  if(!svg || !gevStage()) return;
  const { span } = gevClock();
  const frames = new Map(gevPlayhead(gevPlayAt).map(f => [f.hash, f]));

  for(const el of svg.querySelectorAll('[data-live]')){
    const f = frames.get(el.dataset.live);
    el.setAttribute('d', f ? f.d : '');
  }
  for(const el of svg.querySelectorAll('[data-tip]')){
    const f = frames.get(el.dataset.tip);
    if(!f || !f.tip){ el.setAttribute('display', 'none'); continue; }
    el.setAttribute('display', 'inline');
    el.setAttribute('cx', f.tip[0].toFixed(1));
    el.setAttribute('cy', f.tip[1].toFixed(1));
  }
  $('traceTime').textContent = `${S.playAt.toFixed(3)} s / ${span.toFixed(3)} s`;
  const rng = $('rngPlay');
  if(document.activeElement !== rng) rng.value = String(span ? S.playAt / span * 1000 : 0);
}

/* The stack draws the trace on the screen plane, which is not the plan's
   mapping. The renderer that drew it leaves its own mapping here for the
   playhead to use, and clears it when the plan is what is showing. */
let gevPlayAt = null;

/* ---- the bar under the sheet ---- */

/* The bar is the clock, and it belongs to whatever is being played: the
   reader's own sheet, or a layout with a capture pasted onto it. A spatial
   dump with no capture on it yet gets the one button that takes one. */
function gevSyncBar(){
  const spatial = S.tool && S.tool.layout === 'spatial';
  $('traceBar').hidden = !spatial;
  if(!spatial) return;
  const stage = gevStage();
  const own = S.tool.id === 'getevent';

  $('btnTracePaste').hidden = own;
  $('btnTraceDrop').hidden = own || !S.trace;
  $('selTraceDev').hidden = own || !S.trace;
  for(const id of ['btnPlay', 'rngPlay', 'traceTime', 'trkSpeed', 'trkLoop', 'btnMapRot']){
    $(id).hidden = !stage;
  }
  $('trkOver').hidden = !own;
  if(!stage){
    $('btnTracePaste').textContent = 'Play a touch log';
    $('tracePaste').hidden = $('tracePaste').dataset.open !== '1';
    return;
  }
  $('btnTracePaste').textContent = 'Replace';

  const { span, stamped } = gevClock(stage);
  const playable = stamped && span > 0;
  $('btnPlay').disabled = !playable;
  $('rngPlay').disabled = !playable;
  $('btnPlay').setAttribute('aria-pressed', String(gevPlay.running));
  $('btnPlay').textContent = gevPlay.running ? '❚❚' : '▶';
  $('btnPlay').title = playable ? 'Play the capture'
    : 'This capture has no timestamps — take it with `getevent -lt`';

  if(own){
    const targets = gevTargets();
    const sel = $('selMap');
    const want = `${S.mapTo || ''}`;
    sel.innerHTML = `<option value="">its own device units</option>` + targets.map(t =>
      `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('');
    sel.value = targets.some(t => t.key === want) ? want : '';
    if(sel.value !== want) S.mapTo = sel.value || null;
    sel.disabled = !targets.length;
    sel.title = targets.length ? 'Which display to scale the panel onto'
      : 'Open a window, input or SurfaceFlinger dump on this desk and it can be drawn over that';
  } else {
    /* A capture off a phone holds the panel and the volume rocker; which of
       its devices is being played is the trace's half of the same question
       `over` asks on the other side. */
    const devs = S.trace.displays.filter(d => !d.noGeometry);
    const sel = $('selTraceDev');
    sel.innerHTML = devs.map(d =>
      `<option value="${d.id}">${esc(d.label)}${d.name ? ' · ' + esc(d.name) : ''}</option>`).join('');
    sel.value = String(stage.dev.id);
    sel.hidden = devs.length < 2;
  }
  $('btnMapRot').textContent = `${gevStageTurn()}°`;
  $('btnMapRot').disabled = own && !S.mapTo;
  $('tracePaste').hidden = $('tracePaste').dataset.open !== '1';
}

const gevSpeed = () => +$('selSpeed').value || 1;

function gevStop(){
  if(gevPlay.raf) cancelAnimationFrame(gevPlay.raf);
  gevPlay.raf = 0; gevPlay.last = 0; gevPlay.running = false;
  if(S.tool && S.tool.layout === 'spatial') gevSyncBar();
}

function gevStart(){
  const stage = gevStage();
  const { span, stamped } = gevClock(stage);
  if(!stage || !span || !stamped) return;
  if(S.playAt >= span - 1e-6) S.playAt = 0;
  gevPlay.running = true;
  gevPlay.last = 0;
  gevPlay.raf = requestAnimationFrame(gevStep);
  gevSyncBar();
}

function gevStep(ts){
  gevPlay.raf = 0;
  if(!gevPlay.running) return;
  const dt = gevPlay.last ? (ts - gevPlay.last) / 1000 : 0;
  gevPlay.last = ts;
  const { span } = gevClock();
  let at = S.playAt + dt * gevSpeed();
  if(at >= span){
    if($('optLoop').checked) at = 0;
    else { S.playAt = span; gevPaint(); return gevStop(); }
  }
  S.playAt = at;
  gevPaint();
  gevPlay.raf = requestAnimationFrame(gevStep);
}

/* ---- taking a capture onto a layout ---- */

/* The pasted text, read by the same reader that would have opened it as a tab
   of its own. What comes back is a scene like any other; it simply hangs off
   this document instead of being one. */
function gevAttach(text){
  let scene = null;
  try { scene = parseGeteventCapture(text); }
  catch(e){ return `That could not be read as a capture: ${(e && e.message) || e}`; }
  if(!scene || !scene.ok){
    return 'No getevent lines in that. A capture looks like '
         + '`[   56414.024232] /dev/input/event2: EV_ABS ABS_MT_POSITION_X 000001f4` '
         + '— take it with `adb shell getevent -lt`.';
  }
  gevStop();
  S.trace = scene;
  S.traceDev = (scene.displays.find(d => !d.noGeometry) || scene.displays[0]).id;
  S.playAt = 0;
  return null;
}

function gevDetach(){
  gevStop();
  S.trace = null; S.traceDev = null; S.playAt = 0; S.mapTurn = null;
  $('tracePaste').dataset.open = '0';
  $('traceText').value = '';
  gevSaid('');
  renderPlan(); renderDetail();
}

/* ---- the line under the drawing ---- */

function geteventFoot(){
  const stage = gevStage();
  const d = stage.dev;
  const { span } = gevClock(stage);
  const out = [];
  out.push(`<span>${esc(d.label)}${d.name ? ' · ' + esc(d.name) : ''}</span>`);
  out.push(`<span>${d.noGeometry ? 'no touch geometry'
    : `${d.size.w} × ${d.size.h} device units${d.synthesised ? ' (inferred)' : ''}`}</span>`);
  out.push(`<span>${d.strokes} stroke${d.strokes === 1 ? '' : 's'} · ${
    span ? gevMs(span) : 'no clock'}</span>`);
  out.push(stage.target
    ? `<span>drawn over ${esc(stage.target.tool.name.toLowerCase())} display ${
        stage.display.id} · ${stage.display.size.w} × ${stage.display.size.h} px</span>`
    : `<span>drawn in device units</span>`);
  if(!gevClock(stage).stamped) out.push(`<span>no timestamps — take it with <code>-lt</code></span>`);
  return out.join('');
}

/* The line a layout gains when a capture is playing over it, appended to the
   one that dump already had. */
function gevHostFoot(){
  const stage = gevStage();
  if(!stage || stage.own) return '';
  const { span, stamped } = gevClock(stage);
  const strokes = stage.nodes.length;
  return `<span>${strokes} stroke${strokes === 1 ? '' : 's'} off ${esc(stage.dev.label)}${
    stage.dev.synthesised ? ' <span style="color:var(--dim)">(units inferred)</span>' : ''} · ${
    stamped && span ? gevMs(span) : 'no clock'}</span>`;
}
