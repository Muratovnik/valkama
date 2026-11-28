/**
 * How long a file may run, in one place: the ceiling, what the files over it owe, and the
 * single-file components, which are measured block by block.
 *
 * They sit beside `eslint.config.ts` rather than in it for the reason `eslint-restricted-syntax.js`
 * does: the config stood at its own ceiling, so any rule added to it pushed it over.
 */

/** The ceiling: code lines, with comments and blank lines left out. */
const ceiling = { max: 400, skipBlankLines: true, skipComments: true }

/**
 * What each file over the 400-line ceiling owes, pinned at the size it has now.
 *
 * The count excludes comments and blank lines already, so these are code sizes
 * rather than prose. A single-file component owes nothing here: it is measured
 * block by block, by `vue/max-lines-per-block` below.
 *
 * So the rule still holds at 400 everywhere else: a new file over it fails the
 * moment it appears, and nothing here can grow past what it already owes.
 * Removing an entry is the ratchet. Raising a number is not a move.
 */
const LINE_DEBT = {
  'src/shared/i18n/locales/en.ts': 1047,
  'src/shared/i18n/locales/ru.ts': 1046,
  'tests/uiSystemGuard.test.ts': 470,
  'stylelint-order-preset.js': 416,
}

/** The configuration objects, in the order they apply: a later one wins for its files. */
export const lineLimits = [
  { rules: { 'max-lines': ['warn', ceiling] } },
  {
    // A component is measured block by block: `max-lines` counted its style block too, so a
    // component near the limit made room by moving CSS or code out mid-change, not by meaning.
    // The script's limit counts its comments, which this rule does not skip, so it sits above
    // the 400 code lines `max-lines` allowed, and above the largest script today, 431 lines.
    // The style block has none: how long a component's CSS runs says nothing about its split.
    files: ['**/*.vue'],
    rules: {
      'max-lines': 'off',
      'vue/max-lines-per-block': ['warn', { script: 500, template: 400, skipBlankLines: true }],
    },
  },
  ...Object.entries(LINE_DEBT).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['warn', { ...ceiling, max }] },
  })),
]
