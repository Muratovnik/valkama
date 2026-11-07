import assert from 'node:assert/strict'

import { test } from 'vitest'

import { uncommented } from '../scripts/ui-system/comments.mjs'
import { scanImportCycles, scanImportDirection } from '../scripts/ui-system/imports.mjs'
import { scanBorderBudget, scanControlSizes } from '../scripts/ui-system/lines.mjs'
import { scanUiSources } from '../scripts/ui-system/styles.mjs'

const LINE = 'border: 1px solid var(--color-rule)'
const none = new Map<string, number>()
const lines = (file: string, source: string) => scanBorderBudget([{ file, source }], none)
const upward = (source: string) =>
  scanImportDirection([
    { file: 'shared/ui/Panel.vue', source: `<script setup lang="ts">\n${source}\n</script>` },
  ])

test('a line in a comment is not drawn, and one beside a comment is', () => {
  for (const source of [
    `<style>/* .a { ${LINE}; } */</style>`,
    `<template><!-- <style>.a { ${LINE}; }</style> --></template>`,
    `<script setup lang="ts">// const css = '.a { ${LINE}; }'</script>`,
  ])
    assert.deepEqual(lines('future/Panel.vue', source), [], source)
  assert.deepEqual(lines('future/panel.css', `/* .a { ${LINE}; } */`), [])
  assert.match(lines('future/panel.css', `.a { /* beside */ ${LINE}; }`).join('\n'), /draws 1/u)
  // The reset a comment used to hide gives a style and a colour, and no width to draw.
  assert.deepEqual(lines('future/reset.css', '* { border: 0 solid var(--color-rule); }'), [])
  // A control height in a comment is no literal either.
  const literal = '<style>/* .a { min-height: 40px; } */</style>'
  assert.deepEqual(scanControlSizes([{ file: 'future/Panel.vue', source: literal }], none), [])
})

test('an import in a comment points nowhere', () => {
  for (const source of [
    "// import Page from '@/pages/planning/PlanningPage.vue'",
    "/* import Page from '@/pages/planning/PlanningPage.vue' */",
    "const ready = true /* from '@/pages/planning/x.ts' */",
  ])
    assert.deepEqual(upward(source), [], source)
  assert.equal(upward("import Page from '@/pages/planning/PlanningPage.vue'").length, 1)
  const cycle = [
    {
      file: 'shared/lib/a.ts',
      source: "// import { b } from '@/shared/lib/b.ts'\nexport const a = 1",
    },
    {
      file: 'shared/lib/b.ts',
      source: "import { a } from '@/shared/lib/a.ts'\nexport const b = a",
    },
  ]
  assert.deepEqual(scanImportCycles(cycle), [])
})

test('a // that is a URL, and comment marks inside words, open no comment', () => {
  const kept = [
    ['future/a.css', '.a { background: url(//x.png); border: 1px solid red; }'],
    ['future/a.css', '.a { content: "//x"; border: 1px solid red; }'],
    ['future/a.css', ".a { content: '/*'; border: 1px solid red; } .b { content: '*/'; }"],
    ['future/A.vue', '<style>.a { background: url(//x.png); border: 1px solid red; }</style>'],
    ['future/A.vue', '<template><a href="//x">x</a></template><style>.a { color: red; }</style>'],
  ] as const
  for (const [file, source] of kept) assert.equal(uncommented(file, source), source, source)
  // Each still draws its line, in a colour the ledger refuses.
  for (const [file, source] of kept.slice(0, 4))
    assert.match(lines(file, source).join('\n'), /got "1px solid red"/u, source)
})

test('a glob in a string opens no comment, and the code after it is read', () => {
  const source = [
    "const globs = ['**/*.vue', 'src/**/']",
    "import Page from '@/pages/planning/PlanningPage.vue'",
    'const half = width / 2 // a division, then a comment',
    'const slash = /\\/\\*/g',
    "const text = `${globs[0]} // ${'/*'} not a comment */`",
  ].join('\n')
  assert.equal(
    uncommented('shared/lib/globs.ts', source),
    source.replace('// a division, then a comment', ' '),
  )
  const found = scanImportDirection([{ file: 'shared/lib/globs.ts', source }])
  assert.deepEqual(found, [
    'shared/lib/globs.ts: shared/ must not import pages/, which is above it',
  ])
})

test('the file rules read past a URL and a glob the same way', () => {
  const weight = scanUiSources([
    { file: 'future/a.css', source: '.a { background: url(//x.png); font-weight: 800; }' },
  ])
  assert.deepEqual(weight, ['future/a.css: font-weight 800 is off the 400/500/600/700 scale'])
  const colour = scanUiSources([
    {
      file: 'shared/lib/tint.ts',
      source: "const a = '**/*.vue'\nconst c = '#fff'\nconst b = 'src/**/'",
    },
  ])
  assert.deepEqual(colour, ['shared/lib/tint.ts: local colors #fff must be semantic tokens'])
  // A comment keeps the lines it spans, so what follows it stands on the line it did.
  const source = '<template>\n<!-- one\ntwo -->\n<p>Text</p>\n</template>\n'
  assert.equal(uncommented('future/A.vue', source).split('\n').length, source.split('\n').length)
})
