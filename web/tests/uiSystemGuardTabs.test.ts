import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanUiSources } from '../scripts/ui-system/styles.mjs'

const TABS = /belong to SegmentedControl and TabPanel/

/** What the guard says about one file, keeping only the tab rule's findings. */
const tabFindings = (file: string, source: string) =>
  scanUiSources([{ file, source }]).filter((message) => TABS.test(message))

test('a tab role handed over in a bound object is a tab role all the same', () => {
  const bypasses: [string, string][] = [
    ['future/Inline.vue', `<template><button v-bind="{ role: 'tab' }">One</button></template>`],
    [
      'future/Bag.vue',
      `<script setup lang="ts">
        const attrs = { 'role': "tablist", 'aria-label': 'Sections' }
      </script>
      <template><div v-bind="attrs" /></template>`,
    ],
    [
      'future/Chosen.vue',
      `<script setup lang="ts">
        const kind = open ? \`tabpanel\` : 'region'
      </script>
      <template><section :role="kind" /></template>`,
    ],
    // A composable is a .ts file, and its object reaches a template through v-bind.
    ['future/useSections.ts', `export const tabAttrs = () => ({ role: 'tab', tabindex: -1 })`],
  ]
  for (const [file, source] of bypasses) assert.equal(tabFindings(file, source).length, 1, file)
})

test('words that only resemble a tab role leave the tab rule quiet', () => {
  const quiet: [string, string][] = [
    [
      'future/Keys.vue',
      `<script setup lang="ts">
        // A role: 'tab' here would be the shared row's; this file only walks keys.
        const walk = (event: KeyboardEvent) => event.key === 'Tab'
      </script>
      <template><span class="count" @keydown="walk">1</span></template>
      <style scoped>.count { font-variant-numeric: tabular-nums; }</style>`,
    ],
    ['future/keys.ts', `/* role: 'tablist' belongs elsewhere */ export const TAB = 'Tab'`],
  ]
  for (const [file, source] of quiet) assert.deepEqual(tabFindings(file, source), [], file)
  for (const owner of ['shared/ui/SegmentedControl.vue', 'shared/ui/TabPanel.vue'])
    assert.deepEqual(
      tabFindings(owner, `<template><div v-bind="{ role: 'tab' }" /></template>`),
      [],
    )
})
