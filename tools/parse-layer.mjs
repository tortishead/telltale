/* Loads Telltale's parse layer out of index.html and hands it back as plain
 * functions, so the parsers can be run and asserted on without a browser.
 *
 * Nothing is copied or generated: this reads index.html itself, slices out the
 * text between the start of the page script and the `state and shared helpers`
 * heading, and evaluates that. The parse layer is the part of the page that
 * touches no DOM and no state — text in, scene out — so it runs as-is under
 * node. If a parser ever reaches forward into a later layer, the slice stops
 * evaluating and the tests fail with the name it reached for, which is the
 * point: the boundary the comments claim is the boundary that is checked.
 *
 * Telltale still ships as one file with no build step. This is a test-time
 * tool, the same way tools/flag-docs.py is a maintenance one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = fileURLToPath(new URL('../index.html', import.meta.url));

/* The heading that opens the layer after parse. It is a comment the file
   already carries, so the boundary is not something this tool invented. */
const END = '/* ================ state and shared helpers ================ */';

/* The page has two scripts: the theme flash-guard in the head, then the page
   itself. The parse layer is at the top of the second one. */
function parseSource(html) {
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)];
  if (scripts.length < 2) {
    throw new Error(`index.html: expected two <script> blocks, found ${scripts.length}`);
  }
  const body = scripts[scripts.length - 1][1];
  const end = body.indexOf(END);
  if (end < 0) throw new Error(`index.html: the "${END}" heading is gone; fix the slice in this file`);
  return body.slice(0, end);
}

/* The names the tests reach for. Anything not listed here stays private to the
   page, which keeps this file from quietly becoming a second public API. */
const EXPORTS = [
  'parseWindowDump',
  'parseSurfaceFlingerDump',
  'parsePackageDump',
  'parseAnrDump',
  'parseCarServiceDump',
  'parseUserDump',
  'parseOverlayDump',
  'parseBinderCallsStatsDump',
  'parseInputDump',
  'parseInputDevicesDump',
  'parseLogcatDump',
  'parseGeteventCapture',
  // the pieces the parsers are built from, worth testing on their own
  'indentOf',
  'takeBlock',
  'harvest',
  'deriveFrame',
  'shortType',
  'sfFlagNames',
  'gevSigned',
  'gevTracks',
  'anrLock',
  'anrWaitGraph',
  'anrCycles',
  'carHeadName',
  'carPairs',
  'lineFields',
  'blockRuns',
  'blockEntries',
  'carPropNames',
  'userFlagNames',
  'userListUnder',
  'overlayFields',
  'overlayStateLabel',
  'binderCaller',
  'binderCall',
  'binderTxn',
  'binderTime',
  'binderBytes',
  'logEntry',
  'logKeep',
  'logLevel',
  'inputSources',
  'inputWindowName',
  'inputRegion',
  'inputConfigOf',
  'inputViewports',
  'TYPE_INTS',
];

function build() {
  const src = parseSource(readFileSync(PAGE, 'utf8'));
  const returns = `\nreturn { ${EXPORTS.join(', ')} };\n`;
  try {
    return new Function(`"use strict";\n${src}${returns}`)();
  } catch (e) {
    throw new Error(`the parse layer did not evaluate on its own: ${e.message}\n` +
      `Something above "${END}" now depends on a layer below it. Move the ` +
      `helper it reached for up into the parse layer, or stop reaching for it.`);
  }
}

export const parsers = build();
export const {
  parseWindowDump, parseSurfaceFlingerDump, parsePackageDump, parseAnrDump,
  parseCarServiceDump, parseUserDump, parseOverlayDump, parseBinderCallsStatsDump,
  parseInputDump, parseInputDevicesDump, parseLogcatDump, parseGeteventCapture,
  indentOf, takeBlock, harvest, deriveFrame, shortType, sfFlagNames,
  gevSigned, gevTracks,
  anrLock, anrWaitGraph, anrCycles,
  carHeadName, carPairs, lineFields, blockRuns, blockEntries, carPropNames,
  userFlagNames, userListUnder, overlayFields, overlayStateLabel,
  binderCaller, binderCall, binderTxn, binderTime, binderBytes,
  inputSources, inputWindowName, inputRegion, inputConfigOf, inputViewports,
  logEntry, logKeep, logLevel,
  TYPE_INTS,
} = parsers;
