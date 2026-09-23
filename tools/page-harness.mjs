/* Runs the whole page under a stub DOM, so the loading layer can be asserted
 * on the way the parse layer already is.
 *
 * tools/parse-layer.mjs takes the files of index.html that touch no DOM.
 * The rest of the page does, and some of what it decides is worth a test all
 * the same: which readers recognise a dump, therefore how many tabs a
 * bugreport opens with, and whether a zip is opened to the right file inside
 * it. None of that can be reached without the page running.
 *
 * So this gives the page the smallest DOM that lets it start: every element it
 * asks for answers to everything, and nothing is laid out or drawn. What comes
 * back is the page's own functions. It is a test-time tool, like the other two
 * in here, and the page still has no build step: the files are plain scripts
 * sharing one global scope, so the page is them concatenated in the order
 * index.html lists them, which is what tools/page-files.mjs hands back.
 */

import { pageSource } from './page-files.mjs';

/* One element that answers to everything the page asks of an element. */
function stubEl(id){
  const el = {
    id, innerHTML:'', textContent:'', value:'', hidden:false, checked:false,
    disabled:false, tagName:'DIV', dataset:{}, children:[], parentElement:null,
    style:{ setProperty(){}, removeProperty(){}, getPropertyValue(){ return ''; } },
    classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){}, append(){}, appendChild(){},
    focus(){}, blur(){}, click(){}, remove(){}, scrollIntoView(){},
    insertAdjacentHTML(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { top:0, left:0, right:0, bottom:0, width:800, height:600 }; },
  };
  el.closest = () => stubEl('closest');
  return el;
}

function stubDom(){
  const els = new Map();
  const get = (id) => {
    if(!els.has(id)) els.set(id, stubEl(id));
    return els.get(id);
  };
  const doc = {
    getElementById: get,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t) => stubEl(t),
    addEventListener(){}, removeEventListener(){},
    body: stubEl('body'),
    documentElement: stubEl('html'),
    activeElement: stubEl('active'),
  };
  const win = {
    addEventListener(){}, removeEventListener(){},
    matchMedia: () => ({ matches:false, addEventListener(){}, removeEventListener(){} }),
    location: { search:'', hash:'', href:'file:///index.html' },
    history: { replaceState(){} },
    devicePixelRatio: 2,
  };
  return { doc, win, els };
}

/* What the page hands back. Everything here is the page's own function, called
   the way the page calls it; nothing is reimplemented. */
const PROBE = `
return {
  TOOLS, S,
  load, loadUrl, readDump, zipIndex, zipPickDump, isZip,
  docs: () => S.docs,
  open: (doc) => openDoc(doc),
  display: (id) => { S.displayId = id; renderAll(); },
  select: (hash) => select(hash),
  detail: () => document.getElementById('detail').innerHTML,
  rows: () => { renderList(); return document.getElementById('wlist').innerHTML; },
  sheet: (view) => { setView(view || S.view); return document.getElementById('sheet').innerHTML; },
  /* The filter boxes' own reading of what was typed, and what the list makes
     of it — the one piece of the page that decides which rows exist. */
  match: (q, asRegex) => textMatcher(q, asRegex),
  filter: (q, asRegex) => { S.filter = q; S.regex = !!asRegex; return visibleNodes(); },
  /* The desk-wide search: what it finds across every tab, and what opening one
     of those hits does to the page. Both are the page's own functions, called
     the way the page calls them, box and regex switch included. */
  find: (q, asRegex) => { findRegex = !!asRegex; return findHits(q); },
  goTo: (hit, q, asRegex) => {
    findRegex = !!asRegex;
    document.getElementById('findBox').value = q === undefined ? '' : q;
    goToHit(hit);
  },
  /* The spine: what a node is keyed by, and what else on the desk is keyed by
     the same thing. Both are the page's own functions, taking the node and the
     group it sits on the way the details pane hands them over. */
  ids: (node, display) => nodeIds(node, display),
  join: (node, display) => spineJoin(nodeIds(node, display), node),
  /* The chips as the pane drew them, and what opening one does to the card:
     the walk of the desk happens in openSpine and nowhere before it. */
  chips: () => spineShown,
  openSpine: (i) => openSpine(i),
  finding: () => ({ id: findId, flat: findFlat, groups: findId ? spineHits(findId, spineOf) : null }),
  goToNode: (doc, displayId, hash) => goToNode(doc, displayId, hash),
  /* One surface as the three readers of it describe it: the readings put side
     by side, and what the pane makes of them. */
  /* Shutting a section of the pane, the way clicking its heading does. */
  shut: (key, v) => setShut(key, v),
  sides: (node, display) => surfaceRow(surfaceSides(display.id, currentDoc()), surfaceKey(node)),
  findings: (node, display) =>
    surfaceFindings(surfaceRow(surfaceSides(display.id, currentDoc()), surfaceKey(node)),
                    surfaceKey(node)),
  /* A trace's playhead at a moment: what every stroke on screen has drawn by
     then, and where each finger is. This is what the sheet writes into the SVG
     sixty times a second, taken before it is written. */
  playhead: (t) => { S.playAt = t; return gevPlayhead(gevPlayAt); },
  /* A capture pasted onto a dump that draws, and taken off again — the page's
     own two functions, not a write into its state. */
  attach: (text) => { const bad = gevAttach(text); if(!bad) renderAll(); return bad; },
  detach: () => gevDetach(),
  stage: () => gevStage(),
  error: () => { const e = document.getElementById('err'); return e.hidden ? null : e.textContent; },
  note: () => { const e = document.getElementById('loaderNote'); return e.hidden ? null : e.textContent; },
};
`;

export function openPage(){
  const { doc, win, els } = stubDom();
  const globals = {
    /* The page hands the frame back between readers so the loading bar can
       paint. Nothing paints here, so the frame comes straight back — but it
       has to come back, or a load would never finish. */
    document: doc, window: win, requestAnimationFrame: (fn) => { fn(0); return 0; },
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    matchMedia: win.matchMedia, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
    location: win.location, history: win.history,
    /* Browser-only, and the page uses it to build the selector that finds a
       row again after the desk-wide search jumps to one. */
    CSS: { escape: (s) => String(s).replace(/[^\w-]/g, (c) => '\\' + c) },
    addEventListener: () => {}, removeEventListener: () => {},
    alert: () => {},
  };

  /* Each page keeps its own DOM, and the page's functions are called long
     after it was built, so the globals go on around every call rather than
     once around the build. Two pages in one test file then cannot read each
     other's elements, which is what makes a test that loads a dump repeatable. */
  const saved = new Map();
  const install = () => {
    for(const [k, v] of Object.entries(globals)){
      saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
      Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    }
  };
  const restore = () => {
    for(const [k, d] of saved){
      if(d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
    saved.clear();
  };
  const around = (fn) => (...args) => {
    install();
    let out;
    try { out = fn(...args); }
    catch(e){ restore(); throw e; }
    /* Something that came back a promise is still running in the page, so the
       DOM stays up until it settles. */
    if(out && typeof out.then === 'function'){
      return out.then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
    }
    restore();
    return out;
  };

  install();
  let page;
  try { page = new Function(`"use strict";\n${pageSource()}${PROBE}`)(); }
  finally { restore(); }

  const out = { els };
  for(const [k, v] of Object.entries(page)){
    out[k] = typeof v === 'function' ? around(v) : v;
  }
  return out;
}
