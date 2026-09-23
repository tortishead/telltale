/* ---------------- render: the details pane, input devices ---------------- */

function inputDevDetail(n){
  const out = [];

  if(n.mapper){
    const rows = Object.entries(n.fields)
      .filter(([k]) => k !== n.title)
      .slice(0, 24)
      .map(([k, v]) => [esc(k), v ? esc(v) : dim('—')]);
    out.push(`<section class="dgroup"><h3>${esc(n.title)} mapper</h3>${dl([
      n.mode && ['mode', esc(n.mode)],
      ...rows,
    ])}</section>`);
    out.push(`<section class="dgroup"><h3>Raw block</h3><pre class="raw">${esc(n.raw)}</pre></section>`);
    return out;
  }

  const hub = n.hub || {};
  out.push(`<section class="dgroup"><h3>Identity</h3>${dl([
    ['device id', n.id],
    ['name', esc(n.title)],
    ['kind', `<span style="color:${tintFor(n)}">■</span> ${esc(n.typeLabel)}`],
    ['external', yn(n.external)],
    n.enabled !== null && ['enabled', yn(n.enabled)],
    n.generation !== null && ['generation', n.generation],
    hub.Descriptor && ['descriptor', esc(hub.Descriptor)],
    hub.Path && ['path', esc(hub.Path)],
    hub.Location && ['location', esc(hub.Location)],
    hub.Identifier && ['identifier', esc(hub.Identifier)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>What it reports</h3>${dl([
    ['sources', n.sources.names.length
      ? flatChips(n.sources.names)
      : (n.sources.raw ? esc(n.sources.raw) : none)],
    n.sources.mask !== null && ['source mask', `0x${n.sources.mask.toString(16).padStart(8, '0')}`],
    n.keyboardLabel && ['keyboard', esc(n.keyboardLabel)],
    n.hasMic !== null && ['microphone', yn(n.hasMic)],
    n.ranges.length && ['axes', flatChips(n.ranges.map(a => a.axis))],
  ])}</section>`);

  if(n.ranges.length){
    out.push(`<section class="dgroup"><h3>Motion ranges</h3>${dl(
      n.ranges.map(a => [esc(a.axis),
        `${esc(a.min)} … ${esc(a.max)} ${dim(`· ${esc(a.source)}`)}${
          +a.resolution ? dim(` · ${esc(a.resolution)}/unit`) : ''}${
          +a.fuzz ? dim(` · fuzz ${esc(a.fuzz)}`) : ''}`]))}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Where it goes</h3>${dl([
    ['display', n.displayId < 0
      ? `${none} ${dim('every display, or wherever focus is')}`
      : n.displayId],
    n.port && ['associated port', esc(n.port)],
    n.uniqueId && ['associated display', esc(n.uniqueId)],
  ])}</section>`);

  if(hub.KeyLayoutFile || hub.KeyCharacterMapFile || hub.ConfigurationFile){
    out.push(`<section class="dgroup"><h3>Configured by</h3>${dl([
      hub.KeyLayoutFile && ['key layout', esc(hub.KeyLayoutFile)],
      hub.KeyCharacterMapFile && ['character map', esc(hub.KeyCharacterMapFile)],
      hub.ConfigurationFile && ['idc', esc(hub.ConfigurationFile)],
    ])}</section>`);
  }

  if(n.subCount){
    out.push(`<section class="dgroup"><h3>Mappers</h3>
      <p style="margin:0">${n.subCount} mapper${n.subCount === 1 ? '' : 's'} under
      this device, one for each thing the reader decided it can do. They are the
      rows under it in the list.</p></section>`);
  }
  return out;
}

function inputDevGroupDetail(d){
  const devs = d.nodes.filter(n => n.device);
  const g = S.data.globals;
  const kinds = new Map();
  for(const n of devs) kinds.set(n.typeLabel, (kinds.get(n.typeLabel) || 0) + 1);

  const out = [];
  out.push(`<section class="dgroup"><h3>${d.id < 0 ? 'Not tied to a display' : 'Display ' + d.id}</h3>${dl([
    ['devices', devs.length],
    kinds.size && ['kinds', [...kinds].map(([k, c]) =>
      `${esc(k)}${c > 1 ? dim(' ×' + c) : ''}`).join(', ')],
    d.viewport && d.viewport.size && ['viewport', `${d.viewport.size.w} × ${d.viewport.size.h} px`],
    d.viewport && d.viewport.uniqueId && ['unique id', esc(d.viewport.uniqueId)],
  ])}</section>`);

  if(d.id < 0){
    out.push(`<section class="dgroup"><h3>What that means</h3>
      <p style="margin:0">These devices name no display. A key goes wherever
      focus is, and a pointer to whichever display it was last on, so on a
      one-screen device this is the normal place for everything that is not a
      touchscreen.</p></section>`);
  }

  out.push(`<section class="dgroup"><h3>The reader</h3>${dl([
    ['devices in this dump', g.devices],
    g.external && ['external', g.external],
    ['mappers', g.mappers],
    g.builtInKeyboard && ['built-in keyboard id', esc(g.builtInKeyboard)],
    g.excluded && ['excluded names', esc(g.excluded)],
    g.viewports && ['viewports', g.viewports],
  ])}</section>`);
  return out;
}
