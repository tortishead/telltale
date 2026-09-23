/* ---------------- workspaces ---------------- */

/* A workspace holds documents and which of them is open, and nothing else.
   Everything a dump remembers still belongs to the dump, and pane widths and
   the theme still belong to the page, so a switch moves neither. */

function addSpace(){
  const space = newSpace();
  S.spaces.push(space);
  openSpace(space);
}

/* Switching workspaces is the same move as switching tabs, one level up: the
   dumps never left, so it is an assignment and one pass over the DOM. A
   workspace with nothing in it opens on the loader, with the strip still up to
   get back from. */
function openSpace(space){
  S.spaceId = space.id;
  armedClose = null;
  const doc = currentDoc() || S.docs[S.docs.length - 1];
  if(doc) openDoc(doc); else showLoader();
}

function renameSpace(space, name){
  const clean = String(name || '').trim();
  if(clean) space.name = clean;
  renderDocTabs();
}

/* Closing a workspace closes every dump in it, which is why the menu asks
   again while it is holding any. The last workspace is emptied rather than
   closed: the page always has a desk to load the next dump onto. */
function closeSpace(space){
  const i = S.spaces.indexOf(space);
  if(i < 0) return;
  armedClose = null;
  const wasOpen = space.id === S.spaceId;
  if(S.spaces.length === 1){
    space.docId = null;
    return reset();               // clears this workspace's docs and shows the loader
  }
  S.spaces.splice(i, 1);
  if(!wasOpen) return renderDocTabs();
  openSpace(S.spaces[Math.min(i, S.spaces.length - 1)]);
}

/* ---------------- documents ---------------- */

/* Two dumps off the same device are usually two files with the same name, so
   nothing here tries to make a label unique — the tab says where the text came
   from and the tooltip says what is in it. */
let docSeq = 0;

/* What a document starts on: the tool that opens it picks the `show` that
   suits its data, its scene picks the display, and the view opens exploded. */
function initialUi(entry){
  /* A tool that knows some of its rows are noise until asked for — a pool of
     interchangeable threads — says so, and they open shut. */
  const shut = entry.tool.startCollapsed
    ? entry.scene.nodes.filter(entry.tool.startCollapsed).map(n => n.hash) : [];
  return { ...DOC_STATE, toolId:entry.tool.id, show:entry.tool.show,
           /* A dump whose sheet is its own drawing has no stack to tilt, so it
              opens on the plan and never leaves it. */
           view: entry.tool.views === false ? 'plan' : DOC_STATE.view,
           /* Groups are in the order the dump put them in, which for nearly
              every reader is the order to open in. A tool that knows better —
              a trace whose first device by number is the volume rocker and
              whose subject is the panel — says which one. */
           displayId: entry.tool.openOn
             ? entry.tool.openOn(entry.scene) : entry.scene.displays[0].id,
           collapsed:new Set(shut) };
}

function currentDoc(){ return S.docs.find(d => d.id === S.docId) || null; }

/* A tab is one reader's reading of one text. `found` is kept as a list of the
   one entry, because the desk-wide search walks every tab the same way and a
   tab that held several was only ever showing one of them. */
function addDoc(entry, label, from, open){
  const id = ++docSeq;
  const doc = { id, label: String(label || '').trim() || `dump ${id}`,
                from: from || null, found: [entry], ui: initialUi(entry) };
  S.docs.push(doc);
  if(open !== false) openDoc(doc); else renderDocTabs();
  return doc;
}

/* Opening a tab is one assignment: its state never left it. */
function openDoc(doc){
  S.docId = doc.id;
  $('err').hidden = true;
  $('empty').hidden = true;
  $('app').hidden = false;
  $('btnNew').hidden = false;
  $('btnFind').hidden = false;
  $('loaderBack').hidden = true;
  clampPanes();
  syncUi();
}

/* Closing the open tab falls to its neighbour; closing the last one goes back
   to the empty page. */
function closeDoc(id){
  const i = S.docs.findIndex(d => d.id === id);
  if(i < 0) return;
  const wasOpen = S.docs[i].id === S.docId;
  S.docs.splice(i, 1);
  if(!S.docs.length) return reset();
  if(!wasOpen) return renderDocTabs();
  openDoc(S.docs[Math.min(i, S.docs.length - 1)]);
}

/* Switching tools is switching scenes. Nothing is re-parsed — every scene was
   built at load — but the picks made against one set of names mean nothing
   against another, so the document starts over on the new scene and only the
   pose carries across. */
/* Put the open document on screen: first the controls that hold state of their
   own, then every pane. This is the one place that reads a document into the
   DOM, so nothing else has to remember what a switch has to catch up. */
/* The three panes stay the three panes; which one holds the list moves. A
   dump that draws puts its stack on the left and the sheet in the middle; a
   dump that does not draw has nothing for the middle, so the list moves there
   and the left pane takes the groups. The elements are moved rather than
   duplicated, so every handler on them comes along. */
function placePanes(list){
  const host = list ? $('panePlan') : $('paneStack');
  if($('controls').parentElement !== host) host.append($('controls'), $('stackScroll'));
}

function syncUi(){
  /* A trace left playing in one tab must not go on running the clock of
     whatever is opened next, and the paste panel is about the tab it was
     opened on. */
  gevStop();
  $('tracePaste').dataset.open = '0';
  const tool = S.tool;
  $('filter').value = S.filter;
  $('filter').placeholder = tool.filterHint;
  $('filter').setAttribute('aria-label', `Filter ${tool.nouns}`);
  syncFilterBox();
  /* Three layouts, and two questions about them: whether the list goes in the
     middle pane, and whether the middle pane draws. A document does neither —
     it keeps the list on the left, as a drawn dump does, and reads into the
     middle instead of drawing there. */
  const list = tool.layout === 'list';
  const drawn = tool.layout === 'spatial';
  document.body.classList.toggle('layout-list', list);
  document.body.classList.toggle('layout-doc', tool.layout === 'doc');
  placePanes(list);
  /* On a narrow screen the two panes take turns, so the buttons that swap
     them say what each one holds rather than `Stack` and `Layout`. */
  const groups = tool.groupNouns || (tool.groupNoun || 'display') + 's';
  $('tabStack').textContent = list ? cap(groups) : drawn ? 'Stack' : cap(tool.nouns);
  $('tabPlan').textContent = list ? cap(tool.nouns) : drawn ? 'Layout' : 'Contents';
  $('wlist').setAttribute('aria-label', list
    ? `${tool.nouns} in this ${tool.groupNoun || 'group'}`
    : `${tool.nouns} on this display, topmost first`);
  $('optDim').closest('label').hidden = !drawn;   // nothing to dim
  $('optDim').checked = S.dim;
  $('groupHead').hidden = !list;
  if(list){
    const n = S.data.displays.length;
    $('groupTitle').textContent = `${n} ${n === 1 ? (tool.groupNoun || 'group') : groups}`;
  }
  renderDocTabs();
  renderShow();
  renderTabs();
  setView(S.view);       // syncs the depth controls and draws the sheet
  renderList();
  renderDetail();
}

/* "Load another dump" is a screen the page goes to, not a reset: the open
   documents keep their tabs and clicking one comes back to it. */
function showLoader(){
  document.querySelectorAll('.sheet-blank .extra-panel').forEach(el => el.remove());
  note('');
  $('app').hidden = true;
  $('empty').hidden = false;
  $('err').hidden = true;
  $('btnNew').hidden = true;
  const back = $('loaderBack');
  /* The loader is reached from a workspace that still holds dumps as well as
     from an empty one, and where it holds them they are still worth searching. */
  $('btnFind').hidden = !S.docs.length;
  back.hidden = !S.docs.length;
  if(!back.hidden){
    const doc = currentDoc() || S.docs[S.docs.length - 1];
    const many = S.docs.length > 1;
    back.innerHTML = `The ${many ? S.docs.length + ' dumps' : 'dump'} you have open `
      + `${many ? 'stay where they are' : 'stays where it is'} — whatever you load next `
      + `opens in a tab beside ${many ? 'them' : 'it'}. `
      + `Press <b>Esc</b> to go back to <b>${esc(doc.label)}</b>.`;
  }
  document.body.classList.remove('show-detail','show-stack');
  renderDocTabs();
}

const URL_RE = /^(https?:\/\/|\/|\.\/)\S+$/i;

/* Pull a dump over the network. Credentials are left out on purpose: this only
   ever reads something the user can already read anonymously. */
async function loadUrl(raw, prefer){
  const href = String(raw || '').trim();
  if(!href) return fail('Enter a URL first.');
  let u;
  try { u = new URL(href, location.href); }
  catch { return fail('That does not look like a URL.'); }
  if(!/^https?:$/.test(u.protocol)) return fail('Only http and https URLs can be fetched.');

  const btn = $('btnUrlGo');
  if(btn){ btn.disabled = true; btn.textContent = 'Fetching…'; }
  $('err').hidden = true;
  try {
    progress(`Fetching ${u.hostname}`, null);
    const res = await fetch(u.href, { credentials:'omit', redirect:'follow' });
    if(!res.ok) return fail(`The server answered ${res.status} ${res.statusText} for that URL.`);
    const label = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    /* A URL can point at a bugreport zip as easily as at a txt, and which one
       it is, is in the bytes rather than in the name or the content type. */
    const buf = await res.arrayBuffer();
    let text, from = null;
    if(isZip(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)))){
      let done = 0;
      const picked = await zipPickDump(buf, (n, total) => {
        done += n;
        progress(`Unpacking ${label}`, total ? done / total : null);
      });
      text = picked.text; from = picked.name;
    } else {
      text = new TextDecoder().decode(buf);
    }
    if(!text.trim()) return fail('That URL returned an empty file.');
    if(from) note(`Read ${from} out of ${label}.`);
    await load(text, prefer, from || label, from ? label : null);
  } catch(err) {
    /* A zip that would not open says why; a fetch that failed does not, since
       fetch() hides the reason cross-origin and CORS is nearly always it. */
    fail(err && err.message && !/fetch/i.test(err.message)
      ? `That URL could not be read: ${err.message}.`
      : 'Could not fetch that URL. If it is on another site it has to send an ' +
        'Access-Control-Allow-Origin header — otherwise download the file and drop it here.');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Fetch and show'; }
    progressDone();
  }
}

function fail(msg){
  const e = $('err');
  e.textContent = msg;
  e.hidden = false;
  progressDone();
}

/* What is happening and how far through it is. `frac` is a number between 0
   and 1 where there is something to count, and null where there is not — the
   bar sweeps then rather than sitting at nought, which reads as stuck. */
function progress(what, frac){
  const box = $('loading'), fill = $('loadingFill');
  if(!box || !fill) return;
  box.hidden = false;
  $('loadingWhat').textContent = what;
  const sweep = frac === null || frac === undefined;
  fill.classList.toggle('is-sweep', sweep);
  fill.style.width = sweep ? '' : `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
}

function progressDone(){
  const box = $('loading');
  if(box) box.hidden = true;
}

/* Long work on the main thread shows nothing until it lets go of it, so every
   step that takes a moment hands the frame back first. One frame is enough:
   the bar is painted before the next step starts.

   A frame is what a painting tab gives back, and a tab nobody is looking at
   gives back none at all — `requestAnimationFrame` does not run in a hidden or
   occluded window, and a loop that waited on one there would never finish. So
   a hidden tab does not wait, and a visible one waits for the frame or a beat,
   whichever comes first. */
function nextFrame(){
  if(typeof document !== 'undefined' && document.visibilityState === 'hidden'){
    return Promise.resolve();
  }
  return new Promise((r) => {
    let done = false;
    const go = () => { if(!done){ done = true; r(); } };
    requestAnimationFrame(go);
    setTimeout(go, 100);
  });
}

/* Not a failure: something worth saying about what was opened. It goes where
   the error goes, because that is where somebody who just dropped a file is
   looking, and it is cleared the same way. */
function note(msg){
  const e = $('loaderNote');
  if(!e) return;
  e.textContent = msg;
  e.hidden = !msg;
}
function reset(){
  // The paste and URL panels are appended to the card; clear them or they pile
  // up, and a leftover focused input swallows the next paste.
  document.querySelectorAll('.sheet-blank .extra-panel').forEach(el => el.remove());
  note('');
  progressDone();
  S.docs = [];
  S.docId = null;
  document.body.classList.remove('layout-list');
  placePanes(false);
  renderDocTabs();
  $('app').hidden = true;
  $('empty').hidden = false;
  $('btnNew').hidden = true;
  $('btnFind').hidden = true;
  closeFind();
  $('err').hidden = true;
  document.body.classList.remove('show-detail','show-stack');
}
