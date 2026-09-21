/* Runs the whole page under a stub DOM, so the loading layer can be asserted
 * on the way the parse layer already is.
 *
 * tools/parse-layer.mjs slices out the part of index.html that touches no DOM.
 * The rest of the page does, and some of what it decides is worth a test all
 * the same: which readers recognise a dump, therefore how many tabs a
 * bugreport opens with, and whether a zip is opened to the right file inside
 * it. None of that can be reached without the page running.
 *
 * So this gives the page the smallest DOM that lets it start: every element it
 * asks for answers to everything, and nothing is laid out or drawn. What comes
 * back is the page's own functions. It is a test-time tool, like the other two
 * in here, and index.html still ships as one file with no build step.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = fileURLToPath(new URL('../index.html', import.meta.url));

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

/* The page's second script — the first is the theme guard in the head. */
function pageSource(){
  const html = readFileSync(PAGE, 'utf8');
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)];
  if(scripts.length < 2) throw new Error(`index.html: expected two <script> blocks, found ${scripts.length}`);
  return scripts[scripts.length - 1][1];
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
  error: () => { const e = document.getElementById('err'); return e.hidden ? null : e.textContent; },
  note: () => { const e = document.getElementById('loaderNote'); return e.hidden ? null : e.textContent; },
};
`;

export function openPage(){
  const { doc, win, els } = stubDom();
  const globals = {
    document: doc, window: win, requestAnimationFrame: () => 0,
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    matchMedia: win.matchMedia, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
    location: win.location, history: win.history,
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
