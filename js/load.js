/* What every way in hands to `load`: the text, and what to call the tab. A zip
   is opened to the dump inside it; anything else is already the dump. */
async function readDump(file){
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if(!isZip(head)){
    progress(`Reading ${file.name}`, null);
    return { text: await file.text(), label: file.name };
  }
  progress(`Reading ${file.name}`, null);
  const buf = await file.arrayBuffer();
  let done = 0;
  const picked = await zipPickDump(buf, (n, total) => {
    done += n;
    progress(`Unpacking ${file.name}`, total ? done / total : null);
  });
  return { text: picked.text, label: file.name, from: picked.name };
}

/* Every tool gets a look at the text, and each one that recognises it and
   parses something is kept — a bugreport holds several, and the switcher in
   the top bar is how you get at the others. The score only decides whether a
   tool is worth running; which one opens is the order they are registered in,
   so a dump that holds several always opens on the same one. */
const DETECT_MIN = 2;

/* Reading is the long part — ten readers over half a million lines — so it is
   done a reader at a time with the frame handed back between them: the card
   names the one that is running and the bar fills as they come in.

   One reader failing is not the load failing. A dump drifts between builds and
   a reader that chokes on a shape it has never seen should cost its own tab
   and nothing else, so both halves of a reader's work — deciding it recognises
   the text, and reading it — are taken as answers that might not come, and
   what it says on the way out is kept to be told if no reader got through. */
async function load(text, prefer, label, from){
  /* The bar is the one thing on screen while this runs, so whatever happens
     next it has to come down: a load that gave up silently would leave the
     page sweeping a progress bar at a user with nothing to click. Every way
     into the page — a file, a drop, a paste, a URL — comes through here, so
     saying it once here is saying it for all of them. */
  try { await readInto(text, prefer, label, from); }
  catch(e){ fail(`That dump could not be read${e && e.message ? ': ' + e.message : '.'}`); }
  finally { progressDone(); }
}

async function readInto(text, prefer, label, from){
  const src = String(text === null || text === undefined ? '' : text);
  const found = [], broke = [];
  for(const [i, tool] of TOOLS.entries()){
    progress(`Reading ${tool.name.toLowerCase()}`, i / (TOOLS.length + 1));
    await nextFrame();
    let scene, score;
    try {
      score = tool.detect(src);
      if(score < DETECT_MIN) continue;
      scene = tool.parse(src);
    } catch(e){ broke.push(`${tool.name}: ${(e && e.message) || e}`); continue; }
    /* A reader that handed back something other than a scene is broken in the
       same way as one that threw, and is said so in the same words rather than
       thrown again from a line that reads `scene.ok`. */
    if(!scene || typeof scene !== 'object'){
      broke.push(`${tool.name}: read the text but handed back nothing`);
      continue;
    }
    if(scene.ok) found.push({ tool, scene, score });
  }
  if(!found.length){
    return fail(broke.length
      ? 'That looks like a dump Telltale knows, but it could not be read. ' + broke.join('; ')
      : 'Nothing recognisable in that text. Telltale reads `dumpsys window windows`, '
        + '`dumpsys SurfaceFlinger`, `dumpsys package`, `dumpsys user`, '
        + '`dumpsys input`, `dumpsys display`, `dumpsys car_service` and '
        + '`dumpsys binder_calls_stats` '
        + 'output, `getprop`, `getevent -lt` captures, logcat and the event log, and ART '
        + 'thread dumps (`/data/anr/traces.txt`), '
        + 'or a bugreport — the zip or the text — containing any of them.');
  }
  /* Every reader that recognised the text is a dump in its own right, so each
     one opens as its own tab rather than as a switch inside one tab. A
     bugreport is ten dumps in one file and comes out as ten tabs, left to
     right in the order the readers are registered; `?tool=` decides which of
     them is in front. */
  const open = found.find(f => f.tool.id === prefer) || found[0];
  progress(found.length === 1 ? 'Laying it out' : `Laying out ${found.length} tabs`,
           TOOLS.length / (TOOLS.length + 1));
  await nextFrame();
  for(const entry of found) addDoc(entry, label, from, entry === open);
}
