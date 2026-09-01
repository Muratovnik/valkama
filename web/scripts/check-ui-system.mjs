/**
 * The UI-system guard: run every rule over the tree and report what it found.
 *
 * The rules themselves live in `ui-system/`, one file per family. This is the
 * entry point the gate calls and the tree walk they all share.
 */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { scanScopeEscapes } from './ui-system/boundaries.mjs'
import { scanImportCycles, scanImportDirection } from './ui-system/imports.mjs'
import {
  CONTROL_SIZE_BUDGET,
  LINE_BUDGET,
  scanBorderBudget,
  scanControlSizes,
  scanHiddenRules,
} from './ui-system/lines.mjs'
import { scanSemanticStateOwnership } from './ui-system/semantic-states.mjs'
import { collectVueSources, defaultSourceRoot } from './ui-system/sources.mjs'
import { scanTokenHygiene, scanTypeStyles, scanUiSources } from './ui-system/styles.mjs'

export function scanUiTree(root = defaultSourceRoot) {
  const sources = collectVueSources(root)

  // The ledger describes the product tree. Any other root — a test fixture
  // tree reusing real file names — owes zero lines, so a fixture that draws
  // one is still caught without inheriting the product's entries.
  const product = root === defaultSourceRoot
  const budget = product ? LINE_BUDGET : new Map()
  const sizes = product ? CONTROL_SIZE_BUDGET : new Map()
  return [
    ...scanUiSources(sources),
    ...scanSemanticStateOwnership(sources),
    ...scanTokenHygiene(sources),
    ...scanTypeStyles(sources),
    ...scanBorderBudget(sources, budget),
    ...scanHiddenRules(sources),
    ...scanControlSizes(sources, sizes),
    ...scanScopeEscapes(sources),
    ...scanImportDirection(sources),
    ...scanImportCycles(sources),
  ]
}

function run() {
  const violations = scanUiTree()
  if (violations.length) {
    console.error(violations.join('\n'))
    process.exitCode = 1
    return
  }
  console.log('UI system guard passed')
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entry === import.meta.url) run()
