/* Loads Telltale's parse layer and hands it back as plain functions, so the
 * parsers can be run and asserted on without a browser.
 *
 * Nothing is copied or generated: tools/page-files.mjs reads the <script src>
 * list out of index.html, this takes the files before js/state.js, and
 * evaluates them. Those files are the part of the page that touches no DOM and
 * no state — text in, scene out — so they run as-is under node. If a parser
 * ever reaches forward into a later layer, the source stops evaluating and the
 * tests fail with the name it reached for, which is the point: the boundary
 * the page's own load order claims is the boundary that is checked.
 *
 * Telltale has no build step. This is a test-time tool, the same way
 * tools/flag-docs.py is a maintenance one.
 */

import { parseSource } from './page-files.mjs';

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
  'parseSystemPropertiesDump',
  'parseEventLogDump',
  'parseDisplayManagerDump',
  'parseActivityDump',
  'parseActivityServicesDump',
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
  'overlayConstraints',
  'binderCaller',
  'binderCall',
  'binderTxn',
  'binderTime',
  'binderBytes',
  'dmRect',
  'dmField',
  'dmSize',
  'dmBlocks',
  'dmCutoutBounds',
  'actField',
  'actBounds',
  'actTaskHead',
  'svcConnection',
  'svcClient',
  'svcPid',
  'svcFgsTypes',
  'dmDegrees',
  'eventSplit',
  'eventFields',
  'configChanges',
  'shortComponent',
  'EVENT_TAGS',
  'propNamespace',
  'propSectionOf',
  'propReadOnly',
  'propFlag',
  'logEntry',
  'logKeep',
  'logLevel',
  'inputSources',
  'inputWindowName',
  'inputRegion',
  'inputConfigOf',
  'inputViewports',
  'TYPE_INTS',
  'diaRect',
  'diaRectField',
  'diaRectFields',
];

function build() {
  const src = parseSource();
  const returns = `\nreturn { ${EXPORTS.join(', ')} };\n`;
  try {
    return new Function(`"use strict";\n${src}${returns}`)();
  } catch (e) {
    throw new Error(`the parse layer did not evaluate on its own: ${e.message}\n` +
      `Something in js/parse now depends on a layer after it. Move the ` +
      `helper it reached for into js/parse, or stop reaching for it.`);
  }
}

export const parsers = build();
export const {
  parseWindowDump, parseSurfaceFlingerDump, parsePackageDump, parseAnrDump,
  parseCarServiceDump, parseUserDump, parseOverlayDump, parseBinderCallsStatsDump,
  parseInputDump, parseInputDevicesDump, parseLogcatDump, parseGeteventCapture,
  parseSystemPropertiesDump, parseEventLogDump, parseDisplayManagerDump,
  parseActivityDump, actField, actBounds, actTaskHead,
  parseActivityServicesDump, svcConnection, svcClient, svcPid, svcFgsTypes,
  indentOf, takeBlock, harvest, deriveFrame, shortType, sfFlagNames,
  gevSigned, gevTracks,
  anrLock, anrWaitGraph, anrCycles,
  carHeadName, carPairs, lineFields, blockRuns, blockEntries, carPropNames,
  userFlagNames, userListUnder, overlayFields, overlayStateLabel, overlayConstraints,
  binderCaller, binderCall, binderTxn, binderTime, binderBytes,
  inputSources, inputWindowName, inputRegion, inputConfigOf, inputViewports,
  logEntry, logKeep, logLevel,
  propNamespace, propSectionOf, propReadOnly, propFlag,
  eventSplit, eventFields, configChanges, shortComponent, EVENT_TAGS,
  dmRect, dmField, dmSize, dmBlocks, dmCutoutBounds, dmDegrees,
  diaRect, diaRectField, diaRectFields,
  TYPE_INTS,
} = parsers;
