import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanSemanticStateOwnership } from '../scripts/ui-system/semantic-states.mjs'

/**
 * An attribute bag a component binds whole may be written beside its template,
 * in a helper module or in a composable. Wherever it is written, a style in it
 * that authors a dynamic paint value is refused, and a bag the guard cannot
 * read is refused as one that might.
 */

const VIEW = 'widgets/list/components/ListView.vue'
const DANGER_OR_SUCCESS = "row.blocked ? 'var(--color-danger)' : 'var(--color-success)'"
const BOUND_STYLE = /a bound style authors a dynamic paint value/u
const SELECTOR_CARRIER = /a dynamic selector carrier authors a local semantic status mark/u

const scan = (files: Record<string, string>) =>
  scanSemanticStateOwnership(Object.entries(files).map(([file, source]) => ({ file, source })))

/** The one violation a scan found, asserted to be the inline-style one. */
function refusedStyle(files: Record<string, string>) {
  const violations = scan(files)
  assert.equal(violations.length, 1, violations.join('\n'))
  assert.match(violations[0] ?? '', BOUND_STYLE)
}

const helperView = (from: string) => `
  <script setup lang="ts">
    import { rowAttrs } from '${from}'
  </script>
  <template><table><tr v-for="row in rows" :key="row.id" v-bind="rowAttrs(row)" /></table></template>
`

const helper = (bag: string) => `
  export function rowAttrs(row: { id: string; index: number; blocked: boolean }) {
    return ${bag}
  }
`

const READER_ONLY =
  "{ 'role': 'row', 'aria-rowindex': row.index, 'data-id': row.id, 'tabindex': -1 }"

test('a bag from a helper module is read in the module, and refused when it paints', () => {
  const module = 'widgets/list/utils/rowAttrs.ts'
  assert.deepEqual(
    scan({ [VIEW]: helperView('@/widgets/list/utils/rowAttrs.ts'), [module]: helper(READER_ONLY) }),
    [],
  )
  refusedStyle({
    [VIEW]: helperView('@/widgets/list/utils/rowAttrs.ts'),
    [module]: helper(`{ role: 'row', style: { color: ${DANGER_OR_SUCCESS} } }`),
  })
  // Through a spread of a second helper, as a row adds its own facts to a tree's.
  refusedStyle({
    [VIEW]: helperView('@/widgets/list/utils/rowAttrs.ts'),
    [module]: `
      import { paintOf } from '@/widgets/list/utils/paint.ts'
      export function rowAttrs(row: { blocked: boolean }) {
        return { role: 'row', ...paintOf(row) }
      }
    `,
    'widgets/list/utils/paint.ts': `
      export const paintOf = (row: { blocked: boolean }) => ({ style: { color: ${DANGER_OR_SUCCESS} } })
    `,
  })
})

const reExported = (bag: string) => ({
  [VIEW]: helperView('@/widgets/list/index.ts'),
  'widgets/list/index.ts': "export { rowAttrs } from '@/widgets/list/utils/rowAttrs.ts'\n",
  'widgets/list/utils/rowAttrs.ts': helper(bag),
})

test('a re-export is followed to the module that writes the bag', () => {
  assert.deepEqual(scan(reExported(READER_ONLY)), [])
  refusedStyle(reExported(`{ style: { backgroundColor: ${DANGER_OR_SUCCESS} } }`))
})

const composable = (rowBag: string, tableBag: string) => `
  import { computed } from 'vue'
  import type { Ref } from 'vue'
  export function useListAttrs(count: Ref<number>) {
    function rowAttrs(row: { id: string; index: number; blocked: boolean }) {
      return ${rowBag}
    }
    const tableAttrs = computed(() => (${tableBag}))
    return { rowAttrs, tableAttrs }
  }
`

const composableView = `
  <script setup lang="ts">
    import { useListAttrs } from '@/widgets/list/composables/useListAttrs.ts'
    const { rowAttrs, tableAttrs } = useListAttrs(count)
  </script>
  <template>
    <table v-bind="tableAttrs"><tr v-for="row in rows" :key="row.id" v-bind="rowAttrs(row)" /></table>
  </template>
`

test("a composable's bags are read in its body: a function and a computed it returns", () => {
  const module = 'widgets/list/composables/useListAttrs.ts'
  const TABLE = "{ 'role': 'treegrid', 'aria-rowcount': count.value }"
  assert.deepEqual(scan({ [VIEW]: composableView, [module]: composable(READER_ONLY, TABLE) }), [])
  refusedStyle({
    [VIEW]: composableView,
    [module]: composable(`{ role: 'row', style: { color: ${DANGER_OR_SUCCESS} } }`, TABLE),
  })
  refusedStyle({
    [VIEW]: composableView,
    [module]: composable(
      READER_ONLY,
      "{ role: 'grid', style: { outlineColor: count.value ? 'var(--color-danger)' : 'var(--color-success)' } }",
    ),
  })
})

test('a bag the guard cannot read is refused', () => {
  const cases: Record<string, Record<string, string>> = {
    'a module outside the tree': { [VIEW]: helperView('@/widgets/list/utils/missing.ts') },
    'a package': { [VIEW]: helperView('some-package') },
    'a relative import, which the layer rules refuse anyway': {
      [VIEW]: helperView('../utils/rowAttrs.ts'),
      'widgets/list/utils/rowAttrs.ts': helper(READER_ONLY),
    },
    'a helper that hands back what it was given': {
      [VIEW]: helperView('@/widgets/list/utils/rowAttrs.ts'),
      'widgets/list/utils/rowAttrs.ts': 'export function rowAttrs(row: object) { return row }\n',
    },
    'a helper whose key is computed at run time': {
      [VIEW]: helperView('@/widgets/list/utils/rowAttrs.ts'),
      'widgets/list/utils/rowAttrs.ts': helper('{ [row.id]: row.index }'),
    },
    'a composable that returns a spread': {
      [VIEW]: composableView,
      'widgets/list/composables/useListAttrs.ts': `
        import { shared } from '@/widgets/list/utils/shared.ts'
        export function useListAttrs() { return { ...shared } }
      `,
      'widgets/list/utils/shared.ts': `export const shared = { rowAttrs: () => ({ role: 'row' }) }\n`,
    },
  }
  for (const [name, files] of Object.entries(cases)) {
    const violations = scan(files)
    assert.equal(violations.length, 1, name)
    assert.match(violations[0] ?? '', BOUND_STYLE, name)
  }
})

const shadowView = (body: string, call: string) => `
  <script setup lang="ts">
    const attrs = { role: 'row' }
    ${body}
  </script>
  <template><span v-bind="${call}">State</span></template>
`

test('a name an inner scope binds again is that inner binding, not the top-level one', () => {
  const paint = `{ style: { color: ${DANGER_OR_SUCCESS} } }`
  // The present control: with nothing in between, the top-level bag is what it returns.
  assert.deepEqual(scan({ [VIEW]: shadowView('function bag() { return attrs }', 'bag()') }), [])
  refusedStyle({
    [VIEW]: shadowView('function bag(attrs: object) { return attrs }', `bag(${paint})`),
  })
  refusedStyle({
    [VIEW]: shadowView(
      `function bag() { const attrs = { style: { color: ${DANGER_OR_SUCCESS} } }; return attrs }`,
      'bag()',
    ),
  })
})

const markedView = (script: string) => `
  <script setup lang="ts">${script}</script>
  <template><span class="state-chip" v-bind="stateAttrs(row)">State</span></template>
  <style scoped>
    .state-chip { color: var(--color-text-muted); &.blocked { color: var(--color-danger); } }
  </style>
`

test('an imported bag is a selector carrier a status mark refuses, as a local one is', () => {
  const helperModule = {
    'widgets/list/utils/stateAttrs.ts':
      'export function stateAttrs(row: { blocked: boolean }) { return { class: { blocked: row.blocked } } }\n',
  }
  for (const script of [
    "import { stateAttrs } from '@/widgets/list/utils/stateAttrs.ts'",
    'function stateAttrs(row: { blocked: boolean }) { return { class: { blocked: row.blocked } } }',
  ]) {
    const violations = scan({ [VIEW]: markedView(script), ...helperModule })
    assert.equal(violations.length, 1, script)
    assert.match(violations[0] ?? '', SELECTOR_CARRIER, script)
  }
  // Without the mark the same imported bag stands.
  assert.deepEqual(
    scan({
      [VIEW]: markedView("import { stateAttrs } from '@/widgets/list/utils/stateAttrs.ts'").replace(
        '&.blocked { color: var(--color-danger); }',
        '',
      ),
      ...helperModule,
    }),
    [],
  )
})
