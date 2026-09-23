/* ---------------- render: the details pane, a touch trace -------------- */
/* Where a point on the panel landed, once the panel has been put over a
   display: the topmost thing whose frame contains it, and — where the dump
   knows the difference, which `dumpsys input` does — the topmost thing that
   would actually have taken the touch. That second one is the answer to the
   only question a touch dump gets opened with. */
function gevUnder(target, pt){
  if(!target) return null;
  const hits = target.display.nodes
    .filter(n => n.frame && pt.x >= n.frame.l && pt.x < n.frame.r
                         && pt.y >= n.frame.t && pt.y < n.frame.b)
    .sort((a, b) => b.z - a.z);
  if(!hits.length) return null;
  const takes = hits.find(n => n.touchable);
  return { top: hits[0], takes: takes || null, count: hits.length };
}

function gevLanding(n){
  const target = gevTarget();
  if(!target) return null;
  const dev = currentDisplay();
  const P = gevProject(dev, target, gevTurn(target));
  const a = n.samples[0], z = n.samples[n.samples.length - 1];
  const px = (s) => { const [x, y] = P(s.x, s.y); return { x, y }; };
  return { target, down: gevUnder(target, px(a)), up: gevUnder(target, px(z)),
           downAt: px(a), upAt: px(z) };
}

const gevWin = (hit) => hit
  ? `${esc(trim(hit.title, 54))} <span style="color:var(--dim)">· z ${hit.zRank + 1}/${hit.zCount}</span>`
  : none;

/* A stroke's samples, as the device stated them. This is the raw block for a
   dump that has no raw block: every other reader can print the lines it read a
   node out of, and a stroke was never lines — it was a hundred of them, spread
   across the file, most of which said nothing about this finger. */
const GEV_SAMPLE_CAP = 400;

function gevSampleTable(n){
  const ss = n.samples;
  const shown = ss.slice(0, GEV_SAMPLE_CAP);
  const t0 = ss[0].t;
  const rows = shown.map((s, i) => {
    const prev = i ? shown[i - 1] : null;
    const step = prev ? Math.hypot(s.x - prev.x, s.y - prev.y) : 0;
    return `<tr><td>${((s.t - t0) * 1000).toFixed(1)}</td>
      <td>${Math.round(s.x)}</td><td>${Math.round(s.y)}</td>
      <td>${s.pressure === null || s.pressure === undefined ? '—' : s.pressure}</td>
      <td>${i ? Math.round(step) : '—'}</td>
      <td>${s.held ? `×${s.held}` : ''}</td></tr>`;
  }).join('');
  return `<div class="doc-scroll gev-samples"><table class="doc-table"><thead><tr>
      <th>ms</th><th>x</th><th>y</th><th>pressure</th><th>step</th><th>held</th>
    </tr></thead><tbody>${rows}</tbody></table></div>${
    ss.length > shown.length
      ? `<p style="margin:6px 0 0;color:var(--dim)">${ss.length - shown.length} more samples not listed</p>`
      : ''}`;
}

function geteventDetail(n){
  const out = [];
  const { start } = gevClock();
  const at = (t) => `${(t - start).toFixed(3)} s <span style="color:var(--dim)">(${
    t.toFixed(6)})</span>`;

  if(n.key){
    out.push(`<section class="dgroup"><h3>${esc(n.title)}</h3>${dl([
      ['what', /^BTN_/.test(n.title) ? 'a button on the device' : 'a key on the device'],
      ['down', at(n.start)],
      ['up', at(n.end)],
      ['held', gevMs(n.end - n.start)],
      ['device', esc(currentDisplay().label)],
    ])}</section>`);
    return out;
  }

  if(n.gesture){
    const kids = currentDisplay().nodes.filter(k => k.parentHash === n.hash);
    out.push(`<section class="dgroup"><h3>${esc(cap(n.title))}</h3>${dl([
      ['fingers', String(n.fingers)],
      ['from', at(n.start)],
      ['lasted', gevMs(n.end - n.start)],
      ['across', r(n.frame)],
    ])}</section>`);
    out.push(`<section class="dgroup"><h3>The strokes in it</h3><div class="anc">${
      kids.map(k => `<button class="anc-row" type="button" data-hash="${esc(k.hash)}"
        title="${esc(k.title)}">${esc(k.kind)} · ${gevMs(k.duration)} · ${
        Math.round(k.geo.travel)} units</button>`).join('')
    }</div></section>`);
    return out;
  }

  const fl = n.fling;
  out.push(`<section class="dgroup"><h3>${esc(cap(n.kind))}</h3>${dl([
    ['down at', `${gevPt(n.samples[0])} <span style="color:var(--dim)">device units</span>`],
    ['up at', gevPt(n.samples[n.samples.length - 1])],
    ['lasted', gevMs(n.duration)],
    ['travelled', `${Math.round(n.geo.travel)} units${
      n.geo.travel ? ` <span style="color:var(--dim)">· ${Math.round(n.geo.net)} of it net</span>` : ''}`],
    n.direction && ['direction', esc(n.direction)],
    fl && ['leaving at', `${Math.round(fl.speed)} units/s <span style="color:var(--dim)">· ${
      Math.round(fl.x)}, ${Math.round(fl.y)}</span>`],
    ['samples', `${n.samples.length}`],
    ['box', r(n.frame)],
  ])}</section>`);

  /* What the finger was on. Only a mapped trace can say, and saying which
     display it was mapped onto matters as much as the answer: the mapping is
     an assumption the reader made, not something either dump stated. */
  const land = gevLanding(n);
  out.push(`<section class="dgroup"><h3>What it landed on</h3>${land ? dl([
    ['display', `${esc(land.target.tool.name)} · display ${land.target.display.id}`],
    ['down at', `${Math.round(land.downAt.x)}, ${Math.round(land.downAt.y)} px`],
    ['topmost there', gevWin(land.down && land.down.top)],
    ...(land.down && land.down.takes && land.down.takes !== land.down.top
      ? [['takes the touch', gevWin(land.down.takes)]] : []),
    ['up at', `${Math.round(land.upAt.x)}, ${Math.round(land.upAt.y)} px`],
    ['topmost there', gevWin(land.up && land.up.top)],
  ]) : `<p style="margin:0;color:var(--dim)">This trace is drawn in the panel's own
      units. Open a <b>dumpsys window windows</b> or <b>dumpsys input</b> dump on
      this desk and pick it under <b>over</b> below the drawing, and every stroke
      is scaled onto that display and named by what it crossed.</p>`}</section>`);

  out.push(`<section class="dgroup"><h3>Samples</h3>${gevSampleTable(n)}</section>`);
  return out;
}

/* What a pasted capture did to the window that is selected: the strokes whose
   finger came down inside its frame, and — where they came down over it but
   something above it was in the way — which window took the touch instead.
   That last line is the reason for putting the log on the layout rather than
   beside it. */
function gevOnNode(n){
  const stage = gevStage();
  if(!stage || stage.own || !n || !n.frame) return '';
  const inside = (pt, f) => pt.x >= f.l && pt.x < f.r && pt.y >= f.t && pt.y < f.b;

  const rows = [];
  for(const st of stage.nodes){
    const [x, y] = stage.P(st.samples[0].x, st.samples[0].y);
    if(!inside({ x, y }, n.frame)) continue;
    const under = gevUnder(stage.target, { x, y });
    const gets = under && (under.takes || under.top);
    rows.push([`${esc(st.kind)} at ${Math.round(x)}, ${Math.round(y)}`,
      !gets || gets.hash === n.hash
        ? '<span class="yes">this one</span>'
        : `<span style="color:var(--dim)">taken by</span> ${esc(trim(gets.title, 44))}`]);
  }

  return `<section class="dgroup"><h3>Touches on this ${esc(S.tool.noun)}</h3>${
    rows.length ? dl(rows)
      : `<p style="margin:0;color:var(--dim)">No finger in the capture came down
         inside this frame.</p>`}</section>`;
}

/* The same question asked of the display rather than of one window: every
   stroke in the capture, and what it landed on. */
function gevOnDisplay(){
  const stage = gevStage();
  if(!stage || stage.own) return '';
  /* Where the display picked states how its panel is mounted, the turn is a
     fact and the pane says so instead of apologising for a guess. */
  const stated = stage.target && stage.target.display
    && typeof stage.target.display.installRotation === 'number'
    ? stage.target.display.installRotation : null;
  const rows = stage.nodes.map((st) => {
    const [x, y] = stage.P(st.samples[0].x, st.samples[0].y);
    const under = gevUnder(stage.target, { x, y });
    const gets = under && (under.takes || under.top);
    return [`${esc(st.kind)} at ${Math.round(x)}, ${Math.round(y)}`,
            gets ? esc(trim(gets.title, 44)) : none];
  });
  return `<section class="dgroup"><h3>What the touch log landed on</h3>${
    rows.length ? dl(rows)
      : `<p style="margin:0;color:var(--dim)">Nothing in the capture reported a
         position on this device.</p>`}
    <p style="margin:7px 0 0;color:var(--dim)">${stated === null
      ? `The panel is scaled onto this display, which is this reader's assumption and
         not something either dump stated \u2014 turn it with the button beside the
         clock if the strokes land at 90\u00b0 to where they should.`
      : `The panel is scaled onto this display, and turned by the
         <b>${stated}\u00b0</b> that display's own dump says the panel is mounted at
         \u2014 <code>installOrientation</code> in <code>dumpsys display</code>. The
         button beside the clock still overrides it.`}</p></section>`;
}

function geteventDeviceDetail(d){
  const out = [];
  const ranges = [...d.ranges.entries()];
  out.push(`<section class="dgroup"><h3>Device</h3>${dl([
    ['node', d.path ? esc(d.path)
      : `${none} <span style="color:var(--dim)">(the capture was taken with a device`
        + ` argument, which prints no node in front of the events)</span>`],
    ['name', d.name ? esc(d.name) : none],
    ['protocol', d.protocol === 'A' || d.protocol === 'B'
      ? `multitouch ${esc(d.protocol)}` : d.protocol ? esc(d.protocol) : none],
    ['coordinate space', d.noGeometry ? none
      : `${d.size.w} × ${d.size.h}${d.synthesised
          ? ' <span style="color:var(--dim)">(inferred from how far the fingers went —'
            + ' paste <code>getevent -lp</code> above the capture for the real one)</span>'
          : ''}`],
    ['events', String(d.events)],
    ['strokes', String(d.strokes)],
    ['keys', String(d.keys)],
    d.end > d.start && ['span', gevMs(d.end - d.start)],
  ])}</section>`);

  if(ranges.length){
    out.push(`<section class="dgroup"><h3>Reported ranges</h3>
      <div class="doc-scroll"><table class="doc-table">
      <thead><tr><th>axis</th><th>min</th><th>max</th></tr></thead>
      <tbody>${ranges.map(([k, v]) =>
        `<tr><td>${esc(k)}</td><td>${v.min}</td><td>${v.max}</td></tr>`).join('')}
      </tbody></table></div></section>`);
  }
  return out;
}
