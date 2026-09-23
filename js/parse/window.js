/* ================ parse: dumpsys window ================ */

function parseWindowDump(input) {
  const text = dumpText(input);
  const lines = text.split('\n');
  const windows = [];
  const displayBlocks = [];

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const wm = line.match(WIN_HEAD_RE);
    if (wm) {
      const { text: block, next } = takeBlock(lines, i, wm[1].length);
      windows.push(parseWindowBlock(block, +wm[2], wm[3], wm[4], wm[5]));
      i = next;
      continue;
    }
    const dm = line.match(DISPLAY_HEAD_RE);
    if (dm) {
      const { text: block, next } = takeDisplaySection(lines, i);
      displayBlocks.push(parseDisplayBlock(block, +dm[2]));
      i = next;
      continue;
    }
    i++;
  }

  // Globals — take the last occurrence, which is the top-level summary.
  const grabLast = (re) => {
    let out = null, m;
    const g = new RegExp(re.source, 'gm');
    while ((m = g.exec(text)) !== null) out = m[1];
    return out;
  };
  const globals = {
    focus: grabLast(/^\s*mCurrentFocus=(.+)$/),
    focusedApp: grabLast(/^\s*mFocusedApp=(.+)$/),
    imeTarget: grabLast(/^\s*(?:imeLayeringTarget|mInputMethodTarget)=(.+)$/),
  };

  // Frames the window blocks did not carry, recovered from elsewhere in the
  // dump. Exact per-window frames first — the coarser guesses come after the
  // display list exists, since they need its bounds.
  const geom = buildGeometry(text);
  const recover = (w, hit) => {
    if (w.frame || !hit || !rectValid(hit.rect)) return;
    w.frame = hit.rect;
    w.frameSource = hit.source;
    w.frameDerived = true;
  };
  for (const w of windows) recover(w, geom.byHash.get(w.hash));

  const byId = buildDisplays(displayBlocks, windows, geom.sizeById);

  // Still no frame: lay the window out from its own attributes, and only then
  // fall back to the bounds of the task that contains it.
  for (const w of windows) {
    const rect = deriveFrame(w, byId.get(w.displayId));
    if (rect) recover(w, { rect, source: 'from attrs' });
  }
  for (const w of windows) {
    if (w.rootTaskId === null || w.requested || !/APPLICATION/.test(w.type || '')) continue;
    recover(w, geom.byTask.get(w.rootTaskId));
  }

  // Z-order: layer first, dump order as tiebreak (higher #index sits on top).
  // Dumps that print no layers at all are already in top-down order, so there
  // the dump index has to run the other way.
  const layered = windows.some((w) => w.baseLayer !== null);
  for (const w of windows) {
    w.z = layered
      ? (w.baseLayer === null ? 0 : w.baseLayer) * 1e6
        + (w.subLayer === null ? 0 : w.subLayer) * 1e3
        + w.index
      : -w.index;
  }
  const IME_RE = /^\s*(?:imeLayeringTarget|mInputMethodTarget)(?:\s+in\s+display#\s*(\d+)\s+|\s*=\s*)(\S.*)$/gm;
  let im;
  while ((im = IME_RE.exec(text)) !== null) {
    const target = notNull(im[2].trim());
    if (im[1] === undefined) { globals.imeTarget = target; continue; }
    const d = byId.get(+im[1]);
    if (d) d.imeTarget = target;
  }
  for (const d of byId.values()) {
    if (d.imeTarget === undefined || d.imeTarget === null) d.imeTarget = byId.size === 1 ? globals.imeTarget : null;
  }

  const top = text.match(/mTopFocusedDisplayId=(\d+)/);
  const topDisplay = top ? byId.get(+top[1]) : null;
  if (topDisplay && topDisplay.focus) {
    globals.focus = topDisplay.focus;
    globals.focusedApp = topDisplay.focusedApp || globals.focusedApp;
  }

  const focusHash = globals.focus ? (globals.focus.match(/Window\{(\S+)/) || [])[1] : null;
  for (const w of windows) w.focused = focusHash !== null && w.hash === focusHash;

  // The fields the layers below this one read, filled in from what the window
  // dump happens to call them.
  for (const w of windows) {
    w.family = typeFamily(w.type);
    w.typeLabel = shortType(w.type);
    w.search = `${w.title} ${w.pkg || ''} ${w.type || ''} ${w.hash}`.toLowerCase();
    w.badges = w.exiting ? [['exiting', 'badge-exit']] : [];
  }

  return finaliseScene('window', [...byId.values()], windows, globals);
}
