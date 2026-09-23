/* ---------------- render: the details pane, input ---------------- */

/* What each name in `inputConfig=` does to an event on its way to the window,
   written from WindowInfo.InputConfig in AOSP. These are the whole of what the
   dispatcher is told about a window, so a window behaving oddly is nearly
   always one of them, and the names alone do not say enough: NOT_TOUCHABLE and
   NO_INPUT_CHANNEL both mean no touches, for entirely different reasons. */
const INPUT_CONFIG_DOCS = {
  NO_INPUT_CHANNEL: { c: 'InputConfig.NO_INPUT_CHANNEL',
    d: 'The window has no input channel, so nothing is ever delivered to it. It is in the dispatcher’s list for the area it covers, not for the events it takes.' },
  NOT_VISIBLE: { c: 'InputConfig.NOT_VISIBLE',
    d: 'The window is not visible, and an invisible window takes no input however it is otherwise configured.' },
  NOT_FOCUSABLE: { c: 'InputConfig.NOT_FOCUSABLE',
    d: 'The window can never hold focus, so it is never sent key events. Touches are a separate question — a bar is not focusable and still takes them.' },
  NOT_TOUCHABLE: { c: 'InputConfig.NOT_TOUCHABLE',
    d: 'The window takes no touch events. A touch inside it falls through to whatever is behind.' },
  PREVENT_SPLITTING: { c: 'InputConfig.PREVENT_SPLITTING',
    d: 'A multi-touch gesture is never split between this window and another: once this window has one pointer, it gets the rest of them too.' },
  DUPLICATE_TOUCH_TO_WALLPAPER: { c: 'InputConfig.DUPLICATE_TOUCH_TO_WALLPAPER',
    d: 'Touches delivered to this window are also copied to the wallpaper behind it.' },
  IS_WALLPAPER: { c: 'InputConfig.IS_WALLPAPER',
    d: 'The window is the wallpaper. It only sees touches another window duplicated to it.' },
  PAUSE_DISPATCHING: { c: 'InputConfig.PAUSE_DISPATCHING',
    d: 'Dispatching to this window is paused. Events queue up rather than being delivered, and the queue is what an ANR is eventually raised over.' },
  TRUSTED_OVERLAY: { c: 'InputConfig.TRUSTED_OVERLAY',
    d: 'The window is a trusted system overlay, so it is not counted when the dispatcher works out whether an untrusted window is obscuring a touch.' },
  WATCH_OUTSIDE_TOUCH: { c: 'InputConfig.WATCH_OUTSIDE_TOUCH',
    d: 'The window is told when a touch lands outside it, as an ACTION_OUTSIDE event carrying no coordinates.' },
  SLIPPERY: { c: 'InputConfig.SLIPPERY',
    d: 'A touch that starts here and moves off the window is handed to whatever it moved onto, instead of staying with this window for the rest of the gesture.' },
  DISABLE_USER_ACTIVITY: { c: 'InputConfig.DISABLE_USER_ACTIVITY',
    d: 'Input to this window does not count as user activity, so touching it does not keep the screen awake.' },
  DROP_INPUT: { c: 'InputConfig.DROP_INPUT',
    d: 'Every event aimed at this window is dropped. This is what the platform does to a window it has decided is unsafe to deliver to.' },
  DROP_INPUT_IF_OBSCURED: { c: 'InputConfig.DROP_INPUT_IF_OBSCURED',
    d: 'Events are dropped while any other window obscures this one, and delivered normally when nothing does.' },
  SPY: { c: 'InputConfig.SPY',
    d: 'The window is a spy: it is sent a copy of every touch on the display that it covers, and consumes none of them, so the window below still gets the touch.' },
  INTERCEPTS_STYLUS: { c: 'InputConfig.INTERCEPTS_STYLUS',
    d: 'The window takes stylus input that lands anywhere on the display, not only inside its own bounds.' },
  CLONE: { c: 'InputConfig.CLONE',
    d: 'The window is a clone of another one and mirrors what it shows.' },
  GLOBAL_STYLUS_BLOCK_UNTRUSTED: { c: 'InputConfig.GLOBAL_STYLUS_BLOCK_UNTRUSTED',
    d: 'Stylus input anywhere on the display is blocked from untrusted windows while this one is up.' },
  SENSITIVE_FOR_PRIVACY: { c: 'InputConfig.SENSITIVE_FOR_PRIVACY',
    d: 'The window shows something private, which is what screen capture and the input tracing both check before recording what happens in it.' },
};

/* Every rect the region is made of, written out. A region that comes to the
   whole frame is still listed rather than summarised as `the frame again`: the
   numbers are what gets compared against the window dump, and a pane that
   hides them where they happen to agree is a pane you cannot compare from. */
function inputRegionRows(n){
  if(!n.regions.length){
    return [['touchable region', n.regionText === null
      ? dim('not printed') : `${none} ${dim('takes no touch')}`]];
  }
  const same = (rc) => n.frame && rc.l === n.frame.l && rc.t === n.frame.t
                    && rc.r === n.frame.r && rc.b === n.frame.b;
  const head = n.regions.length === 1 ? 'touchable region'
    : `touchable region ${dim('×' + n.regions.length)}`;
  /* Each rect is pickable from here: the row and the rect on the sheet are one
     pick, so reading a number and seeing where it is are the same act. */
  return n.regions.map((rc, i) => [
    i ? dim('&nbsp;') : head,
    `${r(rc)}${same(rc) ? ' ' + dim('· the whole frame') : ''}`,
    `class="pick-region${i === S.region ? ' is-pick' : ''}" data-region="${i}"`
      + ` role="button" tabindex="0" aria-pressed="${i === S.region}"`]);
}

function inputDetail(n){
  const out = [];

  if(n.monitor){
    out.push(`<section class="dgroup"><h3>Global monitor</h3>${dl([
      ['channel', esc(n.title)],
      ['display', n.displayId],
      n.ownerPid && ['owner pid', esc(n.ownerPid)],
      n.ownerUid && ['owner uid', esc(n.ownerUid)],
    ])}</section>`);
    out.push(`<section class="dgroup"><h3>What it gets</h3>
      <p style="margin:0">A global monitor is handed a copy of every touch on
      its display before any window is considered, and it cannot consume one.
      Nothing below it behaves differently for its being there — which is
      why it is drawn nowhere and listed first.</p></section>`);
    return out;
  }

  out.push(`<section class="dgroup"><h3>Identity</h3>${dl([
    ['dispatch #', `${n.index} ${dim('(0 = topmost)')}`],
    n.handle && ['handle', esc(n.handle)],
    n.id !== null && ['window id', n.id],
    n.appName && ['application', esc(n.appName)],
    n.user && ['user', esc(n.user)],
    n.ownerPid !== null && ['owner pid', n.ownerPid],
    n.ownerUid !== null && ['owner uid', n.ownerUid],
    ['display', n.displayId],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Geometry</h3>${dl([
    n.frame && ['frame', r(n.frame)],
    ...inputRegionRows(n),
    n.globalScale !== null && n.globalScale !== 1 && ['global scale', n.globalScale],
    n.alpha !== null && ['alpha', n.alpha],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Dispatch</h3>${dl([
    ['takes touch', yn(n.touchable)],
    ['takes keys', yn(!n.config.includes('NOT_FOCUSABLE') && n.visible)],
    ['focused', yn(n.focused)],
    ['being touched', yn(n.touched)],
    ['visible', yn(n.visible)],
    ['has a channel', yn(n.hasToken === null ? !n.config.includes('NO_INPUT_CHANNEL') : n.hasToken)],
    n.timeout && ['dispatching timeout', esc(n.timeout)],
    n.occlusion && ['touch occlusion', esc(n.occlusion)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Input config</h3>${
    n.config.length ? chips(n.config, 'input')
      : `<p style="margin:0;color:var(--dim)">Nothing set: this window is
         focusable, touchable and takes its events normally.</p>`}</section>`);

  /* The two answers this dump is opened for. Both are about a window other
     than the one being read, so both name it and go to it. */
  if(n.coveredBy){
    out.push(`<section class="dgroup"><h3>Covered</h3>
      <p style="margin:0 0 6px">Every rect this window takes touch in sits
      inside the touchable region of a window above it, so a touch aimed here
      is delivered there instead.</p>
      ${docLink(n.coveredBy.hash, n.coveredBy.title)}</section>`);
  }
  if(n.dropsIfObscured){
    out.push(`<section class="dgroup"><h3>${n.obscuredBy ? 'Dropping its input' : 'Drops input if obscured'}</h3>
      <p style="margin:0${n.obscuredBy ? ' 0 6px' : ''}">This window asked for
      <b>DROP_INPUT_IF_OBSCURED</b>, so nothing is delivered to it while another
      window the dispatcher counts as obscuring it is up.${n.obscuredBy
        ? ' One is:' : ' Nothing in this dump is, so it is being delivered to normally.'}</p>
      ${n.obscuredBy ? docLink(n.obscuredBy.hash, n.obscuredBy.title) : ''}</section>`);
  }
  if(n.occludes){
    out.push(`<section class="dgroup"><h3>Untrusted overlay</h3>
      <p style="margin:0">This window is not a trusted overlay, is
      <b>${n.alpha}</b> opaque and asks for <b>USE_OPACITY</b>, so the
      dispatcher counts it as obscuring what is under it. A window below that
      asked for <b>DROP_INPUT_IF_OBSCURED</b>, or an app calling
      <code>setFilterTouchesWhenObscured</code>, gets nothing while this is
      up.</p></section>`);
  }

  return out;
}

function inputDisplayDetail(d){
  const shown = d.nodes.filter(n => !n.monitor);
  const takes = shown.filter(n => n.touchable);
  const g = S.data.globals;
  const out = [];

  out.push(`<section class="dgroup"><h3>Display</h3>${dl([
    ['size', d.size.w && d.size.h
      ? `${d.size.w} × ${d.size.h} px${d.synthesised ? ' ' + dim('(inferred from the windows)') : ''}`
      : dim('no viewport printed')],
    d.viewportType && ['viewport', esc(d.viewportType)],
    d.rotation !== null && d.rotation !== undefined && ['orientation', `${+d.rotation * 90}°`],
    d.uniqueId && ['unique id', esc(d.uniqueId)],
    ['windows', `${shown.length} ${dim(`· ${takes.length} take touch`)}`],
    d.nodes.length - shown.length && ['global monitors', d.nodes.length - shown.length],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Focus</h3>${dl([
    ['focused window', d.focus ? esc(d.focus) : none],
    ['focused application', d.focusedApp ? esc(d.focusedApp) : none],
    d.dispatchTimeout && ['dispatching timeout', esc(d.dispatchTimeout)],
    g.focusedDisplay !== null && ['top display', `${esc(g.focusedDisplay)}${
      String(d.id) === String(g.focusedDisplay) ? dim(' · this one') : ''}`],
  ])}</section>`);

  if(d.touch){
    out.push(`<section class="dgroup"><h3>Touch in progress</h3>${dl([
      ['down', yn(d.touch.down)],
      ['split between windows', yn(d.touch.split)],
      d.touch.deviceId && ['from device', esc(d.touch.deviceId)],
      d.touch.source && ['source', esc(d.touch.source)],
      d.touch.windows.length && ['going to', d.touch.windows.map(esc).join('<br>')],
    ])}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Dispatcher</h3>${dl([
    ['dispatch enabled', yn(g.dispatchEnabled)],
    ['dispatch frozen', yn(g.dispatchFrozen)],
    ['input filter', yn(g.inputFilter)],
    g.appSwitch && ['app switch', esc(g.appSwitch)],
    g.interactive !== null && ['interactive', yn(g.interactive)],
    g.keyRepeatTimeout && ['key repeat after', esc(g.keyRepeatTimeout)],
    g.keyRepeatDelay && ['key repeat every', esc(g.keyRepeatDelay)],
    g.pointerCapture && ['pointer capture', esc(g.pointerCapture)],
    g.showTouches !== null && ['show touches', yn(g.showTouches)],
  ])}</section>`);

  if(g.dispatchFrozen || g.dispatchEnabled === false){
    out.push(`<section class="dgroup"><h3>Nothing is being delivered</h3>
      <p style="margin:0">The dispatcher is
      ${g.dispatchFrozen ? '<b>frozen</b>' : '<b>disabled</b>'}, so every event
      in this dump was queued rather than delivered, and no window below is
      failing to handle anything. A freeze is normally the screen turning on or
      a configuration change that has not finished.</p></section>`);
  }
  if(!g.named && g.windows){
    out.push(`<section class="dgroup"><h3>An older dump</h3>
      <p style="margin:0">This build printed <code>flags</code>,
      <code>type</code> and <code>inputFeatures</code> as hex rather than the
      <code>inputConfig</code> names. The bits that decide whether an event
      reaches a window are read into those names, so the rows still read the
      same; the ones that do not are left to the window reader, which has all
      of them.</p></section>`);
  }
  return out;
}
