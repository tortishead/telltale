/* A scene, written out as text a person can read in a diff.
 *
 * The golden files under tests/golden are these digests. A snapshot is only
 * worth keeping if a reviewer can see what changed and say whether it is
 * right, so this prints the fields that decide what the page draws — the
 * frame, the z order, the family, what is visible, what a row is badged with —
 * and leaves out the raw block, which is the input again and would bury the
 * answer.
 *
 * It is deliberately not JSON.stringify of the scene: an ANR scene holds a
 * wait-for graph whose edges point back at their threads, so the scene has
 * cycles in it and does not serialise.
 */

const pad = (s, n) => String(s ?? '').padEnd(n);
const num = (s, n) => String(s ?? '').padStart(n);

const rect = (r) => r ? `[${r.l},${r.t}][${r.r},${r.b}]` : '—';
const size = (s) => s ? `${s.w}x${s.h}` : '—';

/* undefined, null and false all mean "no", and telling them apart in a golden
   file is noise. What matters is which of the three states a tri-state is in. */
const tri = (v) => v === null || v === undefined ? '?' : v ? 'y' : 'n';

function displayHead(d) {
  const bits = [
    `display ${d.id}`,
    d.label && d.label !== `display ${d.id}` ? `label=${d.label}` : null,
    d.name ? `name=${d.name}` : null,
    d.size ? `size=${size(d.size)}` : null,
    d.rotation !== undefined && d.rotation !== null ? `rot=${d.rotation}` : null,
    d.powerMode ? `power=${d.powerMode}` : null,
    d.focus ? `focus=${d.focus}` : null,
  ].filter(Boolean);
  return bits.join('  ');
}

/* A dump with no geometry in it — packages, threads — would print a column of
   em dashes where the frame goes, so it does not get the column at all. */
function nodeLine(n, spatial) {
  return [
    num(n.zRank + 1, 3),
    pad(n.family, 14),
    ...(spatial ? [pad(rect(n.frame), 24), pad(n.frameSource || '—', 10)] : []),
    `vis=${tri(n.visible)}`,
    n.focused ? 'focus' : '     ',
    pad(n.parentHash ? `^${n.parentHash}` : '', 34),
    pad(n.badges.map((b) => b[0]).join(',') || '-', 26),
    n.title,
  ].join('  ').replace(/\s+$/, '');
}

/* What each kind of dump has to say beyond the nodes. Keeping it here rather
   than in four callers means a golden file gains the line the day its parser
   starts reporting the field. */
function extras(scene, d) {
  const out = [];
  if (d.hwc) out.push(`    hwc rows: ${d.hwc.rows.length}`);
  /* `meta` is a line of prose for one tool and a bag of fields for another. */
  if (typeof d.meta === 'string') out.push(`    meta: ${d.meta}`);
  else if (d.meta) {
    for (const [k, v] of Object.entries(d.meta)) {
      if (v !== null && v !== undefined && v !== '') out.push(`    ${k}: ${v}`);
    }
  }
  if (d.graph) {
    out.push(`    wait edges: ${d.graph.edges.length}`);
    out.push(`    cycles: ${d.graph.cycles.length ? d.graph.cycles.map((c) => c.join('->')).join(' | ') : 'none'}`);
    out.push(`    chain to main: ${d.graph.chain.length ? d.graph.chain.join(' <- ') : 'none'}`);
  }
  if (d.analysis) {
    out.push(`    main: ${d.analysis.main ? d.analysis.main.name : 'none'}` +
             `  idle=${tri(d.analysis.mainIdle)}`);
    if (d.analysis.findings && d.analysis.findings.length) {
      for (const f of d.analysis.findings) out.push(`    finding: ${f.title || f}`);
    }
  }
  return out;
}

export function digest(scene) {
  const spatial = scene.nodes.some((n) => n.frame);
  const out = [`tool: ${scene.tool}`, `displays: ${scene.displays.length}`,
               `nodes: ${scene.nodes.length}`, ''];
  for (const d of scene.displays) {
    out.push(displayHead(d));
    out.push(...extras(scene, d));
    for (const n of d.nodes) out.push('  ' + nodeLine(n, spatial));
    out.push('');
  }
  if (scene.globals && Object.keys(scene.globals).length) {
    out.push('globals:');
    for (const [k, v] of Object.entries(scene.globals)) {
      if (v === null || v === undefined || v === '') continue;
      /* A lookup table — a car_service dump's property names — is hundreds of
         entries and would bury the rest. Its size is what a diff can read, and
         the tests next door say what is in it. */
      const plain = typeof v === 'object' && !Array.isArray(v);
      out.push(`  ${k}: ${plain ? `${Object.keys(v).length} entries` : v}`);
    }
    out.push('');
  }
  return out.join('\n');
}
