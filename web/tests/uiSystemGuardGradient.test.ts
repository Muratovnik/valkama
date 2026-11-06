import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanUiSources } from '../scripts/ui-system/styles.mjs'

const GRADIENT = /gradients are outside the Project Console visual contract/

/** What the guard says about one style block, keeping only the gradient rule's findings. */
const gradientFindings = (css: string) =>
  scanUiSources([
    { file: 'widgets/future/Strip.vue', source: `<style scoped>${css}</style>` },
  ]).filter((message) => GRADIENT.test(message))

test('a gradient inside a mask image fades an edge and is allowed', () => {
  const masks = [
    '.strip { mask-image: linear-gradient(to left, transparent, black var(--space-8)); }',
    '.strip { -webkit-mask-image: linear-gradient(to right, transparent, black 32px); }',
    `.strip {
      overflow-x: auto;

      &.more-before.more-after {
        mask-image: linear-gradient(
          to right,
          transparent,
          black var(--space-8),
          black calc(100% - var(--space-8)),
          transparent
        );
      }
    }`,
  ]
  for (const css of masks) assert.deepEqual(gradientFindings(css), [], css)
})

test('a gradient anywhere else is still refused, a mask beside it or not', () => {
  const colours = [
    '.surface { background: linear-gradient(red, blue); }',
    '.surface { background-image: radial-gradient(circle, red, blue); }',
    '.surface { border-image: conic-gradient(red, blue) 1; }',
    // Only the mask's image is let through, not the shorthand that sets it with the rest.
    '.strip { mask: linear-gradient(to left, transparent, black); }',
    // A property holding one would carry it to any declaration that reads it.
    '.strip { --fade: linear-gradient(to left, transparent, black); }',
    // A mask's exemption ends at its own declaration.
    '.strip { mask-image: linear-gradient(black, transparent); background: linear-gradient(red, blue); }',
    '.strip { mask-image: none } .surface { background: linear-gradient(red, blue) }',
  ]
  for (const css of colours) assert.equal(gradientFindings(css).length, 1, css)
})
