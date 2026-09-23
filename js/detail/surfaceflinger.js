/* ---------------- render: the details pane, SurfaceFlinger ---------------- */
const SF_POWER = { '0':'OFF', '1':'DOZE', '2':'ON', '3':'DOZE_SUSPEND', '4':'ON_SUSPEND' };

function sfDetail(n){
  const out = [];
  out.push(`<section class="dgroup"><h3>Identity</h3>${dl([
    ['dump #', n.index],
    n.layerId && ['layer id', esc(n.layerId)],
    n.cls && ['class', esc(n.cls)],
    n.handle && ['handle', esc(n.handle)],
    n.uid !== null && ['uid', n.uid],
    n.pid !== null && ['pid', n.pid],
    ['layer stack', n.offscreen ? dim('none — offscreen') : n.displayId],
    n.mirrorOf && ['mirror of', `layer ${n.mirrorOf.map(esc).join(', ')}`],
    n.handleAlive === false && ['client handle', dim('gone — the layer is on its way out')],
    n.childCount && ['children', `${n.childCount} ${n.childCount === 1 ? 'layer' : 'layers'} parented to this one`],
  ])}</section>`);

  /* Root first, this layer last. Every step is a layer in the dump, so every
     step is somewhere you can go. */
  if(n.ancestors.length){
    const step = (title, i, hash) => {
      const pad = `padding-left:${Math.min(i, 7) * 9}px`;
      return hash
        ? `<button class="anc-row" type="button" data-hash="${esc(hash)}" style="${pad}"
             title="${esc(title)}">${esc(title)}</button>`
        : `<div class="anc-row anc-self" style="${pad}" title="${esc(title)}">${esc(title)}</div>`;
    };
    out.push(`<section class="dgroup"><h3>Ancestry</h3><div class="anc">${
      n.ancestors.map((a, i) => step(a.title, i, a.hash)).join('')
      + step(n.title, n.ancestors.length, null)
    }</div></section>`);
  } else if(n.parent){
    out.push(`<section class="dgroup"><h3>Ancestry</h3>${dl([
      ['parent', esc(n.parent) + ' ' + dim('(not in this dump)')],
    ])}</section>`);
  }

  /* A rect the new frontend printed is shown as it was printed as well as as
     it resolves. The dump writes those four numbers left, top, bottom, right,
     so anyone holding the pane next to the dump is looking for numbers the
     pane would otherwise never show. */
  const asPrinted = (k, html) => (n.printed && n.printed[k])
    ? `${html}<br>${dim(`printed {${esc(n.printed[k])}} — left, top, bottom, right`)}`
    : html;

  /* A frame is only wrong against the display it is on, so where it does not
     fit, say so next to the frame itself rather than leaving the reader to
     hold the two sets of numbers against each other. */
  const offDisplay = (off) => {
    const past = [[off.over.l, 'left'], [off.over.t, 'above'],
                  [off.over.r, 'right of'], [off.over.b, 'below']]
      .filter(([px]) => px > 0).map(([px, side]) => `${px} px ${side}`).join(', ');
    return [
      `does not fit the display ${dim(`(${off.size.w} × ${off.size.h})`)}`,
      off.transposed
        ? dim('this frame is that size transposed — what a layer still in the other rotation looks like')
        : off.clear ? dim('no part of this frame is on the display')
        : dim(`past it: ${esc(past)}`),
    ].join('<br>');
  };

  out.push(`<section class="dgroup"><h3>Geometry</h3>${dl([
    n.frame && [`frame ${dim('(' + esc(n.frameSource) + ')')}`,
                asPrinted(n.frameSource, r(n.frame))],
    n.offDisplay && ['fit', offDisplay(n.offDisplay)],
    n.pos && ['pos', `${n.pos.x}, ${n.pos.y}`],
    n.size && ['size', `${n.size.w} × ${n.size.h}`],
    ...Object.entries(n.rects)
      .filter(([k]) => k !== n.frameSource)
      .map(([k, rc]) => [esc(k), asPrinted(k, r(rc))]),
    n.transform && ['transform', `[${n.transform.map(v => v.toFixed(2)).join(', ')}] ${dim('(dsdx dtdx dtdy dsdy)')}`],
    n.toDisplay && ['to display', [
      n.toDisplay.rotate,
      n.toDisplay.sx !== null ? `scale ${n.toDisplay.sx}×${n.toDisplay.sy}` : null,
      n.toDisplay.tx !== null ? `move ${n.toDisplay.tx}, ${n.toDisplay.ty}` : null,
    ].filter(Boolean).map(esc).join(' · ')],
    n.cornerRadius && ['corner radius', n.cornerRadius],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Stacking</h3>${dl([
    ['z order', `${n.zRank+1} of ${n.zCount} ${dim('(1 = topmost, from the order the dump prints)')}`],
    ['z', n.layerZ === null ? '—' : `${n.layerZ} ${dim('(relative to the parent)')}`],
    n.relativeOf && n.relativeOf !== 'none' && ['relative to', esc(n.relativeOf)],
    n.relativeParent && ['z relative to', `layer ${esc(n.relativeParent)}`],
    n.winTypeNum !== null && ['window type', n.winType
      ? `${esc(n.winType)} ${dim(n.winTypeNum)}` : String(n.winTypeNum)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Composition</h3>${dl([
    ['composited', n.comp ? esc(n.comp) : dim('not in the HWC list')],
    n.hwcTransform && ['hwc transform', esc(n.hwcTransform)],
    ['active buffer', n.buffer
      ? `${n.buffer.w} × ${n.buffer.h} ${dim(`stride ${n.buffer.stride} · ${esc(n.buffer.format)}`)}`
      : none],
    n.frameNumber !== null && ['frame', `${n.frameNumber}${n.contentDirty ? ' ' + dim('(content dirty)') : ''}`],
    n.bufferId && ['buffer id', esc(n.bufferId)],
    n.queued !== null && ['queued frames', n.queued],
    n.frameRate && ['requested frame rate', esc(n.frameRate)],
    n.dataspace && ['dataspace', esc(n.dataspace)],
    n.pixelFormat && ['pixel format', esc(n.pixelFormat)],
    n.blurRadius && ['background blur', n.blurRadius + ' px'],
    n.shadowRadius && ['shadow radius', n.shadowRadius],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Appearance</h3>${dl([
    ['type', `<span style="color:${tintFor(n)}">■</span> ${esc(n.typeLabel)}`],
    n.typeLabel !== n.kind && ['made of', esc(n.kind)],
    ['visible', yn(n.visible)],
    /* The new frontend states why, and on a layer that is drawn it says what
       of — a buffer, a colour, a blur — which is the same question. */
    n.reason && [n.visible ? 'drawn from' : 'not drawn because', esc(n.reason)],
    ['focused', yn(n.focused)],
    n.alpha !== null && ['alpha', (n.alpha * 100).toFixed(0) + '%'],
    n.color && ['colour', `<span style="color:rgb(${n.color.map(v => Math.round(v * 255)).join(',')})">■</span> ${n.color.map(v => v.toFixed(3)).join(', ')}`],
    n.opaque !== null && ['opaque', yn(n.opaque === '1')],
    n.isProtected === '1' && ['protected', yn(true)],
    n.trustedOverlay === '1' && ['trusted overlay', yn(true)],
    n.secure && ['secure', yn(true)],
    [`flags ${n.flagsHex ? dim(esc(n.flagsHex)) : ''}`, chips(n.flags, 'sf')],
  ])}</section>`);

  /* A modern dump prints a layer's input config where it used to print its
     flags, and it is the same set of names `dumpsys input` uses. */
  if(n.inputFlags){
    out.push(`<section class="dgroup"><h3>Input</h3>${dl([
      ['config', chips(n.inputFlags, 'input')],
      n.touchable && ['touchable region', asPrinted('touchable region', r(n.touchable))],
      n.touchCrop && ['touchable region', 'replaced with the layer crop'],
      n.touchCropId && ['crop taken from', `layer ${esc(n.touchCropId)}`],
      n.dropInput && ['drop input mode', n.dropInput],
    ])}</section>`);
  }

  return out;
}

function sfDisplayDetail(d){
  const drawn = d.nodes.filter(n => n.frame).length;
  const g = S.data.globals;
  const out = [];

  out.push(`<section class="dgroup"><h3>Display</h3>${dl([
    ['layer stack', d.id],
    ['size', `${d.size.w} × ${d.size.h} px${d.synthesised ? ' ' + dim('(inferred)') : ''}`],
    d.name && ['name', esc(d.name)],
    d.hwcId && ['hwc display', esc(d.hwcId)],
    d.rotation && ['rotation', `${+d.rotation * 90}° ${dim('(ROTATION_' + d.rotation + ')')}`],
    d.powerMode && ['power mode', SF_POWER[d.powerMode] || esc(d.powerMode)],
    d.secure && ['secure', yn(d.secure === '1')],
    d.virtual === '1' && ['virtual', yn(true)],
  ])}</section>`);

  // What the composer did with the layers it was handed. A pile of CLIENT is
  // GPU composition, which is the thing worth noticing here.
  if(d.hwc){
    const tally = new Map();
    for(const row of d.hwc.rows){
      const k = row.comp || 'unknown';
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    out.push(`<section class="dgroup"><h3>Composition</h3>${dl([
      ['composer display', esc(d.hwc.label)],
      ['layers composited', d.hwc.rows.length],
      ...[...tally.entries()].map(([k, v]) => [esc(k.toLowerCase()), v]),
    ])}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Layers</h3>${dl([
    ['on this layer stack', d.nodes.length],
    ['with a frame', `${drawn}${drawn < d.nodes.length ? dim(` (${d.nodes.length - drawn} without)`) : ''}`],
    ['visible', d.nodes.filter(n => n.visible).length],
  ])}</section>`);

  if(g.hwcVersion || g.visibleLayers || g.totalLayers || g.activeLayers || g.build){
    out.push(`<section class="dgroup"><h3>SurfaceFlinger</h3>${dl([
      g.hwcVersion && ['composer', 'HWC ' + esc(g.hwcVersion)],
      g.visibleLayers && ['visible layers', esc(g.visibleLayers)],
      g.totalLayers && ['total layers', esc(g.totalLayers)],
      g.activeLayers && ['active layers', `${esc(g.activeLayers)} ${dim('(with a client handle)')}`],
      g.frontend === 'new' && ['frontend', `new ${dim('(Android 15 and up)')}`],
      g.build && ['build configuration', mono(g.build)],
    ])}</section>`);
  }

  return out;
}
