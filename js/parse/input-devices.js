/* ================ parse: dumpsys input — the reader's devices ============ */

/* The same text read for what is plugged in rather than for what is drawn. A
   device is printed twice: once by the event hub, which knows what the kernel
   says it is and which files configure it, and once by the reader, which knows
   what Android made of that — the sources it publishes, the axes it reports
   and the mappers it was given. Both are keyed by the device id, so they are
   read as one device with two halves. */

const INPUT_DEV_HEAD_RE = /^(\s*)Device\s+(-?\d+):\s*(.*)$/;
const INPUT_HUB_DEV_RE = /^(\s*)(-?\d+):\s+(\S.*)$/;
const INPUT_MAPPER_RE = /^(\s*)([A-Z][\w ]*?(?:Input Mapper|InputMapper))\s*(\([^)]*\))?\s*:\s*$/;
const INPUT_RANGE_RE = /^\s*([A-Z_]+):\s*source=(\S+?),\s*min=(\S+?),\s*max=(\S+?),\s*flat=(\S+?),\s*fuzz=(\S+?),\s*resolution=(\S+?)\s*$/;

/* The lines of a device block that are worth a row of their own in the pane.
   Anything else the block prints is still in the raw text under it. */
function inputDevFields(block) {
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([A-Za-z][\w .]*?):\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    if (key in out) continue;
    out[key] = m[2];
  }
  return out;
}

function parseInputDevicesDump(input) {
  const text = dumpText(input);
  const lines = text.split('\n');

  /* The event hub's half, which is a list of `id: name` under `Devices:`
     inside its own section. Read on its own pass so the far looser head shape
     never gets a look at the rest of the dump. */
  const hub = new Map();
  const hubSpan = inputSection(lines, /^\s*Event Hub State\b/);
  if (hubSpan) {
    const listAt = lines.findIndex((l, i) =>
      i > hubSpan.start && i < hubSpan.end && /^\s*Devices:\s*$/.test(l));
    if (listAt >= 0) {
      const end = hubSpan.end;
      for (let i = listAt + 1; i < end; ) {
        const m = lines[i].match(INPUT_HUB_DEV_RE);
        if (!m) { i++; continue; }
        const { text: block, next } = takeBlock(lines, i, m[1].length);
        hub.set(+m[2], { name: m[3].trim(), fields: inputDevFields(block), raw: block, at: i + 1 });
        i = next;
      }
    }
  }

  const devices = [];
  const readerSpan = inputSection(lines, /^\s*Input Reader State\b/)
                  || { start: -1, end: lines.length };
  for (let i = readerSpan.start + 1; i < readerSpan.end; ) {
    const m = lines[i].match(INPUT_DEV_HEAD_RE);
    if (!m) { i++; continue; }
    const { text: block, next } = takeBlock(lines, i, m[1].length);
    const id = +m[2];
    /* Some builds print the hub's devices in the reader's shape as well, so
       the same device arrives twice. It is one device with two blocks. */
    const had = devices.find((d) => d.id === id);
    if (had) had.block += '\n' + block;
    else devices.push({ id, name: m[3].trim(), block, at: i + 1, indent: m[1].length });
    i = next;
  }

  /* A dump can hold the hub's half and not the reader's — a device the reader
     has not configured yet is still a device that is plugged in. */
  for (const [id, h] of hub) {
    if (!devices.some((d) => d.id === id)) {
      devices.push({ id, name: h.name, block: h.raw, at: h.at, indent: 0, hubOnly: true });
    }
  }
  devices.sort((a, b) => a.id - b.id);

  const nodes = [];
  for (const dev of devices) {
    const fields = inputDevFields(dev.block);
    const h = hub.get(dev.id);
    const hubFields = h ? h.fields : {};
    const sources = inputSources(fields.Sources);
    /* `EXTERNAL` is a class of its own, and `EXTERNAL_STYLUS` is a different
       class that starts with the same word, so the classes are compared whole
       rather than searched. */
    const classes = String(hubFields.Classes || '').split(/\s*\|\s*/).map((c) => c.trim());
    const kind = inputKind(sources.names.length ? sources.names : classes);
    const external = fields.IsExternal === 'true' || classes.includes('EXTERNAL');
    const enabled = hubFields.Enabled === undefined ? null : hubFields.Enabled === 'true';
    const port = fields.AssociatedDisplayPort;
    const viewport = dev.block.match(/Viewport:\s*displayId=(-?\d+)/)
                  || dev.block.match(/AssociatedDisplay:\s*displayId=(-?\d+)/);
    const displayId = viewport ? +viewport[1] : -1;

    const ranges = [];
    for (const line of dev.block.split('\n')) {
      const r = line.match(INPUT_RANGE_RE);
      if (r) ranges.push({ axis: r[1], source: r[2], min: r[3], max: r[4],
                           flat: r[5], fuzz: r[6], resolution: r[7] });
    }

    const kb = fields.KeyboardType === undefined ? null : +fields.KeyboardType;
    const hash = `input:dev:${dev.id}`;
    const node = {
      hash,
      title: dev.name || `device ${dev.id}`,
      displayId,
      frame: null, frameSource: null,
      z: -dev.id,
      family: kind.family,
      typeLabel: kind.label,
      visible: enabled !== false,
      focused: false,
      at: dev.at,
      raw: [dev.block, h && !dev.hubOnly ? h.raw : null].filter(Boolean).join('\n\n'),
      search: `${dev.name} ${dev.id} ${sources.names.join(' ')} ${hubFields.Classes || ''} ${
        hubFields.Path || ''} ${hubFields.Descriptor || ''}`.toLowerCase(),
      device: true,
      id: dev.id,
      sources,
      kind: kind.label,
      external,
      enabled,
      keyboardType: kb,
      keyboardLabel: kb === null ? null : (INPUT_KEYBOARD_TYPES[kb] || String(kb)),
      generation: fields.Generation === undefined ? null : +fields.Generation,
      hasMic: fields.HasMic === undefined ? null : fields.HasMic === 'true',
      port: port === undefined || port === '<none>' ? null : port,
      uniqueId: fields.AssociatedDisplayUniqueId === '<none>' ? null : fields.AssociatedDisplayUniqueId,
      ranges,
      hub: h ? hubFields : null,
      fields,
      badges: [
        ...(enabled === false ? [['disabled', 'badge-exit']] : []),
        ...(external ? [['external', 'badge-comp']] : []),
        ...(displayId >= 0 ? [[`display ${displayId}`, 'badge-comp']] : []),
        ...(dev.hubOnly ? [['not configured', 'badge-exit']] : []),
      ],
      parentHash: null,
      ancestors: [],
      subCount: 0,
    };
    nodes.push(node);

    /* What the reader made of the device: one mapper per thing it decided the
       device can do. They are the breakdown of a device rather than devices of
       their own, so they hang under it. */
    const devLines = dev.block.split('\n');
    const ancestors = [{ hash, title: node.title }];
    let kids = 0;
    for (let i = 0; i < devLines.length; ) {
      const mm = devLines[i].match(INPUT_MAPPER_RE);
      if (!mm) { i++; continue; }
      const { text: body, next } = takeBlock(devLines, i, mm[1].length);
      const mapperName = mm[2].replace(/\s*Input ?Mapper$/, '');
      kids++;
      nodes.push({
        hash: `${hash}:mapper:${kids}`,
        title: mapperName,
        displayId, frame: null, frameSource: null,
        z: -dev.id + 0.001 * -kids,
        family: 'input-mapper', typeLabel: 'mapper',
        visible: true, focused: false,
        at: dev.at + i,
        raw: body,
        search: `${dev.name} ${mapperName} ${body}`.toLowerCase(),
        mapper: true,
        mode: mm[3] ? mm[3].replace(/^\(|\)$/g, '').replace(/^mode\s*-\s*/, '') : null,
        fields: inputDevFields(body),
        lines: body.split('\n').length,
        badges: [],
        parentHash: hash, ancestors,
        subCount: 0,
      });
      i = next;
    }
    node.subCount = kids;
    node.meta = [
      sources.names.length ? sources.names.join(' · ') : sources.raw || null,
      kids ? `${kids} mapper${kids === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');
  }

  const viewports = inputViewports(text);
  const ids = [...new Set(nodes.map((n) => n.displayId))].sort((a, b) => a - b);
  const displays = (ids.length ? ids : [-1]).map((id) => {
    const own = nodes.filter((n) => n.displayId === id && n.device);
    const v = viewports.get(id);
    return {
      id,
      label: id < 0 ? 'no display' : `display ${id}`,
      name: v && v.type ? inputCap(v.type) : null,
      size: v && v.size ? v.size : { w: 0, h: 0 },
      viewport: v || null,
      insets: [], raw: '',
      devices: own.length,
      meta: own.length
        ? `${own.length} device${own.length === 1 ? '' : 's'} · ${
            [...new Set(own.map((n) => n.kind))].join(', ')}`
        : 'no devices',
    };
  });

  const globals = {
    devices: nodes.filter((n) => n.device).length,
    mappers: nodes.filter((n) => n.mapper).length,
    external: nodes.filter((n) => n.device && n.external).length,
    builtInKeyboard: (text.match(/^\s*BuiltInKeyboardId:\s*(-?\d+)\s*$/m) || [])[1] || null,
    excluded: (text.match(/^\s*ExcludedDeviceNames:\s*(.+)$/m) || [])[1] || null,
    viewports: viewports.size,
    hub: hub.size,
  };

  return finaliseScene('inputdev', displays, nodes, globals);
}
