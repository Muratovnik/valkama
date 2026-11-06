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

/** What the guard says about one whole file, keeping only the gradient rule's findings. */
const gradientFindingsIn = (file: string, source: string) =>
  scanUiSources([{ file, source }]).filter((message) => GRADIENT.test(message))

test('a comment changes no verdict, before a mask or naming a gradient', () => {
  const allowed = [
    // Between the block's brace and its mask, a comment hid the declaration from the guard.
    '.strip { /* fade */ mask-image: linear-gradient(black, transparent) }',
    '.strip {\n  /* the start fades */\n  &.more-before {\n    /* only the start */\n    mask-image: linear-gradient(to right, transparent, black var(--space-8));\n  }\n}',
    // A semicolon in a comment inside the value does not end the declaration.
    '.strip { mask-image: /* opaque; then clear */ linear-gradient(black, transparent) }',
    // A comment that names a gradient draws none.
    '/* a linear-gradient(red, blue) would tint it */ .surface { color: var(--color-text) }',
  ]
  for (const css of allowed) assert.deepEqual(gradientFindings(css), [], css)
  assert.deepEqual(
    gradientFindingsIn(
      'widgets/future/Strip.vue',
      '<template>\n  <!-- no radial-gradient( here -->\n  <div />\n</template>',
    ),
    [],
  )
  assert.deepEqual(
    gradientFindingsIn(
      'widgets/future/strip.ts',
      "// a conic-gradient( would tint it\nexport const url = 'https://example.com/a'\n",
    ),
    [],
  )
  const refused = [
    // A comment between a mask and a colour gradient lets the colour through no more than before.
    '.strip { mask-image: none; /* then */ background: linear-gradient(red, blue) }',
    '.strip { /* fade */ background: linear-gradient(red, blue) }',
  ]
  for (const css of refused) assert.equal(gradientFindings(css).length, 1, css)
  // Code after a URL's slashes is still read.
  assert.equal(
    gradientFindingsIn(
      'widgets/future/strip.ts',
      "el.style.background = 'url(https://example.com/a), linear-gradient(red, blue)'\n",
    ).length,
    1,
  )
})
