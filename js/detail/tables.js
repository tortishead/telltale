/* ---------------- render: the details pane ---------------- */

/* A section of the pane that can be shut. The two sections that join the
   readers to each other — what else on the desk is this thing, and what the
   other readers of this window said about it — are long, and they are under
   whatever the reader itself had to say, which is what someone reading one
   dump came for. So they fold.

   It is a <details>, the way the framework frames in an ANR fold: opening one
   needs no script and printing shows what is open. What does need script is
   remembering it, because the pane is rebuilt from nothing on every selection
   and a section that sprang open again on the next click would be worse than
   one that never shut. Which sections are shut is a page-wide preference and
   is kept where the theme and the pane widths are kept, in js/events.js: it is
   about how much of the pane you want spent on this, not about any one dump.

   `key` is what is remembered, so it stays the same while the heading changes:
   the same section is headed window, layer or input window depending on which
   reader is open, and shutting it once shuts it for all three. */
function foldGroup(key, heading, body){
  return `<details class="dgroup" data-fold="${esc(key)}"${shutGroups.has(key) ? '' : ' open'}>
    <summary>${heading}</summary>${body}</details>`;
}

/* The pane is the one place a tool gets to speak for itself; everything around
   it — the raw block, the copy button, the prompt when nothing is picked — is
   the same whichever dump is open. */
function drawDetail(){
  hideTip();
  const n = S.data.nodes.find(x => x.hash === S.selected);
  if(!n) return renderDisplayDetail();

  /* A pane in the middle that picks within the section moves what this pane
     is about: the line that was picked, and the section only until one is. */
  const picked = S.attr && S.tool.attrDetail ? S.tool.attrDetail(S.attr) : null;
  $('detailTitle').textContent = picked ? picked.title : n.title;

  const out = picked ? picked.out : S.tool.detail(n);
  /* A capture playing over this dump is part of what is on screen, so what it
     did to the thing being read goes with everything else about it. */
  const onIt = picked ? '' : gevOnNode(n);
  if(onIt) out.push(onIt);
  /* And what the rest of the desk has to say about the same process, package
     or token. It goes after the reader's own sections and before the raw
     block, because it is about this node rather than part of reading it — and
     it is the one section no reader writes, so it is added here rather than
     eighteen times over. */
  /* Where three readers describe the same thing on screen, what the other two
     said about it goes first: it is about this node rather than about the desk,
     and a disagreement between them is usually why the node is being read. */
  const sides = picked ? '' : surfaceCard(n, currentDisplay());
  if(sides) out.push(sides);
  const spine = picked ? '' : spineChips(n, currentDisplay());
  if(spine) out.push(spine);
  const raw = picked ? picked.raw : n.raw;
  if(raw) out.push(`<section class="dgroup"><h3>Raw block</h3>
    <button class="btn btn-quiet" id="btnCopy" type="button" style="margin-bottom:7px">Copy raw block</button>
    <pre class="raw">${esc(raw)}</pre></section>`);
  $('detail').innerHTML = out.join('');

  const copy = $('btnCopy');
  if(copy) copy.onclick = () => {
    navigator.clipboard.writeText(raw).then(() => {
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy raw block'; }, 1400);
    });
  };
}

/* ---- car_service ---- */

/* A row in the pane that selects another section, which is how the failures
   list and the path up out of a subsection are both walked. */
const docLink = (hash, title) =>
  `<button class="anc-row" type="button" data-hash="${esc(hash)}">${esc(title)}</button>`;

function carDetail(n){
  const out = [];

  if(n.ancestors.length){
    out.push(`<section class="dgroup"><h3>Inside</h3>${
      n.ancestors.map(a => docLink(a.hash, a.title)).join('')}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Section</h3>${dl([
    ['kind', esc(n.typeLabel)],
    ['at', `line ${n.at}`],
    n.subCount && ['sections', n.subCount],
    ['lines', n.subCount ? `${n.own} here · ${n.lines} with its sections` : n.own],
  ])}</section>`);

  /* A service that threw printed the stack where its dump should have been,
     so the first line of it is the answer to why the block is short. */
  if(n.failed){
    /* Which service gave up and what it threw are two lines, and the second is
       the one worth reading; the rest of the stack is the dumper's own frames
       and stays in the block below. */
    const why = n.raw.split('\n').filter(l => CAR_FAIL_RE.test(l)).slice(0, 2);
    out.push(`<section class="dgroup"><h3>Did not dump</h3>
      <p style="margin:0 0 7px">This service threw on its way out, so what it printed
      is as far as it got.</p>${why.length
        ? `<pre class="raw">${esc(why.map(l => l.trim()).join('\n'))}</pre>` : ''}</section>`);
  }

  return out;
}

function carDisplayDetail(d){
  const g = S.data.globals;
  const out = [];

  out.push(`<section class="dgroup"><h3>Car service</h3>${dl([
    ['services', g.services],
    ['sections', g.sections],
    ['lines', g.lines],
  ])}</section>`);

  if(g.versions.length){
    out.push(`<section class="dgroup"><h3>Versions</h3>${
      dl(g.versions.map(([k, v]) => [esc(k), esc(trim(v, 140))]))}</section>`);
  }

  /* The one thing in a car_service dump worth being told rather than found:
     a service that threw is a hole in everything read below it. */
  if(g.failed.length){
    out.push(`<section class="dgroup"><h3>Did not dump</h3>${g.failed.map(h => {
      const n = d.nodes.find(x => x.hash === h);
      return docLink(h, n ? n.title : h);
    }).join('')}</section>`);
  }

  return out;
}

/* ---- dumpsys display ---- */

/* What each of the rectangles a display is made of actually is. The picture
   says where they are; this says why there is more than one of them. */
const DISPLAY_RECTS = {
  'disp-panel': `The display as the framework has it: the number every other
    dump's coordinates are in, and the one a window dump has to guess at when it
    prints no display block.`,
  'disp-app': `The part of the display an app is laid out in — the whole of it
    less whatever the system decor is holding. A window that looks the wrong height
    in a window dump is usually the difference between this and the panel.`,
  'disp-viewport': `The frame the input stack maps a touch through. Where it is
    not the whole panel, a touch outside it reaches nothing — and where the logical
    and the physical frame differ, the display is being scaled onto the panel.`,
  'disp-cutout': `A hole in the panel. Nothing is drawn under it, and a window
    that asked to lay out edge to edge has to avoid it itself.`,
};

function displayNodeDetail(n){
  const out = [];

  out.push(`<section class="dgroup"><h3>${esc(cap(n.typeLabel))}</h3>${dl([
    ['what', esc(n.title)],
    n.frame && ['rect', r(n.frame)],
    n.frameSource && ['printed as', `<code>${esc(n.frameSource)}</code>`],
    n.meta && ['says', esc(n.meta)],
    ['at', `line ${n.at}`],
  ])}</section>`);

  const why = DISPLAY_RECTS[n.family];
  if(why) out.push(`<section class="dgroup"><h3>What it is</h3>
    <p style="margin:0">${why}</p></section>`);

  return out;
}

function displayManagerDetail(d){
  const g = S.data.globals;
  const out = [];

  out.push(`<section class="dgroup"><h3>Panel</h3>${dl([
    d.real && ['size', `${d.real.w} × ${d.real.h}`],
    d.density && ['density', `${d.density} dpi${d.dpi
      ? ` ${dim(`· ${d.dpi.x} × ${d.dpi.y} actual`)}` : ''}`],
    d.mode && ['mode', `${d.mode.w} × ${d.mode.h} at ${dmHz(d.mode.fps)} Hz ${
      dim('· id ' + d.mode.id)}`],
    d.renderFrameRate && ['rendering at', `${dmHz(d.renderFrameRate)} Hz`],
    d.state && ['state', esc(d.state)],
    d.type && ['type', esc(d.type)],
    d.rotation !== null && ['rotation', `${esc(d.rotation)}°`],
    d.layerStack !== null && d.layerStack !== undefined && ['layer stack', d.layerStack],
    d.owner && ['owned by', esc(d.owner)],
    d.uniqueId && ['unique id', mono(d.uniqueId)],
  ])}</section>`);

  /* The difference between the panel and what an app is given is the whole of
     what system decor costs, and it is the number a window dump is read
     against without ever stating it. */
  if(d.app && d.real && (d.app.w !== d.real.w || d.app.h !== d.real.h)){
    out.push(`<section class="dgroup"><h3>What apps get</h3>${dl([
      ['app area', `${d.app.w} × ${d.app.h}`],
      ['decor', `${d.real.w - d.app.w} px across · ${d.real.h - d.app.h} px down`],
    ])}</section>`);
  }

  if(d.cutoutInsets){
    const c = d.cutoutInsets;
    out.push(`<section class="dgroup"><h3>Cutout</h3>${dl([
      ['insets', `${c.l} · ${c.t} · ${c.r} · ${c.b} ${dim('left, top, right, bottom')}`],
      ['holes', d.nodes.filter(n => n.family === 'disp-cutout').length],
    ])}</section>`);
  }

  if(d.viewport){
    const v = d.viewport;
    const scaled = v.logical && v.physical
      && (rectW(v.logical) !== rectW(v.physical) || rectH(v.logical) !== rectH(v.physical));
    out.push(`<section class="dgroup"><h3>Input viewport</h3>${dl([
      v.type && ['type', esc(v.type)],
      v.orientation !== null && ['orientation', `${dmDegrees(v.orientation)}°`],
      v.port !== null && ['physical port', v.port],
      v.logical && ['logical frame', r(v.logical)],
      v.physical && ['physical frame', r(v.physical)],
      ['valid', yn(v.valid)],
    ])}${scaled ? `<p style="margin:7px 0 0">The logical frame is being scaled
      onto a physical frame of another size, so a touch is not one panel pixel to one
      display pixel on this display.</p>` : ''}</section>`);
  }

  /* The one number in a bugreport that says which way round the panel is
     glued on, and the reason this reader is worth having open beside a touch
     trace. */
  if(d.installRotation !== null && d.installRotation !== undefined){
    out.push(`<section class="dgroup"><h3>How the panel is mounted</h3>${dl([
      ['install orientation', `${d.installRotation}°`],
    ])}<p style="margin:7px 0 0">${d.installRotation
      ? `The panel is mounted at ${d.installRotation}° to the display it drives, which is
         what a touch trace has to be turned by to land where it should. Play a capture
         over this display and Telltale takes the turn from here rather than guessing.`
      : `The panel and the display it drives are the same way up, so a touch trace
         plays over this display without being turned.`}</p></section>`);
  }

  if(d.flags.length){
    out.push(`<section class="dgroup"><h3>Flags</h3>${flatChips(d.flags)}</section>`);
  }

  if(d.modes.length > 1){
    out.push(`<section class="dgroup"><h3>Modes</h3>
      <div class="doc-scroll"><table class="doc-table">
      <thead><tr><th>id</th><th>size</th><th>refresh</th></tr></thead>
      <tbody>${d.modes.map(m =>
        `<tr><td>${m.id}${d.mode && m.id === d.mode.id
          ? ' <span style="color:var(--mark)">◂</span>' : ''}</td><td>${m.w} × ${m.h}</td><td>${
          dmHz(m.fps)} Hz</td></tr>`).join('')}</tbody></table></div></section>`);
  }

  out.push(`<section class="dgroup"><h3>The service</h3>${dl([
    ['displays', g.displays],
    ['display devices', g.devices],
    ['viewports', g.viewports],
    g.stableSize && ['stable size', `${g.stableSize.w} × ${g.stableSize.h}`],
    g.safeMode && ['safe mode', '<span class="no">on</span>'],
  ])}</section>`);

  return out;
}

/* ---- dumpsys activity ---- */

/* What a windowing mode means for the node it is printed on. A task that is
   not fullscreen is the usual reason a window is not the size somebody
   expected, so the mode is worth a sentence rather than a word. */
const ACT_MODES = {
  fullscreen: `The task has the whole of the display less the system decor.`,
  'multi-window': `The task is sharing the display — split screen, or a task
    the shell has given bounds of its own. Its bounds are what it was given,
    not what it asked for.`,
  freeform: `A desktop window: the task is at bounds the user moved and
    resized it to, and can sit anywhere on the display.`,
  pinned: `Picture in picture. The task is the small window on top of whatever
    is behind it, and the activity in it is paused but still visible.`,
  undefined: `The task inherits its mode from whatever holds it.`,
};

/* The states an activity is printed in, in the order the lifecycle runs, and
   what each one says about the window on screen. */
const ACT_STATES = {
  RESUMED: `On screen and taking input. There is one of these per display at
    most, and it is what the focused window should belong to.`,
  STARTED: `Visible but not the one taking input — the other half of a split,
    or an activity under a dialog.`,
  PAUSED: `Still visible, no longer taking input. A picture-in-picture task
    sits here, and so does an activity under a translucent one.`,
  STOPPED: `Not visible. The process is still alive and the activity keeps its
    state, which is where the home task usually is while an app is open.`,
  DESTROYED: `Gone. The record is still in the tree because the task holds it.`,
  INITIALIZING: `Starting up: the activity has been created and has not drawn.`,
};

function activityDetail(n){
  const p = n.props;
  const out = [];

  if(n.ancestors.length){
    out.push(`<section class="dgroup"><h3>Inside</h3>${
      n.ancestors.map(a => docLink(a.hash, a.title)).join('')}</section>`);
  }

  if(n.kind === 'activity'){
    out.push(`<section class="dgroup"><h3>Activity</h3>${dl([
      ['component', esc(p.component || n.title)],
      p.state && ['state', esc(p.state)],
      p.taskId !== null && ['in task', `#${p.taskId}`],
      p.userId !== null && ['user', p.userId],
      ['visible', yn(n.visible)],
      p.visibleRequested !== null && ['visible requested', yn(p.visibleRequested)],
      p.occludesParent !== null && ['occludes what is behind', yn(p.occludesParent)],
      p.finishing !== null && ['finishing', yn(p.finishing)],
      ['at', `line ${n.at}`],
    ])}</section>`);

    out.push(`<section class="dgroup"><h3>Process</h3>${dl([
      p.package && ['package', esc(p.package)],
      p.process && ['process', esc(p.process)],
      p.app && ['record', `<code>${esc(p.app)}</code>`],
      p.launchedFrom && ['launched by', esc(p.launchedFrom)],
      p.launchedFromUid && ['as uid', esc(p.launchedFromUid)],
      p.resizeMode && ['resize mode', esc(p.resizeMode.replace(/^RESIZE_MODE_/, '').toLowerCase())],
      p.lastVisible && ['last visible', esc(p.lastVisible)],
    ])}</section>`);

    if(p.intent){
      out.push(`<section class="dgroup"><h3>Intent</h3>
        <p style="margin:0; overflow-wrap:anywhere">${esc(p.intent)}</p></section>`);
    }

    const why = p.state && ACT_STATES[p.state];
    if(why) out.push(`<section class="dgroup"><h3>${esc(p.state)}</h3>
      <p style="margin:0">${why}</p></section>`);
  } else if(n.kind === 'fragment'){
    out.push(`<section class="dgroup"><h3>Task fragment</h3>${dl([
      ['hash', `<code>${esc(n.idHash)}</code>`],
      p.mode && ['mode', esc(p.mode)],
      p.embedded !== null && ['embedded', yn(p.embedded)],
      ['at', `line ${n.at}`],
    ])}</section>`);
    out.push(`<section class="dgroup"><h3>What it is</h3><p style="margin:0">
      A part of a task, given bounds of its own. Activity embedding puts two
      activities of one app side by side this way, and the activities inside
      are laid out in the fragment's bounds rather than the task's.
      </p></section>`);
  } else {
    out.push(`<section class="dgroup"><h3>Task</h3>${dl([
      p.taskId !== null && ['id', `#${p.taskId}`],
      ['type', esc(p.type || '—')],
      p.mode && ['mode', esc(p.mode)],
      p.component && ['component', esc(shortComponent(p.component))],
      p.affinity && ['affinity', esc(p.affinity)],
      p.userId !== null && ['user', p.userId],
      p.uid && ['uid', esc(p.uid)],
      ['visible', yn(n.visible)],
      p.visibleRequested !== null && ['visible requested', yn(p.visibleRequested)],
      p.translucent !== null && ['translucent', yn(p.translucent)],
      p.childCount !== null && ['holds', `${p.childCount} child${p.childCount === 1 ? '' : 'ren'}`],
      ['at', `line ${n.at}`],
    ])}</section>`);

    out.push(`<section class="dgroup"><h3>How it is held</h3>${dl([
      p.organized !== null && ['organized by the shell', yn(p.organized)],
      p.resizeable !== null && ['resizeable', yn(p.resizeable)],
      p.resizeMode && ['resize mode', esc(p.resizeMode.replace(/^RESIZE_MODE_/, '').toLowerCase())],
      p.everVisible !== null && ['has been visible', yn(p.everVisible)],
      p.inRecents !== null && ['in recents', yn(p.inRecents)],
      p.lockTask && ['lock task', esc(p.lockTask.replace(/^LOCK_TASK_AUTH_/, '').toLowerCase())],
      p.calledBy && ['started by', esc(p.calledBy)],
    ])}</section>`);

    if(p.intent){
      out.push(`<section class="dgroup"><h3>Intent</h3>
        <p style="margin:0; overflow-wrap:anywhere">${esc(p.intent)}</p></section>`);
    }

    const why = p.mode && ACT_MODES[p.mode];
    if(why) out.push(`<section class="dgroup"><h3>${esc(p.mode)}</h3>
      <p style="margin:0">${why}</p></section>`);
  }

  return out;
}

function activityDisplayDetail(d){
  const g = S.data.globals;
  const out = [];
  const tasks = d.nodes.filter(n => n.kind === 'task');
  const acts = d.nodes.filter(n => n.kind === 'activity');

  out.push(`<section class="dgroup"><h3>Display</h3>${dl([
    ['size', `${d.size.w} × ${d.size.h} px${d.synthesised
      ? ' ' + dim('(from the bounds printed on it)') : ''}`],
    ['tasks', tasks.length],
    ['activities', acts.length],
    d.nodes.some(n => n.kind === 'fragment')
      && ['fragments', d.nodes.filter(n => n.kind === 'fragment').length],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>On top</h3>${dl([
    ['resumed', d.resumed ? docLink(d.resumed.hash, d.resumed.title) : none],
    ['visible tasks', tasks.filter(t => t.visible).length],
    ['modes', tasks.length
      ? esc([...new Set(tasks.map(t => t.props.mode).filter(Boolean))].join(' · ')) || none
      : none],
  ])}</section>`);

  /* The manager's own answer for the device rather than for this display. It
     is what a window dump's focus should agree with, and where it does not,
     one of the two is mid-transition. */
  out.push(`<section class="dgroup"><h3>The manager</h3>${dl([
    ['focused app', g.focusedApp ? esc(shortComponent(
      (g.focusedApp.match(/u\d+\s+(\S+)/) || [])[1] || g.focusedApp)) : none],
    g.currentUser !== null && ['current user', esc(g.currentUser)],
    g.topDisplay !== null && ['top focused display', esc(g.topDisplay)],
    g.sleeping && ['sleeping', g.sleeping === 'true' ? '<span class="no">yes</span>' : 'no'],
    ['tasks in the dump', g.tasks],
    ['activities in the dump', g.activities],
  ])}</section>`);

  return out;
}


/* ---- dumpsys activity services ---- */

/* What a foreground service type is allowed to be doing, which is what the
   declaration is checked against and the first thing to look at when a service
   is being killed or refused. */
const SVC_FGS_TYPES = {
  dataSync: `Moving data the user asked for — a sync, an upload, a download.
    Android 15 onwards times this one out.`,
  mediaPlayback: `Playing audio or video the user can hear. The one type that
    is expected to run for as long as the media does.`,
  mediaProjection: `Recording or casting the screen, which the user consented
    to in a system dialog.`,
  location: `Reading location while the app is not in front. Needs the
    location permission before the type is allowed.`,
  connectedDevice: `Talking to a paired or attached device — bluetooth, USB,
    a wearable.`,
  camera: `Holding the camera while not in front.`,
  microphone: `Holding the microphone while not in front.`,
  phoneCall: `An ongoing call the app is the calling app for.`,
  health: `A workout or health session with a sensor behind it.`,
  remoteMessaging: `Carrying a message to another device.`,
  systemExempted: `Exempt: a system role or an allowlist is what lets it run,
    not a type it declared.`,
  shortService: `A short piece of work with a deadline. The platform gives it
    a few minutes, demotes it, then ANRs the app if it has not stopped.`,
  specialUse: `A use the platform has no type for, declared with a reason in
    the manifest.`,
  fileManagement: `Bulk work on the user's files — a move, a copy, a delete
    the user started.`,
  mediaProcessing: `Transcoding or otherwise working on media already on the
    device. Android 15 onwards gives this one a few hours and then stops it.`,
  manifest: `Every type the manifest declared: the app started the service
    without naming one, so the platform took the lot.`,
};

/* What the connection flags the binder prints short actually asked for. The
   spellings are ConnectionRecord's own, in the order it prints them. */
const SVC_CONN_FLAGS = {
  CR: 'BIND_AUTO_CREATE — the binding starts the service if nothing else has',
  DBG: 'BIND_DEBUG_UNBIND',
  '!FG': 'BIND_NOT_FOREGROUND',
  IMPB: 'BIND_IMPORTANT_BACKGROUND',
  ABCLT: 'BIND_ABOVE_CLIENT — the client would rather die than lose the service',
  OOM: 'BIND_ALLOW_OOM_MANAGEMENT',
  WPRI: 'BIND_WAIVE_PRIORITY — the binding does not hold the process up',
  IMP: 'BIND_IMPORTANT',
  WACT: 'BIND_ADJUST_WITH_ACTIVITY',
  FGSA: 'BIND_FOREGROUND_SERVICE_WHILE_AWAKE',
  FGS: 'BIND_FOREGROUND_SERVICE — the binding holds the service in the foreground',
  LACT: 'BIND_TREAT_LIKE_ACTIVITY',
  SLTA: 'BIND_SCHEDULE_LIKE_TOP_APP',
  VFGS: 'BIND_TREAT_LIKE_VISIBLE_FOREGROUND_SERVICE',
  UI: 'BIND_SHOWING_UI',
  '!VIS': 'BIND_NOT_VISIBLE',
  '!PRCP': 'BIND_NOT_PERCEPTIBLE',
  BALF: 'BIND_ALLOW_ACTIVITY_STARTS',
  CAPS: 'BIND_INCLUDE_CAPABILITIES — the client lends its while-in-use capabilities',
  '!CPU': 'BIND_ALLOW_FREEZE',
  DEAD: 'the service is gone',
};

/* `PROC_STATE_TOP`, `SYSTEM_UID`, `DENIED` — what the manager allowed or
   refused the foreground start on, read the way it is written. */
const svcReason = (r) => r.replace(/^REASON_/, '').replace(/_/g, ' ').toLowerCase();

function serviceDetail(n){
  const out = [];

  if(n.kind === 'connection'){
    const c = n.connection;
    out.push(`<section class="dgroup"><h3>Inside</h3>${
      n.ancestors.map(a => docLink(a.hash, a.title)).join('')}</section>`);
    out.push(`<section class="dgroup"><h3>Connection</h3>${dl([
      ['client', c.client && c.client.process ? esc(c.client.process)
        : dim('not named under the service')],
      c.client && c.client.pid && ['client pid', c.client.pid],
      c.client && c.client.uid && ['client uid', esc(c.client.uid)],
      ['user', c.userId],
      c.target && ['on', esc(c.target)],
      c.binder && ['binder', `<code>${esc(c.binder)}</code>`],
      c.bindFlags && ['bind flags', `<code>${esc(c.bindFlags)}</code>`],
      ['hash', `<code>${esc(c.hash)}</code>`],
    ])}</section>`);
    out.push(`<section class="dgroup"><h3>Bound with</h3>${
      c.flags.length
        ? `<div class="chips">${c.flags.map(f => SVC_CONN_FLAGS[f]
            ? `<span class="chip chip-doc" title="${esc(SVC_CONN_FLAGS[f])}">${esc(f)}</span>`
            : `<span class="chip">${esc(f)}</span>`).join('')}</div>`
        : `<p style="margin:0">${none}</p>`}</section>`);
    return out;
  }

  const s = n.service;
  out.push(`<section class="dgroup"><h3>Service</h3>${dl([
    ['component', esc(s.component)],
    ['package', esc(s.pkg || '—')],
    ['user', s.userId],
    ['listed under', esc(SVC_SECTION_LABEL[s.section] || 'active services')],
    ['at', `line ${s.at}`],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Running</h3>${dl([
    ['process', s.app ? esc(s.process || '—') : `<span class="no">not running</span>`],
    s.pid !== null && ['pid', s.pid],
    ['started', yn(s.startRequested)],
    s.lastStartId && ['last start id', esc(s.lastStartId)],
    s.created && ['created', esc(s.created)],
    s.lastActivity && ['last activity', esc(s.lastActivity)],
    s.permission && ['permission', esc(s.permission)],
    s.targetSdk && ['target sdk', esc(s.targetSdk)],
    s.calledBy && ['last called by', esc(s.calledBy)],
    s.destroying === true && ['destroying', s.destroyTime ? esc(s.destroyTime) : 'yes'],
  ])}</section>`);

  if(s.foreground || s.fgsTypes.length){
    out.push(`<section class="dgroup"><h3>Foreground</h3>${dl([
      ['foreground', yn(s.foreground)],
      s.foregroundId && ['notification id', esc(s.foregroundId)],
      s.fgsTypes.length && ['types', esc(s.fgsTypes.join(' · '))],
      s.fgsCount && ['times started', esc(s.fgsCount)],
      s.fgsSince && ['since', esc(s.fgsSince)],
      s.allowedBy && ['allowed by', esc(svcReason(s.allowedBy))],
      s.whileInUseBy && ['while-in-use permissions', esc(svcReason(s.whileInUseBy))],
      s.whileInUse !== null && ['while-in-use permissions', yn(s.whileInUse)],
      s.notificationShown !== null && ['notification shown', yn(s.notificationShown)],
      s.allowedNote && ['what the manager said', esc(s.allowedNote)],
    ])}</section>`);

    /* A short service is the one kind with a clock on it, and the deadline is
       the whole of why it is worth reading. */
    if(s.shortTimeout){
      out.push(`<section class="dgroup"><h3>Short service deadline</h3>
        <p style="margin:0">${esc(s.shortTimeout)}</p></section>`);
    }

    const typed = s.fgsTypes.filter(t => SVC_FGS_TYPES[t]);
    if(typed.length){
      out.push(`<section class="dgroup"><h3>What the type allows</h3>${typed.map(t =>
        `<p style="margin:0 0 6px"><b>${esc(t)}</b> — ${SVC_FGS_TYPES[t]}</p>`).join('')}</section>`);
    }
  }

  if(s.section === 'Restarting'){
    out.push(`<section class="dgroup"><h3>Restarting</h3>${dl([
      s.restartCount && ['times', esc(s.restartCount)],
      s.nextRestart && ['next attempt', esc(s.nextRestart)],
      s.crashCount && ['crashes', esc(s.crashCount)],
    ])}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Held by</h3>${dl([
    ['connections', s.conns.length],
    s.bindings && ['bind records', s.bindings],
    s.clients && ['client processes', s.clients],
  ])}</section>`);

  if(s.intent){
    out.push(`<section class="dgroup"><h3>Intent</h3>
      <p style="margin:0; overflow-wrap:anywhere">${esc(s.intent)}</p></section>`);
  }

  return out;
}

function serviceGroupDetail(d){
  const g = S.data.globals;
  const mine = d.nodes.filter(n => n.kind === 'service');
  const out = [];

  out.push(`<section class="dgroup"><h3>User ${d.id}</h3>${dl([
    ['services', mine.length],
    ['foreground', mine.filter(n => n.service.foreground).length],
    ['restarting', d.restarting],
    ['not running', mine.filter(n => !n.service.app).length],
    ['connections', mine.reduce((n, s) => n + s.service.conns.length, 0)],
  ])}</section>`);

  /* The services nothing asked for and nothing is holding, which is the list
     a battery question is really about. */
  const held = mine.filter(n => n.service.conns.length && !n.service.startRequested);
  if(held.length){
    out.push(`<section class="dgroup"><h3>Alive only because something is bound</h3>${
      held.map(n => docLink(n.hash, n.title)).join('')}</section>`);
  }

  out.push(`<section class="dgroup"><h3>The dump</h3>${dl([
    ['users', g.users],
    ['services', g.services],
    ['foreground', g.foreground],
    ['connections', g.connections],
    g.pending && ['pending', g.pending],
    g.restarting && ['restarting', g.restarting],
  ])}</section>`);

  return out;
}

/* ---- dumpsys user ---- */

const userChips = (list) =>
  `<div class="chips">${list.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>`;

function userDetail(n){
  const out = [];

  if(n.ancestors.length){
    out.push(`<section class="dgroup"><h3>Inside</h3>${
      n.ancestors.map(a => docLink(a.hash, a.title)).join('')}</section>`);
  }

  if(n.user){
    out.push(`<section class="dgroup"><h3>User</h3>${dl([
      ['id', n.userId],
      ['name', n.userName ? esc(n.userName) : dim('unnamed')],
      ['type', esc(n.type || '—')],
      ['state', esc(n.state || '—')],
      n.serial && ['serial', esc(n.serial)],
      ['current', n.current ? 'yes' : 'no'],
    ])}</section>`);
    if(n.flags.length){
      out.push(`<section class="dgroup"><h3>Flags</h3>${userChips(n.flags)}</section>`);
    }
    /* What a user may not do is the reason to look one up more often than
       anything else in this dump, so it gets a block rather than a row. */
    out.push(`<section class="dgroup"><h3>Effective restrictions</h3>${
      n.restrictions.length ? userChips(n.restrictions)
        : `<p style="margin:0">${dim('none')}</p>`}</section>`);
  } else if(n.userType){
    out.push(`<section class="dgroup"><h3>User type</h3>${dl([
      ['name', esc(n.typeName)],
      ['base', esc(n.base || '—')],
      ['enabled', n.enabled ? 'yes' : 'no'],
    ])}</section>`);
  } else {
    out.push(`<section class="dgroup"><h3>Section</h3>${dl([
      ['at', `line ${n.at}`],
      ['lines', n.lines],
      n.subCount && ['holds', n.meta],
    ])}</section>`);
  }

  return out;
}

function userGroupDetail(d){
  const g = S.data.globals;
  const users = d.nodes.filter(n => n.user);
  const out = [];

  out.push(`<section class="dgroup"><h3>Users</h3>${dl([
    ['current', g.current === null ? dim('unknown')
      : (() => { const u = users.find(x => x.userId === g.current);
                 return u ? docLink(u.hash, u.title) : String(g.current); })()],
    ['users', g.users],
    ['types', g.types],
    g.visible && ['visible', esc(g.visible)],
    g.bootUser && ['boot user', esc(g.bootUser)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Device</h3>${dl([
    g.maxUsers && ['max users', esc(g.maxUsers)],
    g.switchable && ['switchable', esc(g.switchable)],
    g.headless && ['headless system', esc(g.headless)],
    g.deviceManaged && ['managed', esc(g.deviceManaged)],
    g.userVersion && ['user version', esc(g.userVersion)],
  ])}</section>`);

  /* The dump counts its own complaints about the allowlist. It is the one
     number in here that is a finding rather than a fact. */
  if(g.warnings && g.warnings !== '0'){
    out.push(`<section class="dgroup"><h3>Allowlist</h3><p style="margin:0">${
      esc(g.warnings)} warning${g.warnings === '1' ? '' : 's'} — packages allowlisted for a
      user type that are not on the device. They are listed at the end of
      <b>Whitelisted packages per user type</b>.</p></section>`);
  }

  return out;
}

/* ---- system properties ---- */

/* What the properties worth explaining are for. The store has two and a half
   thousand of them and most say what they are called; these are the ones whose
   name is a label on something that takes a sentence, and the ones people open
   a bugreport to check. Anything not in here is left as the name and the
   value, which is what the dump printed and all it claimed. */
const PROP_DOCS = {
  'ro.build.fingerprint': `The whole of the build's identity in one string —
    brand, product, device, release, build id, incremental, build type and keys — and
    the one value to quote in a bug report. Two devices with the same fingerprint are
    running the same software.`,
  'ro.build.id': `The build id, which is the platform's own name for the release
    the device is on (<code>UQ1A.240105.004</code> and the like).`,
  'ro.build.version.sdk': `The API level of the platform. What an app compiles
    against and what every compatibility check in the framework is written against.`,
  'ro.build.version.release': `The release people say out loud — 14, 15 — as against
    the SDK number the framework actually branches on.`,
  'ro.build.version.security_patch': `The security patch level the build claims.
    A date far behind the build date is a device on an old patch train, which is worth
    knowing before anything else in a report is believed.`,
  'ro.build.version.incremental': `The build server's number for this build. Two
    builds of the same release differ here and nowhere else.`,
  'ro.build.type': `<code>user</code> is a shipping build. <code>userdebug</code> and
    <code>eng</code> are not: they run with root available, more logging and asserts
    a user build does not have, so behaviour seen on one is not proof of behaviour
    on the other.`,
  'ro.build.tags': `<code>release-keys</code> means the build was signed with the
    release keys. <code>test-keys</code> means it was signed with the public AOSP
    ones, which anybody has.`,
  'ro.build.characteristics': `What the build was made for — <code>automotive</code>,
    <code>tablet</code>, <code>tv</code>, <code>watch</code>, <code>nosdcard</code>.
    Resource qualifiers and a good deal of framework behaviour turn on it.`,
  'ro.build.date': `When the build was built.`,
  'ro.product.first_api_level': `The API level the device first shipped at, which
    is not the one it is running now. Vendor compatibility requirements are written
    against this rather than against the current SDK.`,
  'ro.product.cpu.abi': `The ABI native code has to be built for. The list of every
    ABI the device loads is <code>ro.product.cpu.abilist</code>.`,
  'ro.debuggable': `<code>1</code> means the build is debuggable: every app is
    debuggable, <code>adb root</code> works, and the device is not one anything about
    security should be concluded from.`,
  'ro.secure': `<code>0</code> means adbd runs as root out of the box. On a shipping
    build this is <code>1</code>.`,
  'ro.adb.secure': `<code>1</code> means adb asks for the host key to be
    authorised. <code>0</code> means anything that can reach the device over USB or
    the network has a shell on it.`,
  'ro.boot.verifiedbootstate': `What verified boot decided. <code>green</code> is a
    stock build with the stock keys; <code>yellow</code> is signed with a key the user
    added; <code>orange</code> is an unlocked bootloader verifying nothing; and
    <code>red</code> is verification having failed.`,
  'ro.boot.flash.locked': `<code>1</code> is a locked bootloader. <code>0</code>
    means the device will flash anything, so the software on it is not necessarily the
    software the fingerprint names.`,
  'ro.boot.veritymode': `Whether dm-verity is enforcing over the read-only
    partitions. <code>eio</code> or <code>logging</code> is a partition that was
    modified, or one that was allowed to be.`,
  'ro.treble.enabled': `Whether the device is a Treble device — the vendor image
    talking to the framework over stable interfaces rather than being built with it.`,
  'ro.vndk.version': `The VNDK snapshot the vendor image was built against. It says
    how old the vendor half of a Treble device is relative to the framework half.`,
  'ro.zygote': `Which zygote the device starts: <code>zygote64_32</code> runs a
    64-bit primary with a 32-bit secondary, <code>zygote64</code> is 64-bit only.
    It decides what an app process can be.`,
  'ro.config.low_ram': `<code>true</code> puts the framework in its low-memory
    configuration, which changes what is cached, how many processes are kept and how
    hard the killer works — worth knowing before reading a memory dump.`,
  'ro.sf.lcd_density': `The density the framework lays out at, in dpi. This is the
    number every <code>dp</code> in a layout is multiplied by, so it decides the
    geometry in a window dump as much as the panel's own size does.`,
  'ro.hardware': `The hardware name the kernel was booted with. It is what picks
    the HALs, the input device configuration files and a good deal else by name.`,
  'ro.board.platform': `The SoC the board is built on.`,
  'ro.crypto.state': `Whether the data partition is encrypted, and
    <code>ro.crypto.type</code> says with which scheme — <code>file</code> for
    file-based encryption, which is what a modern device uses.`,
  'sys.boot_completed': `<code>1</code> once the framework has finished booting.
    A dump taken while this is unset is a dump of a device that is still coming up,
    and most of what it says about windows and processes is temporary.`,
  'sys.boot.reason': `Why the device last booted, as the framework recorded it.
    <code>ro.boot.bootreason</code> is the bootloader's own answer, which is the one
    to trust after a crash.`,
  'persist.sys.locale': `The locale the user picked, which persists across boots
    and overrides the build's <code>ro.product.locale</code>.`,
  'persist.sys.timezone': `The timezone the device is set to.`,
  'sys.usb.config': `What the USB stack is currently configured as —
    <code>adb</code>, <code>mtp</code>, <code>none</code>.
    <code>persist.sys.usb.config</code> is what it goes back to across a boot.`,
  'dalvik.vm.heapgrowthlimit': `The heap an ordinary app is held to. An app with
    <code>largeHeap</code> gets <code>dalvik.vm.heapsize</code> instead, and an
    OutOfMemory in an ANR trace is read against whichever of the two applies.`,
  'dalvik.vm.heapsize': `The heap ceiling for an app that asked for
    <code>largeHeap</code>.`,
};

/* The prefixes whose every property means the same thing, so the pane can say
   it without a line per name. */
function propDoc(name){
  if(PROP_DOCS[name]) return PROP_DOCS[name];
  if(INIT_SVC_RE.test(name)){
    return `What init thinks of the service <code>${esc(name.slice('init.svc.'.length))}</code>:
      <code>running</code>, <code>stopped</code> once it has exited, or
      <code>restarting</code> while init waits to start it again. A service that is
      stopped and should not be is the first thing a boot problem shows up as.`;
  }
  if(/^init\.svc_debug_pid\./.test(name)){
    return `The pid init started that service with, on a build that records it.`;
  }
  return null;
}

/* Why a badged value is badged. The badge is the word; this is the sentence. */
function propWhy(n){
  if(INIT_SVC_RE.test(n.name)){
    return `init started this service and it is <b>${esc(n.value)}</b> rather than
      running. If it is meant to be up, whatever it serves is not being served.`;
  }
  const said = {
    'ro.debuggable': `This is a debuggable build. Nothing about security or
      performance measured on it carries over to a user build.`,
    'ro.secure': `adbd runs as root on this device.`,
    'ro.adb.secure': `adb does not ask for host keys to be authorised on this device.`,
    'ro.boot.flash.locked': `The bootloader is unlocked, so the software on the
      device is not necessarily the software the fingerprint names.`,
    'ro.boot.verifiedbootstate': `Verified boot did not come up green, so some part
      of what booted was not signed by the keys the device shipped with.`,
    'ro.boot.veritymode': `dm-verity is not enforcing, which is what a modified
      read-only partition looks like.`,
    'ro.build.type': `This is not a user build: it runs with root available and with
      logging and assertions a shipping build does not have.`,
    'ro.build.tags': `Signed with the public AOSP test keys rather than with release
      keys.`,
    'sys.boot_completed': `The framework had not finished booting when this was
      taken, so most of what the other dumps say is still settling.`,
  }[n.name];
  return said || null;
}

function propDetail(n){
  const out = [];

  if(n.ancestors.length){
    out.push(`<section class="dgroup"><h3>Inside</h3>${
      n.ancestors.map(a => docLink(a.hash, a.title)).join('')}</section>`);
  }

  /* `ro.` is the difference between a fact about the build and something the
     running system put there, and it is not obvious from the name unless you
     already know the rule. */
  const written = (ro) => ro ? 'read-only — set once, at boot'
                             : 'writable while the device is up';

  if(n.prop){
    out.push(`<section class="dgroup"><h3>Property</h3>${dl([
      ['name', mono(n.name)],
      ['value', n.value === '' ? dim('empty') : mono(trim(n.value, 300))],
      ['namespace', esc(n.namespace)],
      ['written', written(n.readOnly)],
      ['at', `line ${n.at}`],
    ])}</section>`);

    if(n.flagged){
      const why = propWhy(n);
      out.push(`<section class="dgroup"><h3>Worth a look</h3>
        <p style="margin:0">${why || `This value is <b>${esc(n.flag)}</b>.`}</p></section>`);
    }

    const doc = propDoc(n.name);
    if(doc) out.push(`<section class="dgroup"><h3>What it is</h3>
      <p style="margin:0">${doc}</p></section>`);
  } else {
    out.push(`<section class="dgroup"><h3>Section</h3>${dl([
      ['namespace', esc(n.namespace)],
      ['properties', n.subCount],
      ['written', written(n.readOnly)],
      ['at', `line ${n.at}`],
    ])}</section>`);
  }

  return out;
}

/* The group is one namespace, and what is worth saying about a namespace is
   short. What the pane is really for is the block above it: whichever
   namespace is open, this is the dump that says what the device is, and that
   answer belongs in front of whoever opened it. */
function propsGroupDetail(d){
  const g = S.data.globals;
  const out = [];

  out.push(`<section class="dgroup"><h3>Device</h3>${dl([
    g.fingerprint && ['fingerprint', mono(g.fingerprint)],
    g.model && ['model', esc(g.model)],
    g.device && ['device', esc([g.device, g.product && g.product !== g.device ? g.product : null]
      .filter(Boolean).join(' · '))],
    g.brand && ['brand', esc([g.manufacturer, g.brand].filter(Boolean).join(' · '))],
    g.hardware && ['hardware', esc([g.hardware, g.board].filter(Boolean).join(' · '))],
    g.abi && ['abi', esc(g.abi)],
    g.characteristics && ['built for', esc(g.characteristics)],
    g.density && ['density', `${esc(g.density)} dpi`],
    (g.locale || g.timezone) && ['set to',
      esc([g.locale, g.timezone].filter(Boolean).join(' · '))],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Build</h3>${dl([
    g.release && ['release', esc(g.release)],
    g.sdk && ['sdk', esc(g.sdk)],
    g.firstApi && g.firstApi !== g.sdk && ['shipped at', `api ${esc(g.firstApi)}`],
    g.patch && ['security patch', esc(g.patch)],
    g.buildId && ['build', esc([g.buildId, g.incremental].filter(Boolean).join(' · '))],
    g.buildType && ['type', esc([g.buildType, g.tags].filter(Boolean).join(' · '))],
    g.buildDate && ['built', esc(g.buildDate)],
    g.treble && ['treble', esc(g.treble)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Boot</h3>${dl([
    g.bootState && ['verified boot', esc(g.bootState)],
    g.locked && ['bootloader', g.locked === '1' ? 'locked' : 'unlocked'],
    g.bootReason && ['last boot', esc(g.bootReason)],
    ['boot completed', g.bootCompleted === null ? dim('not printed')
      : g.bootCompleted === '1' ? 'yes' : 'no'],
    g.services && ['init services', `${g.servicesRunning} of ${g.services} running`],
  ])}</section>`);

  /* Everything the rows are badged with, in one place, because the row it is
     on may be in a namespace nobody is going to open. */
  if(g.flagged.length){
    out.push(`<section class="dgroup"><h3>Flagged</h3>${
      /* The label is usually the value said in words, and where it is the
         value itself there is nothing to add to it. */
      dl(g.flagged.slice(0, 14).map(f =>
        [mono(f.name), f.label === f.value ? esc(f.label)
          : `${esc(trim(f.value, 40))} — ${esc(f.label)}`]))}${
      g.flagged.length > 14
        ? `<p style="margin:7px 0 0">${dim(`and ${g.flagged.length - 14} more`)}</p>` : ''}</section>`);
  }

  out.push(`<section class="dgroup"><h3>This namespace</h3>${dl([
    ['namespace', esc(d.label)],
    ['properties', d.nodes.filter(n => n.prop).length],
    ['sections', d.nodes.filter(n => n.propSection).length],
    ['of', `${g.count} in ${g.namespaces} namespace${g.namespaces === 1 ? '' : 's'}`],
  ])}</section>`);

  return out;
}

/* ---- dumpsys overlay ---- */

/* Why an overlay is over nothing. The state is a constant and the answer is a
   sentence, and an overlay dump is opened by someone who has the constant
   already and wants the sentence. */
const OVERLAY_WHY = {
  STATE_MISSING_TARGET: `The target package is not installed for this user, so there is
    nothing to overlay. Nothing is wrong with the overlay itself — it applies the moment
    the target arrives.`,
  STATE_NO_IDMAP: `The idmap between this overlay and its target never built, so the
    resources were never mapped — the <b>IDMAP OF</b> block for it, further down the
    dump, says <code>&lt;missing idmap&gt;</code>. A target updated without the overlay
    being rebuilt against it is the usual cause; so is an overlay signed with a
    different key to a target whose <code>&lt;overlayable&gt;</code> asks for the
    same one.`,
  STATE_DISABLED: `The overlay is installed and usable, and something turned it off.
    A mutable one goes back on with <code>cmd overlay enable</code>; an immutable one
    is decided by the build and not by the device.`,
  STATE_UNKNOWN: `The manager has no state for this overlay, which is what it prints
    before it has looked.`,
  STATE_TARGET_IS_BEING_REPLACED: `The target is mid-update. This is a state the dump
    passes through rather than one it sits in — take it again.`,
  STATE_OVERLAY_IS_BEING_REPLACED: `The overlay is mid-update. This is a state the dump
    passes through rather than one it sits in — take it again.`,
};

/* The overlays over the same target as this one, which is the only context in
   which a priority means anything. */
const overlayStack = (n) =>
  S.data.nodes.filter(x => x.overlay && x.parentHash === n.parentHash);

const overlayPrio = (n) => n.priority === null ? -1 : n.priority;

function overlayDetail(n){
  const out = [];

  if(n.ancestors.length){
    out.push(`<section class="dgroup"><h3>Over</h3>${
      n.ancestors.map(a => docLink(a.hash, a.title)).join('')}</section>`);
  }

  if(n.targetNode){
    out.push(`<section class="dgroup"><h3>Target</h3>${dl([
      ['package', esc(n.title)],
      ['user', n.userId],
      ['overlays', n.overlays.length],
      ['enabled', n.enabled],
      n.brokenCount ? ['broken', n.brokenCount] : null,
    ])}</section>`);
    /* The order the manager applies them in, highest priority last — so the
       top of this list is the one whose value a resource ends up with. */
    out.push(`<section class="dgroup"><h3>Stack</h3>${n.overlays.map(o =>
      docLink(o.hash, `${o.title} — ${o.on ? 'on' : (o.broken || 'off')}${
        o.priority === null ? '' : `, priority ${o.priority}`}`)).join('')}</section>`);
    return out;
  }

  out.push(`<section class="dgroup"><h3>Overlay</h3>${dl([
    ['package', esc(n.overlayPkg)],
    n.overlayName ? ['name', esc(n.overlayName)] : null,
    ['target', esc(n.target)],
    n.overlayable ? ['overlayable', esc(n.overlayable)] : null,
    ['user', n.userId],
    ['category', n.category ? esc(n.category) : none],
    ['priority', n.priority === null ? dim('not printed') : n.priority],
    ['state', esc(n.state || '—')],
    ['applied', yn(n.on)],
    ['mutable', yn(n.mutable)],
    ['fabricated', yn(n.fabricated)],
    /* Android 16's addition to the block: an overlay held to one display or
       one device is over nothing anywhere else, which no other field says. */
    ['held to', n.constraints.length ? esc(n.constraints.join(', ')) : dim('nothing')],
    n.path ? ['path', esc(n.path)] : null,
  ])}</section>`);

  /* The idmap is the table the target's resource ids are actually mapped
     through, and the manager prints it under the blocks rather than in them.
     Whether there is one at all is the whole answer to a `STATE_NO_IDMAP`. */
  if(n.idmap){
    out.push(`<section class="dgroup"><h3>Idmap</h3>${n.idmap.missing
      ? `<p style="margin:0">The manager has no idmap for this overlay — it printed
         <code>&lt;missing idmap&gt;</code> where the table goes.</p>`
      : dl([
          ['maps', `${n.idmap.mapped} resource${n.idmap.mapped === 1 ? '' : 's'}`],
          n.idmap.targetPath ? ['target', esc(n.idmap.targetPath)] : null,
          n.idmap.overlayPath ? ['overlay', esc(n.idmap.overlayPath)] : null,
        ])}</section>`);
  }

  if(!n.on && OVERLAY_WHY[n.state]){
    out.push(`<section class="dgroup"><h3>Not applied</h3>
      <p style="margin:0">${OVERLAY_WHY[n.state]}</p></section>`);
  }

  /* An overlay that is applied can still lose: the one with the highest
     priority is applied last, and last wins wherever two of them set the same
     resource. That is the second question this dump gets asked and it cannot
     be answered from one block, so it is answered here. */
  const above = n.on ? overlayStack(n).filter(o =>
    o !== n && o.on && overlayPrio(o) > overlayPrio(n)) : [];
  if(above.length){
    out.push(`<section class="dgroup"><h3>Outranked</h3>
      <p style="margin:0 0 6px">This one is applied, but ${above.length === 1
        ? 'another overlay is applied over it at a higher priority, so it wins'
        : `${above.length} overlays are applied over it at a higher priority, so they win`}
        wherever they set the same resource.</p>${
      above.map(o => docLink(o.hash, `${o.title} — priority ${o.priority}`)).join('')}</section>`);
  }

  return out;
}

function overlayGroupDetail(d){
  const g = S.data.globals;
  const mine = d.nodes.filter(n => n.overlay);
  const broke = mine.filter(n => n.broken);
  const out = [];

  out.push(`<section class="dgroup"><h3>User ${d.id}</h3>${dl([
    ['overlays', mine.length],
    ['applied', mine.filter(n => n.on).length],
    ['targets', d.nodes.filter(n => n.targetNode).length],
    mine.some(n => n.fabricated)
      ? ['fabricated', mine.filter(n => n.fabricated).length] : null,
    mine.some(n => !n.mutable)
      ? ['immutable', mine.filter(n => !n.mutable).length] : null,
    mine.some(n => n.constraints.length)
      ? ['constrained', mine.filter(n => n.constraints.length).length] : null,
  ])}</section>`);

  /* An overlay that is over nothing is the reason the dump was taken, so this
     user's are collected rather than left to be found a target at a time. */
  if(broke.length){
    out.push(`<section class="dgroup"><h3>Over nothing</h3>${
      broke.map(n => docLink(n.hash, `${n.title} — ${n.broken}`)).join('')}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Dump</h3>${dl([
    ['users', g.users],
    ['overlays', g.overlays],
    g.idmaps ? ['idmaps', `${g.idmaps}${
      g.missingIdmaps ? `, ${g.missingIdmaps} missing` : ''}`] : null,
    g.configured ? ['configured in the build', g.configured] : null,
    g.defaults ? ['default overlays', esc(g.defaults)] : null,
    g.tail ? ['also printed', esc(g.tail)] : null,
  ])}</section>`);

  return out;
}

/* ---- binder_calls_stats ---- */

/* Whether the dump is worth reading at all is two facts about how it was
   taken, and neither is on the row you are looking at. Both panes ask for them
   here so they read the same in both. */
function binderCaveats(g){
  const out = [];
  if(g.recording === false){
    out.push(`<section class="dgroup"><h3>Nothing was recorded</h3>
      <p style="margin:0">This dump ran with <b>On battery time (ms): 0</b>.
      binder_calls_stats records nothing while the device is charging, which is
      an emulator's normal state, so an empty table here is the collector never
      having run rather than a quiet device. Take it again after
      <code>adb shell dumpsys battery unplug</code>.</p></section>`);
  }
  if(g.sampling > 1){
    out.push(`<section class="dgroup"><h3>Times are sampled</h3>
      <p style="margin:0">One call in ${g.sampling} was timed, so every cpu and
      latency figure below is that sample scaled up. The call counts and the
      exception counts are not sampled — they are counted on every call.
      <code>dumpsys binder_calls_stats --no-sampling</code> times all of
      them.</p></section>`);
  }
  if(g.detailed === false){
    out.push(`<section class="dgroup"><h3>No method names</h3>
      <p style="margin:0">This dump was taken without detailed tracking, so the
      rows name the interface and the transaction code rather than the method.
      <code>dumpsys binder_calls_stats --enable-detailed-tracking</code> puts
      the names in.</p></section>`);
  }
  return out;
}

function binderDetail(n){
  const g = S.data.globals;
  const out = [];

  if(n.ancestors.length){
    out.push(`<section class="dgroup"><h3>Called by</h3>${
      n.ancestors.map(a => docLink(a.hash, a.title)).join('')}</section>`);
  }

  if(n.caller){
    out.push(`<section class="dgroup"><h3>Caller</h3>${dl([
      ['name', esc(n.who.name || n.who.label)],
      ['uid', n.uid === null ? esc(n.who.spec) : `${n.uid}${
        n.who.spec !== String(n.uid) ? dim(` · ${esc(n.who.spec)}`) : ''}`],
      n.who.user !== null && ['user', n.who.user],
      ['shared uid', n.sharedUid ? 'yes' : 'no'],
    ])}</section>`);

    out.push(`<section class="dgroup"><h3>Cost</h3>${dl([
      ['calls', n.calls],
      ['methods', n.methods],
      ['cpu time', binderTime(n.cpu)],
      n.pct !== null && ['share of cpu', `${n.pct}%`],
      ['threw', n.exceptions || dim('none')],
    ])}</section>`);

    /* The table above the summary keeps only the top of the dump, so a caller
       can total more than the rows under it add up to. Saying so is cheaper
       than letting the two numbers disagree in silence. */
    if(n.trimmed){
      out.push(`<section class="dgroup"><h3>Not all of it is here</h3>
        <p style="margin:0">The summary counts ${n.calls} calls for this caller;
        the rows below it are ${n.rowsCalls}. The table keeps the top 90% by cpu
        time, so the rest were dropped before it was printed.</p></section>`);
    }
    return out;
  }

  out.push(`<section class="dgroup"><h3>Call</h3>${dl([
    ['interface', esc(n.cls)],
    n.inner && ['implemented by', esc(n.inner)],
    ['method', n.named ? esc(n.method)
      : dim(n.method ? esc(n.method) + ' — not a method of this interface'
                     : 'not recorded')],
    ['calls', `${n.calls}${n.recorded < n.calls
      ? dim(` · ${n.recorded} timed`) : ''}`],
    n.screen !== null && ['screen on', n.screen ? 'yes' : 'no'],
    n.worksource && ['work source', esc(n.worksource)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Time</h3>${dl([
    ['cpu', binderTime(n.cpu)],
    ['worst cpu', binderTime(n.maxCpu)],
    ['latency', binderTime(n.latency)],
    ['worst latency', binderTime(n.maxLatency)],
  ])}</section>`);

  /* The two sizes are the high-water marks of what went through the binder
     buffer, which is a megabyte shared by the whole process. A reply near it
     is the call that falls over under load rather than in a dump. */
  out.push(`<section class="dgroup"><h3>Payload</h3>${dl([
    ['largest request', binderBytes(n.maxRequest)],
    ['largest reply', `${binderBytes(n.maxReply)}${
      n.maxReply >= BINDER_BIG_REPLY
        ? dim(' · a binder buffer is 1 MB for the whole process') : ''}`],
  ])}</section>`);

  if(n.exceptions){
    /* The dump counts exceptions per row but names them only once, in the
       tally at the end, so which of them this row threw is not in the file. */
    const named = g.exceptions.length
      ? `The dump names ${g.exceptions.length === 1 ? 'one class' : 'the classes'} it
         threw across every row — ${g.exceptions.map(([c, cls]) =>
           `<b>${esc(cls.split('.').pop())}</b> ×${c}`).join(', ')} — but not
         which of them came from this one.`
      : '';
    out.push(`<section class="dgroup"><h3>Threw</h3>
      <p style="margin:0">${n.exceptions} of these ${n.calls} calls came back with
      an exception instead of a reply. ${named}</p></section>`);
  }

  return out;
}

function binderUserDetail(d){
  const g = S.data.globals;
  const out = [];

  out.push(`<section class="dgroup"><h3>User ${d.id}</h3>${dl([
    ['callers', d.callers],
    ['calls', d.calls],
    ['methods', d.methods],
    ['cpu time', binderTime(d.cpu)],
    ['threw', d.threw || dim('none')],
  ])}</section>`);

  out.push(...binderCaveats(g));

  /* What the dump throws is the question it gets opened with most often, and
     the answer is two halves: the tally names the classes, the rows name the
     callers. Neither is much use without the other, so they sit together. */
  const threw = d.nodes.filter(n => n.call && n.exceptions)
    .sort((a, b) => b.exceptions - a.exceptions);
  if(g.exceptions.length || threw.length){
    const rows = threw.length
      ? `<h3 style="margin-top:11px">Thrown by</h3>${threw.map(n =>
          docLink(n.hash, `${n.exceptions} · ${n.title}`)).join('')}`
      : '';
    out.push(`<section class="dgroup"><h3>Exceptions thrown</h3>${
      g.exceptions.length
        ? dl(g.exceptions.map(([c, cls]) => [esc(cls), c]))
        : `<p style="margin:0">${dim('none')}</p>`}
      <p style="margin:7px 0 0;color:var(--dim)">Counted device-wide, on every
      call rather than on the sampled ones. A permission check that fails
      throws across binder, so a steady count of
      <b>SecurityException</b> is apps asking for what they do not hold rather
      than anything being wrong.</p>${rows}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Dump</h3>${dl([
    g.startTime && ['start time', esc(g.startTime)],
    g.batteryMs !== null && ['on battery', g.batteryMs
      ? binderTime(g.batteryMs * 1000)
      : dim('none · charging the whole time, so nothing was recorded')],
    g.sampling !== null && ['sampling', g.sampling === 1
      ? 'every call' : `1 in ${g.sampling}`],
    g.sharding !== null && g.sharding !== 1 && ['sharding modulo', g.sharding],
    g.totalCpu !== null && ['total cpu', binderTime(g.totalCpu)],
    g.totalCalls !== null && ['total calls', g.totalCalls],
    g.avgCpu !== null && ['average call', esc(g.avgCpu) + ' µs'],
    ['callers', g.callers],
    ['rows', g.rows],
  ])}</section>`);

  return out;
}

/* With nothing selected the pane is the place for the display itself. */
