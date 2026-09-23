/* ================ parse: dumpsys display ================ */

/* Every other reader in Telltale draws onto a display and takes the display's
   size from whatever the dump it was reading happened to say. This is the
   service that decides it. `dumpsys display` prints three views of the same
   hardware: the panels the device has (display devices), the displays the
   framework hands out (logical displays), and the viewports the input stack
   maps touches through. Read together they answer the questions the other
   readers can only assume at — how big the panel really is, which way round
   it is mounted, where the cutout is, and whether the area apps get is the
   whole of it.

   So the displays of this reader are the logical displays, and its nodes are
   the rectangles one display is made of: the panel, the part of it apps get,
   the viewport the input stack maps through, and the cutout. Drawn to scale
   they are the picture nothing else in a bugreport draws. */

const DM_RECT_RE = /Rect\((-?\d+),\s*(-?\d+)\s*-\s*(-?\d+),\s*(-?\d+)\)/;
const DM_RECT_G = new RegExp(DM_RECT_RE.source, 'g');

/* This service prints `Rect(l, t - r, b)` and always has; both of these go
   through the shared reader anyway, so a field that turns up in another
   spelling on some build is still read. */
const dmRect = (s) => diaRect(s);

/* A rect printed as a named field — `logicalFrame=Rect(0, 0 - 1080, 2400)`. */
const dmRectField = (body, key) => diaRectField(body, key);

/* The blocks this service prints hold blocks of their own — a cutout, an HDR
   table, a product descriptor — so one is taken by counting braces rather than
   by matching to the first `}`. */
function dmBalanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/* The first `<Name>{...}` in a text, as its body — a cutout inside a device, a
   DisplayInfo inside a logical display. */
function dmBlock(text, name) {
  const at = text.indexOf(`${name}{`);
  return at < 0 ? null : dmBalanced(text, at + name.length);
}

/* Every `<Name>{...}` in the text, with the line it started on. */
function dmBlocks(text, name) {
  const out = [];
  const re = new RegExp(`${name}\\{`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const body = dmBalanced(text, open);
    out.push({ body, at: text.slice(0, m.index).split('\n').length - 1 });
    re.lastIndex = open + body.length + 2;
  }
  return out;
}

/* A field out of one of those blocks. The service prints them as `key=value`
   in a viewport and as `key value` in a DisplayInfo, so both are read. */
const dmField = (body, key) => {
  const m = body.match(new RegExp(`\\b${key}\\s*[= ]\\s*("[^"]*"|'[^']*'|[^,{}]+)`));
  if (!m) return null;
  const v = m[1].trim().replace(/^["']|["']$/g, '');
  return v === '' || v === 'null' ? null : v;
};
const dmNum = (body, key) => {
  const v = dmField(body, key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/* `real 1080 x 2400`, `app 1080 x 2400` — a size the service prints as words
   rather than as a field. */
const dmSize = (body, key) => {
  const m = body.match(new RegExp(`\\b${key}\\s+(\\d+)\\s*x\\s*(\\d+)`));
  return m ? { w: +m[1], h: +m[2] } : null;
};

const dmFlags = (body) => {
  const out = [];
  for (const m of body.matchAll(/\bFLAG_[A-Z0-9_]+/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
};

/* Android counts rotation in quarter turns and everyone else counts it in
   degrees. The dumps print the quarter turn. */
const dmDegrees = (v) => (v === null || v === undefined ? null : ((v % 4) + 4) % 4 * 90);

/* A refresh rate as a number to read. The service prints one panel's 60 Hz as
   `60.000` and another's as `60.000004`, and neither is a number anyone wants
   on a row, so the trailing zeroes and the rounding noise come off. */
const dmHz = (v) => (v === null || v === undefined ? null : String(Math.round(v * 100) / 100));

/* Every mode the panel printed. Android 16 puts `parentModeId` and `flags`
   between the id and the size, so what is between them is skipped rather than
   spelled — as far as the end of that one mode, which is what `[^{}]` is
   holding it to. */
function dmModes(body) {
  const out = [];
  const re = /\{id=(\d+),[^{}]*?\bwidth=(\d+),\s*height=(\d+),\s*fps=([\d.]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({ id: +m[1], w: +m[2], h: +m[3], fps: +m[4] });
  }
  return out;
}

/* The one it is running. The list is what says what the panel can do; the one
   that matters is the one it is doing. */
const dmMode = (body, id) =>
  (id === null ? null : dmModes(body).find((m) => m.id === id) || null);

/* The holes in a panel, out of the cutout block that describes them. */
function dmCutoutBounds(cutout) {
  if (!cutout) return [];
  const at = cutout.indexOf('Bounds');
  const from = at < 0 ? cutout : cutout.slice(at);
  return [...from.matchAll(DM_RECT_G)]
    .map((m) => ({ l: +m[1], t: +m[2], r: +m[3], b: +m[4] }))
    .filter((r) => r.r > r.l && r.b > r.t);
}

/* Where this service's dump is in a bugreport. `DisplayManagerService state:`
   is the line only this service prints; the rule above it is what dumpstate
   writes and is not there in a pasted dump. */
const DM_SECTION_START = /^-{4,}\s*DISPLAY MANAGER\b|^\s*DISPLAY MANAGER\b|^\s*DisplayManagerService state:/;
/* Android 16 underlines every heading inside the dump:

       Display States: size=1
       ---------------------

   which is a rule of the same shape as the one dumpstate writes between two
   services, and the shared boundary would end the section on the first of
   them — fourteen lines in, before a single device. So this reader ends on a
   rule that names what comes after it, and lets a bare one through.

   The same build also opens its dump with `DISPLAY MANAGER (dumpsys display)`,
   which is the shape of the trailer that names the next service — and in a
   bugreport it sits one line under dumpstate's own rule, so ending on it
   would end the section before it started. A trailer ends this one only when
   it names something else. */
const DM_SECTION_END =
  /^[-=]{3,}\s*[^-=\s]|^DUMP OF SERVICE\b|^(?!DISPLAY MANAGER\b)\S.*\(dumpsys \S+\)\s*$/;
const dmSection = (lines) => sectionSpan(lines, DM_SECTION_START, DM_SECTION_END, 'all');

function dmNode(opts) {
  return {
    hash: opts.hash, title: opts.title, displayId: opts.displayId,
    frame: opts.frame || null, frameSource: opts.frameSource || null, z: opts.z,
    family: opts.family, typeLabel: opts.typeLabel, badges: opts.badges || [],
    search: `${opts.title} ${opts.typeLabel} ${opts.searchExtra || ''}`.toLowerCase(),
    raw: opts.raw || '',
    visible: opts.visible !== false, focused: false,
    parentHash: null, ancestors: [], subCount: 0,
    body: [], bodyAt: opts.at, at: opts.at, meta: opts.meta || null,
  };
}

function parseDisplayManagerDump(input) {
  const lines = dumpLines(input);
  const { start: from, end: to } = dmSection(lines);
  const text = lines.slice(from, to).join('\n');
  /* Indices inside the section are the section's; a row says which line of the
     whole file it came off, so they are put back before they are hung on
     anything. */
  const fileLine = (k) => from + k + 1;

  /* The viewports, which are what the input stack maps a touch through, keyed
     by the display they are for. `dumpsys input` prints these too; this is the
     service that owns them. */
  const viewports = new Map();
  for (const v of dmBlocks(text, 'DisplayViewport')) {
    const id = dmNum(v.body, 'displayId');
    if (id === null || viewports.has(id)) continue;
    viewports.set(id, {
      id, at: fileLine(v.at),
      type: dmField(v.body, 'type'),
      uniqueId: dmField(v.body, 'uniqueId'),
      port: dmNum(v.body, 'physicalPort'),
      orientation: dmNum(v.body, 'orientation'),
      logical: dmRectField(v.body, 'logicalFrame'),
      physical: dmRectField(v.body, 'physicalFrame'),
      deviceSize: (() => {
        const w = dmNum(v.body, 'deviceWidth'), h = dmNum(v.body, 'deviceHeight');
        return w && h ? { w, h } : null;
      })(),
      valid: dmField(v.body, 'valid') !== 'false',
    });
  }

  /* The panels. A device is what the framework has; a logical display is what
     it hands out, and most of the time they are one to one. */
  const devices = dmBlocks(text, 'DisplayDeviceInfo').map((d) => {
    const name = (d.body.match(/^\s*"([^"]*)"/) || [])[1] || dmField(d.body, 'name');
    const size = (d.body.match(/(\d+)\s*x\s*(\d+)/) || []);
    const cutout = dmBlock(d.body, 'DisplayCutout');
    const modeId = dmNum(d.body, 'modeId');
    return {
      at: fileLine(d.at), body: d.body, name: name || null,
      size: size.length ? { w: +size[1], h: +size[2] } : null,
      uniqueId: dmField(d.body, 'uniqueId'),
      density: dmNum(d.body, 'density'),
      dpi: (() => {
        const m = d.body.match(/([\d.]+)\s*x\s*([\d.]+)\s*dpi/);
        return m ? { x: +m[1], y: +m[2] } : null;
      })(),
      type: dmField(d.body, 'type'),
      state: dmField(d.body, 'state'),
      /* The one field in the whole dump that says which way round the panel is
         glued to the device, which is the number every reader that draws a
         touch onto a display has had to assume. */
      installOrientation: dmNum(d.body, 'installOrientation'),
      modeId, mode: dmMode(d.body, modeId), modes: dmModes(d.body),
      renderFrameRate: dmNum(d.body, 'renderFrameRate'),
      flags: dmFlags(d.body),
      owner: dmField(d.body, 'ownerPackageName'),
      cutoutInsets: cutout ? dmRectField(cutout, 'insets') : null,
      /* A cutout prints its insets — how far in the corners eat — and then the
         rectangles the holes actually are, under `Bounds`. It is the second
         that is a place on the panel, so where the block names them that is
         what is read; where it does not, any rect with an area is one. */
      cutoutBounds: dmCutoutBounds(cutout),
    };
  });
  const deviceByName = new Map(devices.filter((d) => d.name).map((d) => [d.name, d]));
  const deviceByUnique = new Map(devices.filter((d) => d.uniqueId).map((d) => [d.uniqueId, d]));

  /* The logical displays, which is what the rest of Android calls a display
     and what the rest of Telltale draws onto. */
  const logicals = [];
  const LOGICAL_HEAD = /^\s*Display\s+(-?\d+):\s*$/;
  for (let i = from; i < to; i++) {
    const m = lines[i].match(LOGICAL_HEAD);
    if (!m) continue;
    const { text: block } = takeBlock(lines, i, indentOf(lines[i]));
    logicals.push({ id: +m[1], at: i + 1, block });
  }

  const displays = [];
  const nodes = [];
  let z = 0;

  const make = (id, at, info, device, name) => {
    /* A logical display states most of this itself; where it did not print a
       field, the panel behind it is the answer. */
    const saidField = (k) => (info ? dmField(info, k) : null);
    const saidNum = (k) => (info ? dmNum(info, k) : null);
    const ofDevice = (k) => (device ? device[k] : null);

    const vp = viewports.get(id) || null;
    const real = (info && dmSize(info, 'real')) || (device && device.size) || null;
    const app = info ? dmSize(info, 'app') : null;
    const rotation = info ? saidNum('rotation') : (vp ? vp.orientation : null);
    const size = real || (app || (vp && vp.deviceSize)) || { w: 1080, h: 1920 };
    const flags = info ? dmFlags(info) : device ? device.flags : [];
    const modeId = info ? saidNum('mode') : ofDevice('modeId');
    const mode = (info && dmMode(info, modeId)) || (device && device.mode) || null;
    const density = saidNum('density') || ofDevice('density');

    const push = (o) => { nodes.push(dmNode({ ...o, displayId: id, z: -z++ })); };

    if (real) {
      push({ hash: `display:${id}:real`, title: 'panel', at,
             frame: { l: 0, t: 0, r: real.w, b: real.h }, frameSource: 'real',
             family: 'disp-panel', typeLabel: 'the display',
             meta: `${real.w} × ${real.h}`,
             searchExtra: `${name || ''} real` });
    }
    if (app && real && (app.w !== real.w || app.h !== real.h)) {
      push({ hash: `display:${id}:app`, title: 'what apps get', at,
             frame: { l: 0, t: 0, r: app.w, b: app.h }, frameSource: 'app',
             family: 'disp-app', typeLabel: 'app area',
             meta: `${app.w} × ${app.h} · ${real.h - app.h}px of decor`,
             searchExtra: 'app area' });
    }
    if (vp && vp.logical) {
      push({ hash: `display:${id}:viewport`, title: 'input viewport', at: vp.at,
             frame: vp.logical, frameSource: 'logicalFrame',
             family: 'disp-viewport', typeLabel: 'viewport',
             meta: `orientation ${dmDegrees(vp.orientation)}°${
               vp.port === null ? '' : ` · port ${vp.port}`}`,
             badges: vp.valid ? [] : [['not valid', 'badge-exit']],
             searchExtra: `viewport ${vp.type || ''} ${vp.uniqueId || ''}` });
    }
    if (vp && vp.physical && vp.logical
        && (vp.physical.l !== vp.logical.l || vp.physical.t !== vp.logical.t
            || vp.physical.r !== vp.logical.r || vp.physical.b !== vp.logical.b)) {
      push({ hash: `display:${id}:physframe`, title: 'physical frame', at,
             frame: vp.physical, frameSource: 'physicalFrame',
             family: 'disp-viewport', typeLabel: 'viewport',
             meta: 'the part of the panel the logical frame is scaled onto',
             searchExtra: 'physical frame' });
    }
    if (device) {
      device.cutoutBounds.forEach((r, k) => {
        push({ hash: `display:${id}:cutout:${k}`, title: `cutout ${k + 1}`, at,
               frame: r, frameSource: 'DisplayCutout',
               family: 'disp-cutout', typeLabel: 'cutout',
               meta: `${r.r - r.l} × ${r.b - r.t}`, searchExtra: 'cutout notch' });
      });
    }

    displays.push({
      id, label: name ? `display ${id} · ${name}` : `display ${id}`,
      name: name || null,
      size, insets: [], raw: '',
      rotation: rotation === null ? null : String(dmDegrees(rotation)),
      real, app, density,
      dpi: ofDevice('dpi'),
      state: saidField('state') || ofDevice('state'),
      type: saidField('type') || ofDevice('type'),
      uniqueId: saidField('uniqueId') || ofDevice('uniqueId'),
      layerStack: saidNum('layerStack'),
      groupId: saidNum('displayGroupId'),
      flags, mode, modes: device ? device.modes : [],
      renderFrameRate: ofDevice('renderFrameRate'),
      owner: ofDevice('owner'),
      viewport: vp,
      /* Which way round the panel is glued on, in degrees, where the service
         said. This is the number a touch trace has had to be turned by hand
         to match, and the only dump in a bugreport that states it. */
      installRotation: device && device.installOrientation !== null
        ? dmDegrees(device.installOrientation) : null,
      device: device ? { name: device.name, size: device.size, at: device.at } : null,
      cutoutInsets: ofDevice('cutoutInsets'),
      meta: [real ? `${real.w} × ${real.h}` : null,
             density ? `${density} dpi` : null,
             mode ? `${dmHz(mode.fps)} Hz` : null,
             rotation ? `${dmDegrees(rotation)}°` : null].filter(Boolean).join(' · '),
    });
  };

  if (logicals.length) {
    for (const lg of logicals) {
      const info = dmBlock(lg.block, 'DisplayInfo');
      /* `mPrimaryDisplayDevice=Built-in Screen` up to Android 15 and
         `mPrimaryDisplayDevice=Built-in Screen(local:4619827259835644672)`
         from 16, which names the device twice — so the trailing bracket is
         taken off for the name and tried as the unique id. */
      const said = ((lg.block.match(/mPrimaryDisplayDevice=(.+)/) || [])[1] || '').trim();
      const brk = said.match(/^(.*?)\s*\(([^()]*)\)$/);
      const devName = brk ? brk[1] : said;
      const devUnique = brk ? brk[2] : null;
      const name = info ? (info.match(/^\s*"([^"]*)"/) || [])[1] || null : null;
      const device = (devName && deviceByName.get(devName))
                  || (devUnique && deviceByUnique.get(devUnique))
                  || (info && deviceByUnique.get(dmField(info, 'uniqueId')))
                  || (logicals.length === 1 ? devices[0] : null)
                  || null;
      make(lg.id, lg.at, info, device || null, name || (device ? device.name : null));
    }
  } else {
    /* A dump that printed its devices and no logical displays — an older build,
       or one cut short — is still a dump of the panels it has. */
    devices.forEach((d, i) => make(i, d.at, null, d, d.name));
  }

  const globals = {
    displays: displays.length,
    devices: devices.length,
    viewports: viewports.size,
    /* The three the rest of Telltale would otherwise have to assume. */
    stableSize: (() => {
      const m = text.match(/mStableDisplaySize=Point\((\d+),\s*(\d+)\)/);
      return m ? { w: +m[1], h: +m[2] } : null;
    })(),
    safeMode: /mSafeMode=true/.test(text),
    lines: to - from,
  };

  return finaliseScene('display', displays, nodes, globals);
}
