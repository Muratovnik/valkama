import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanUiSources } from '../scripts/ui-system/styles.mjs'

const DISCLOSURE = /a disclosure belongs to VDisclosure/

/** What the guard says about one file, keeping only the disclosure rule's findings. */
const disclosureFindings = (file: string, source: string) =>
  scanUiSources([{ file, source }]).filter((message) => DISCLOSURE.test(message))

test("a screen that writes the browser's disclosure or Reka's own is told where it belongs", () => {
  const bypasses: [string, string][] = [
    [
      'pages/future/Raw.vue',
      '<template><details><summary>More</summary><p /></details></template>',
    ],
    ['widgets/future/Summary.vue', '<template><div><SUMMARY>More</SUMMARY></div></template>'],
    [
      'features/future/Reka.vue',
      `<script setup lang="ts">
        import { CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
      </script>
      <template><CollapsibleRoot><CollapsibleTrigger /></CollapsibleRoot></template>`,
    ],
  ]
  for (const [file, source] of bypasses)
    assert.equal(disclosureFindings(file, source).length, 1, file)
})

test('the primitive, a commented-out disclosure and the word summary leave the rule quiet', () => {
  const quiet: [string, string][] = [
    [
      'shared/ui/VDisclosure.vue',
      `<script setup lang="ts">
        import { CollapsibleRoot } from 'reka-ui'
      </script>
      <template><CollapsibleRoot /></template>`,
    ],
    [
      'pages/future/Note.vue',
      '<template><!-- not a <details> here --><p>{{ item.summary }}</p></template>',
    ],
    ['shared/lib/future.ts', `export const html = '<details>'`],
  ]
  for (const [file, source] of quiet) assert.deepEqual(disclosureFindings(file, source), [], file)
})
