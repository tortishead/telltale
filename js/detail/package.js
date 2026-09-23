/* ---------------- render: dumpsys package ---------------- */

/* Permission names are mostly one long shared prefix. Drop it on the row and
   keep the whole thing in the title, so a pane 380px wide is still readable. */
const permShort = (n) => n.replace(/^android\.permission\./, '')
                          .replace(/^com\.android\.(\w+\.)*permission\./, '');

function permRows(list, empty){
  if(!list.length) return `<p style="color:var(--dim);margin:0">${empty}</p>`;
  return list.map(p => {
    const state = p.granted === true ? '<span class="yes">granted</span>'
                : p.granted === false ? '<span class="no">denied</span>'
                : p.prot ? esc(p.prot) : p.note ? esc(p.note) : '';
    const flags = p.flags.length ? dim(' · ' + esc(p.flags.join(' '))) : '';
    return `<div class="ins" title="${esc(p.name)}">
      <span>${esc(permShort(p.name))}</span>
      <span class="ins-rect">${state}${flags}</span>
    </div>`;
  }).join('');
}

function packageDetail(n){
  const out = [];

  /* The shared-uid rows are Telltale's own, not the dump's: say what one is and
     what is under it rather than pretend there is a block behind it. */
  if(n.shared){
    out.push(`<section class="dgroup"><h3>Shared user</h3>${dl([
      ['uid name', esc(n.title)],
      n.appId && ['app id', esc(n.appId)],
      ['packages', `${n.members.length} run under this uid`],
      ['user', n.userId],
    ])}</section>`);
    out.push(`<section class="dgroup"><h3>Members</h3><div class="anc">${
      n.members.map(m => `<button class="anc-row" type="button" data-hash="${esc(m.hash)}"
        title="${esc(m.title)}">${esc(m.title)}</button>`).join('')
    }</div></section>`);
    out.push(`<section class="dgroup"><p style="color:var(--dim);margin:0">These share a
      uid, so they share a data directory, permissions granted to it, and each
      other's process where the manifest allows it. The group is Telltale's, not a
      block in the dump — <code>dumpsys package</code> prints the uid separately,
      under <b>Shared users</b>.</p></section>`);
    return out;
  }

  const p = n.pkg, props = p.props, u = n.user;

  out.push(`<section class="dgroup"><h3>Identity</h3>${dl([
    ['package', esc(n.title)],
    ['kind', esc(n.typeLabel)],
    n.appId && ['app id', `${esc(n.appId)}${n.userId ? dim(` · uid ${n.userId * 100000 + (+n.appId % 100000)} for user ${n.userId}`) : ''}`],
    p.sharedUser && ['shared user', esc(p.sharedUser)],
    n.codePath && ['code path', mono(n.codePath)],
    props.dataDir && ['data dir', mono(props.dataDir)],
    props.primaryCpuAbi && props.primaryCpuAbi !== 'null' && ['abi', esc(props.primaryCpuAbi)
      + (props.secondaryCpuAbi && props.secondaryCpuAbi !== 'null' ? dim(' · ' + esc(props.secondaryCpuAbi)) : '')],
    props.installerPackageName && props.installerPackageName !== 'null' && ['installer', esc(props.installerPackageName)],
    p.section === 'Hidden system packages' && ['shadowed', 'the system build of a package an update has replaced'],
    p.settingsHash && ['settings', esc(p.settingsHash)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Version</h3>${dl([
    props.versionName && ['version name', esc(props.versionName)],
    n.versionCode && ['version code', esc(n.versionCode)],
    props.minSdk && ['min sdk', esc(props.minSdk)],
    props.targetSdk && ['target sdk', esc(props.targetSdk)],
    props.apkSigningVersion && ['apk signing', 'v' + esc(props.apkSigningVersion)],
    p.firstInstall && ['first installed', esc(p.firstInstall)],
    p.lastUpdate && ['last updated', esc(p.lastUpdate)],
    p.timeStamp && p.timeStamp !== p.lastUpdate && ['apk timestamp', esc(p.timeStamp)],
  ])}</section>`);

  /* Everything under here is what one user sees, which is the whole reason the
     users are the groups: the same package is a different row under each. */
  const up = u ? u.props : {};
  out.push(`<section class="dgroup"><h3>User ${n.userId}</h3>${dl([
    ['installed', yn(n.installed)],
    ['enabled', n.enabled === null ? dim('not stated') : esc(n.enabled)],
    ['hidden', yn(n.hidden)],
    ['suspended', yn(n.suspended)],
    ['stopped', `${yn(n.stopped)}${up.notLaunched === 'true' ? dim(' · never launched') : ''}`],
    up.instant === 'true' && ['instant', 'yes'],
    up.distractionFlags && up.distractionFlags !== '0' && ['distraction flags', esc(up.distractionFlags)],
    up.installReason && ['install reason', esc(up.installReason)],
    u && u.gids && ['gids', esc(u.gids)],
    u && u.disabled.length && ['disabled components', u.disabled.length],
    u && u.enabled.length && ['enabled components', u.enabled.length],
    !u && ['note', dim('the dump printed no per-user block for this package')],
  ])}</section>`);

  if(p.flags.length || p.privateFlags.length){
    out.push(`<section class="dgroup"><h3>Flags</h3>${dl([
      ['pkgFlags', flatChips(p.flags)],
      p.privateFlags.length && ['privatePkgFlags', flatChips(p.privateFlags)],
    ])}</section>`);
  }

  /* Runtime grants first: they are the ones that change after install and the
     ones anybody opens a package dump to check. */
  const runtime = u ? u.runtime : [];
  if(runtime.length){
    out.push(`<section class="dgroup"><h3>Runtime permissions <span style="color:var(--dim);font-weight:400">· ${
      runtime.filter(x => x.granted).length}/${runtime.length} granted</span></h3>${
      permRows(runtime, 'none')}</section>`);
  }
  if(p.install.length){
    out.push(`<section class="dgroup"><h3>Install permissions <span style="color:var(--dim);font-weight:400">· ${
      p.install.length}</span></h3>${permRows(p.install, 'none')}</section>`);
  }
  if(p.requested.length){
    /* What is left after the two lists above is the interesting half of a long
       list. It is not the same as denied: a build that prints no grants for a
       package leaves everything it asked for sitting here, so the wording says
       what was read rather than what was concluded. */
    const held = new Set([...runtime, ...p.install].filter(x => x.granted !== false).map(x => x.name));
    const rest = p.requested.filter(x => !held.has(x.name));
    out.push(`<section class="dgroup"><h3>Requested <span style="color:var(--dim);font-weight:400">· ${
      p.requested.length}, ${rest.length} not listed as granted</span></h3>${
      permRows(rest, 'every one of them is granted above')}</section>`);
  }
  if(p.declared.length){
    out.push(`<section class="dgroup"><h3>Declared <span style="color:var(--dim);font-weight:400">· ${
      p.declared.length}</span></h3>${permRows(p.declared, 'none')}</section>`);
  }

  return out;
}

function packageUserDetail(d){
  const pkgs = d.nodes.filter(n => !n.shared);
  const by = (f) => pkgs.filter(n => n.family === f).length;
  const g = S.data.globals;

  const out = [];
  out.push(`<section class="dgroup"><h3>User ${d.id}</h3>${dl([
    ['packages', pkgs.length],
    ['installed', `${d.installed}${d.installed < pkgs.length ? dim(` (${pkgs.length - d.installed} known but not installed here)`) : ''}`],
    ['disabled', d.disabled],
    d.id === 0 && ['note', dim('user 0 is the device owner')],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>By kind</h3>${dl([
    ['third-party', by('pkg-app')],
    ['system', by('pkg-system')],
    ['privileged', by('pkg-priv')],
    ['updated system', by('pkg-updated')],
    ['apex', by('pkg-apex')],
  ])}</section>`);

  const shared = d.nodes.filter(n => n.shared);
  if(shared.length){
    out.push(`<section class="dgroup"><h3>Shared uids</h3>${dl(
      shared.map(sn => [esc(sn.title), `${sn.members.length} packages`])
    )}</section>`);
  }

  if(g.sdk || g.fingerprint || g.shadowed){
    out.push(`<section class="dgroup"><h3>Dump</h3>${dl([
      g.sdk && ['sdk', esc(g.sdk)],
      g.shadowed && ['shadowed system packages', g.shadowed],
      g.fingerprint && ['fingerprint', mono(g.fingerprint)],
    ])}</section>`);
  }

  return out;
}
