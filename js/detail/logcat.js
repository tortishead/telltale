/* ---------------- render: the details pane, logcat ---------------- */

/* The levels in the order logcat prints them, so a row of counts reads the
   same way every time and the one that matters is at the end. */
const LOG_ORDER = ['verbose', 'debug', 'info', 'warn', 'error', 'fatal', 'assert'];

function logCounts(counts){
  const rows = LOG_ORDER.filter(k => counts[k]).map(k =>
    `<span class="chip">${esc(k)} <b>${counts[k]}</b></span>`);
  return rows.length ? `<div class="chips">${rows.join('')}</div>` : none;
}

const logWhen = (e) => !e ? null
  : e.time ? `${esc(e.date)} ${esc(e.time)}` : `[${e.uptime.toFixed(6)}]`;

/* One line, in the columns a log reader prints: when, who, what level, which
   tag, and then the message, which is the only part allowed to be long. The
   level is its letter, the way logcat itself writes it — a word in every row
   would push the message off the screen for no gain. */
function logRow(n){
  const e = n.entry;
  const when = e.time ? e.time : e.uptime !== undefined ? `[${e.uptime.toFixed(3)}]` : '';
  const who = e.pid === null ? '' : `${e.pid}-${e.tid}`;
  /* The column is the clock time, because that is what a log is read against
     and a date on every row would cost the message a fifth of the pane. The
     date is a day or two of a bugreport all the same, so it is on the cell. */
  return `<span class="lg-when" title="${esc(logStamp(e))}">${esc(when)}</span>`
    + `<span class="lg-who">${esc(who)}</span>`
    + `<span class="lg-lv" title="${esc(n.level.name)}">${esc(e.levelChar || '\u00b7')}</span>`
    + `<span class="lg-tag" title="${esc(e.tag)}">${esc(e.tag)}</span>`
    + `<span class="lg-msg">${esc(e.message || e.raw)}</span>`;
}

function logDetail(n){
  const out = [];

  const e = n.entry;
  out.push(`<section class="dgroup"><h3>Line</h3>${dl([
    ['level', `<span style="color:${tintFor(n)}">■</span> ${esc(e.level.name)}${
      e.levelChar ? ' ' + dim('(' + e.levelChar + ')') : ''}`],
    /* The tag is how a log is normally narrowed, so it is offered as the
       filter rather than as a link to a row that no longer exists. */
    ['tag', `<button class="btn btn-quiet" type="button" data-logtag="${esc(e.tag)}"
       title="List only this tag">${esc(e.tag)}</button>`],
    ['when', logWhen(e)],
    e.pid !== null && ['pid', `<button class="btn btn-quiet" type="button"
       data-logtag="${e.pid}" title="List only this process">${e.pid}</button>`],
    e.tid !== null && ['tid', `${e.tid}${e.tid === e.pid ? ' ' + dim('· the main thread') : ''}`],
    e.uid && ['uid', esc(e.uid)],
    e.buffer && ['buffer', esc(e.buffer)],
    ['dump line', n.lineNo],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Message</h3><pre class="raw">${
    esc(e.message || e.raw)}</pre></section>`);
  return out;
}

function logSectionDetail(d){
  const g = S.data.globals;
  const out = [];

  out.push(`<section class="dgroup"><h3>${esc(cap(d.label))}</h3>${dl([
    ['lines', `${d.lines}${d.listed < d.lines
      ? ` ${dim('· ' + d.listed + ' listed')}` : ''}`],
    ['tags', d.tags],
    ['levels', logCounts(d.counts)],
    d.buffers.length && ['buffers', flatChips(d.buffers)],
    ['first', logWhen(d.first)],
    ['last', logWhen(d.last)],
    d.command && ['printed by', `<code>${esc(d.command)}</code>`],
  ])}</section>`);

  if(d.crashes.length){
    out.push(`<section class="dgroup"><h3>${d.crashes.length === 1 ? 'A crash' : 'Crashes'}</h3>
      <p style="margin:0 0 6px">${d.crashes.length === 1
        ? 'One tag in this log carries a crash.'
        : `${d.crashes.length} tags in this log carry a crash.`}</p>
      <div class="chips">${d.crashes.map(t =>
        `<button class="btn btn-quiet" type="button" data-logtag="${esc(t)}"
          title="List only this tag">${esc(t)}</button>`).join('')}</div></section>`);
  }

  out.push(`<section class="dgroup"><h3>The whole log</h3>${dl([
    ['sections', g.sections],
    ['lines read', `${g.lines}${g.trimmed ? ` <span style="color:var(--dim)">· ${
      g.shown} listed</span>` : ''}`],
    g.trimmed && ['not listed', `${g.trimmed} ${dim('· the log is longer than the reader holds')}`],
    ['tags', g.tags],
    g.errors && ['errors', g.errors],
    g.warns && ['warnings', g.warns],
    g.first && ['from', esc(g.first)],
    g.last && ['to', esc(g.last)],
  ])}</section>`);

  if(!d.lines){
    out.push(`<section class="dgroup"><h3>Nothing in this buffer</h3>
      <p style="margin:0">The rule for this log is in the file and no lines
      came under it, which is what a bugreport prints when the buffer was
      empty or the device would not give it up.</p></section>`);
  }
  return out;
}

/* ---- the event log ---- */

/* One event, in the log's own columns: when it happened, which process logged
   it, one character for what kind of thing it was, the tag the framework
   wrote, and the sentence the tag comes to. */
function eventRow(n){
  const e = n.entry;
  const kind = evKind(n.kind);
  const when = e.time || '';
  return `<span class="ev-when" title="${esc(logStamp(e))}">${esc(when)}</span>`
    + `<span class="ev-who" title="logged by pid ${e.pid}">${e.pid === null ? '' : e.pid}</span>`
    + `<span class="ev-mark" title="${esc(kind.label)}">${esc(kind.mark)}</span>`
    + `<span class="ev-tag" title="${esc(e.tag)}">${esc(e.tag)}</span>`
    + `<span class="ev-what">${esc(n.title)}</span>`;
}

/* What an event that is the reason the log was taken says to do next. The
   event log records that a thing happened; the thing itself was written
   somewhere else in the same bugreport, and saying where is most of the value
   of having read the tag at all. */
const EVENT_NEXT = {
  am_anr: `The thread dump taken for this ANR is in the bugreport's
    <b>VM TRACES AT LAST ANR</b> section, which opens as its own tab — the main thread's
    stack there is what the ANR actually was. <code>ActivityManager</code> in the system
    log printed the reason again with the CPU usage around it.`,
  am_crash: `The stack trace is in the system log at the same moment, under
    <code>AndroidRuntime</code> — this line is the framework recording that it happened,
    not the exception itself.`,
  am_wtf: `<code>Log.wtf</code> is something the framework decided should never
    happen. The stack that went with it is in the system log at the same moment.`,
  am_kill: `The process was taken by the system rather than crashing. The reason
    field says which pressure did it, and the <code>oomAdj</code> says how expendable the
    process was when it went.`,
  am_low_memory: `The system ran its low-memory pass. Processes killed around
    this line went because of it, not because of anything they did.`,
  dvm_lock_sample: `The runtime sampled a thread waiting on a monitor for long
    enough to be worth logging. An ANR trace taken near this line is where the lock
    actually is.`,
};

function eventDetail(n){
  const e = n.entry;
  const kind = evKind(n.kind);
  const out = [];

  out.push(`<section class="dgroup"><h3>Event</h3>${dl([
    ['what', esc(n.title)],
    /* The tag is how the buffer is narrowed, so it is offered as the filter
       the way a log reader offers one. */
    ['tag', `<button class="btn btn-quiet" type="button" data-logtag="${esc(e.tag)}"
       title="List only this tag">${esc(e.tag)}</button>`],
    ['kind', `<span style="color:${tintFor(n)}">■</span> ${esc(kind.label)}`],
    n.who && ['about', `<button class="btn btn-quiet" type="button" data-logtag="${esc(n.who)}"
       title="List everything about this">${esc(n.who)}</button>`],
    ['when', logWhen(e)],
    e.pid !== null && ['logged by', `pid ${e.pid}${
      e.tid !== null && e.tid !== e.pid ? ` · tid ${e.tid}` : ''}`],
    ['dump line', n.at],
  ])}</section>`);

  /* The fields, named the way the framework declares them. This is the whole
     of what a decoded tag is: the same numbers the row was printed with, with
     the names they were logged under put back. */
  const named = Object.entries(n.fields).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if(named.length){
    out.push(`<section class="dgroup"><h3>Fields</h3>${
      dl(named.map(([k, v]) => [esc(k), esc(trim(String(v), 200))]))}</section>`);
  } else if(n.parts.length){
    out.push(`<section class="dgroup"><h3>Fields</h3>
      <p style="margin:0 0 7px">Telltale does not know this tag, so what it
      printed is kept as it came.</p>${
      dl(n.parts.map((v, i) => [String(i), esc(trim(String(v), 200))]))}</section>`);
  }

  if(n.kind === 'system' && e.tag === 'configuration_changed'){
    const names = configChanges(n.fields.mask);
    out.push(`<section class="dgroup"><h3>What changed</h3>${
      names.length ? flatChips(names)
        : `<p style="margin:0">${dim('the mask was empty')}</p>`}
      <p style="margin:7px 0 0">Every activity that does not handle one of these
      in its manifest was recreated.</p></section>`);
  }

  const next = EVENT_NEXT[e.tag];
  if(next) out.push(`<section class="dgroup"><h3>Where the rest of it is</h3>
    <p style="margin:0">${next}</p></section>`);

  /* The line as it was printed is under everything the pane says already: the
     raw block the details pane puts at the end of what a reader hands it. */
  return out;
}

/* A list of events named in the pane, each one a way into the row it stands
   for. They are in this group by construction — the pane is the group's. */
const eventLinks = (list) => list.length
  ? `<div class="chips">${list.slice(0, 10).map(x =>
      `<button class="btn btn-quiet" type="button" data-logtag="${esc(x.who || x.title)}"
        title="${esc(x.title)}">${esc(trim(x.who || x.title, 34))}</button>`).join('')}${
      list.length > 10 ? dim(` and ${list.length - 10} more`) : ''}</div>`
  : none;

function eventLogDetail(d){
  const g = S.data.globals;
  const out = [];

  const counts = Object.entries(d.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${evKind(k).label}`).join(' · ');

  out.push(`<section class="dgroup"><h3>${esc(cap(d.label))}</h3>${dl([
    ['events', d.events],
    ['tags', d.tags],
    ['kinds', esc(counts)],
    ['first', logWhen(d.first)],
    ['last', logWhen(d.last)],
  ])}</section>`);

  /* The three questions the buffer is opened with. A log with none of them in
     it says so, which is itself the answer. */
  if(g.anrs.length || g.crashes.length || g.kills.length || g.lowMemory){
    out.push(`<section class="dgroup"><h3>What went wrong</h3>${dl([
      g.anrs.length && ['ANRs', eventLinks(g.anrs)],
      g.crashes.length && ['crashes', eventLinks(g.crashes)],
      g.kills.length && ['killed', eventLinks(g.kills)],
      g.lowMemory && ['low memory', `${g.lowMemory} pass${g.lowMemory === 1 ? '' : 'es'}`],
    ])}</section>`);
  }

  /* A log that caught a boot has the framework's own marks on the way up in
     it, and the gaps between them are where a slow one went. */
  if(g.boot.length){
    out.push(`<section class="dgroup"><h3>Boot</h3>${
      dl(g.boot.map(b => [esc(b.step), b.ms ? `${esc(b.ms)} ms` : dim('—')]))}
      <p style="margin:7px 0 0">${dim('milliseconds since the kernel started, as the framework counted them')}</p>
      </section>`);
  }

  out.push(`<section class="dgroup"><h3>The whole log</h3>${dl([
    g.sections > 1 && ['sections', g.sections],
    ['events', g.events],
    ['tags', `${g.tags}${g.unknown ? ` ${dim('· ' + g.unknown + ' Telltale does not know')}` : ''}`],
    g.started && ['processes started', g.started],
    g.died && ['processes died', g.died],
    g.configChanges && ['configuration changes', g.configChanges],
    g.first && ['from', esc(g.first)],
    g.last && ['to', esc(g.last)],
  ])}</section>`);

  return out;
}

function renderDisplayDetail(){
  const d = currentDisplay();
  const noun = S.tool.groupNoun || 'display';
  const head = d.label || `${noun} ${d.id}`;
  $('detailTitle').textContent =
    `${head[0].toUpperCase()}${head.slice(1)}${d.name ? ' · ' + d.name : ''}`;
  const out = S.tool.displayDetail(d);
  const onIt = gevOnDisplay();
  if(onIt) out.push(onIt);
  if(d.raw) out.push(`<section class="dgroup"><h3>Raw block</h3><pre class="raw">${esc(d.raw)}</pre></section>`);
  out.push(`<p style="color:var(--dim);font-family:var(--sans);margin:0">Pick ${an(S.tool.noun)} from the ${
    S.tool.layout === 'list' ? 'list' : 'stack or click one in the layout'}.</p>`);
  $('detail').innerHTML = out.join('');
}
