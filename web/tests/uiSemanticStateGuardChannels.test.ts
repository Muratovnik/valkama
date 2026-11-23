import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanSemanticStateOwnership } from '../scripts/ui-system/semantic-states.mjs'

const component = (source: string) => [{ file: 'future/StatusChannels.vue', source }]

test('bare attribute bags and their spreads cannot hide dynamic inline paint', () => {
  const direct = `
    <script setup lang="ts">
      const attrs = {
        style: { color: blocked ? 'var(--color-danger)' : 'var(--color-success)' },
      }
    </script>
    <template><span v-bind="attrs">State</span></template>
  `
  assert.equal(scanSemanticStateOwnership(component(direct)).length, 1)

  const spread = `
    <script setup lang="ts">
      const attrs = {
        style: { color: blocked ? 'var(--color-danger)' : 'var(--color-success)' },
      }
    </script>
    <template><span v-bind="{ ...attrs }">State</span></template>
  `
  assert.equal(scanSemanticStateOwnership(component(spread)).length, 1)
})

test('possible style targets are inspected while proven attribute bags remain valid', () => {
  const possibleStyle = `
    <script setup lang="ts">
      const target = asStyle ? 'style' : 'title'
      const paint = {
        backgroundColor: blocked ? 'var(--color-danger)' : 'var(--color-success)',
      }
    </script>
    <template><span v-bind:[target]="paint">State</span></template>
  `
  assert.equal(scanSemanticStateOwnership(component(possibleStyle)).length, 1)

  const safeBags = `
    <script setup lang="ts">
      import { computed } from 'vue'
      function currentState(active: boolean) {
        return { 'class': { active }, 'aria-current': active ? 'page' : undefined }
      }
      const labelling = computed(() => ({ role: 'img', 'aria-label': label }))
    </script>
    <template>
      <button v-bind="currentState(active)">Current</button>
      <span v-bind="labelling">Labelled</span>
    </template>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(safeBags)), [])
})

test('Vue camel-case paint keys normalize to their CSS property identity', () => {
  for (const property of ['backgroundColor', 'borderInlineStartColor', 'outlineColor']) {
    const source = `
      <template>
        <span :style="{ ${property}: blocked ? 'var(--color-danger)' : 'var(--color-success)' }">
          State
        </span>
      </template>
    `
    assert.equal(scanSemanticStateOwnership(component(source)).length, 1, property)
  }

  const geometry = `
    <template><span :style="{ borderRadius: radius, outlineOffset: offset }">Panel</span></template>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(geometry)), [])
})

test('stylesheet v-bind cannot author paint directly or through a custom property', () => {
  const direct = `
    <template><span class="state">State</span></template>
    <style scoped>.state { color: v-bind(tone); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(direct)).length, 1)

  const chained = `
    <template><span class="state">State</span></template>
    <style scoped>
      .state {
        --local-tone: v-bind(tone);
        color: var(--local-tone);
      }
    </style>
  `
  assert.equal(scanSemanticStateOwnership(component(chained)).length, 1)

  const escapedProperty = `
    <template><span class="state">State</span></template>
    <style scoped>.state { c\\6flor: v-bind(tone); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(escapedProperty)).length, 1)

  const escapedFunction = `
    <template><span class="state">State</span></template>
    <style scoped>.state { color: v\\2d bind(tone); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(escapedFunction)).length, 1)
})

test('stylesheet v-bind remains available for proven non-paint geometry', () => {
  const source = `
    <template><span class="panel">Panel</span></template>
    <style scoped>
      .panel {
        --column-count: v-bind(columns);
        width: v-bind(width);
        grid-template-columns: repeat(var(--column-count), 1fr);
      }
    </style>
  `

  assert.deepEqual(scanSemanticStateOwnership(component(source)), [])

  const escapedGeometry = `
    <template><span class="panel">Panel</span></template>
    <style scoped>
      .panel {
        --lay\\6fut: v-bind(columns);
        w\\69 dth: v-bind(width);
        grid-template-columns: repeat(var(--lay\\6fut), 1fr);
      }
    </style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(escapedGeometry)), [])
})

test('escaped CSS identifiers cannot conceal semantic paint ownership', () => {
  const statusToken = `
    <template><span :class="{ blocked: item.blocked }">State</span></template>
    <style scoped>.blocked { color: var(--color-\\64 anger); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(statusToken)).length, 1)

  const escapedVarFunction = `
    <template><span :class="{ blocked: item.blocked }">State</span></template>
    <style scoped>.blocked { color: v\\61 r(--color-\\64 anger); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(escapedVarFunction)).length, 1)

  const customPropertyChain = `
    <template><span :class="{ blocked: item.blocked }">State</span></template>
    <style scoped>
      .blocked { --st\\61 tus: var(--color-\\64 anger); }
      .blocked { color: var(--st\\61 tus); }
    </style>
  `
  assert.equal(scanSemanticStateOwnership(component(customPropertyChain)).length, 1)

  const nonStatusToken = `
    <template><span class="copy">Copy</span></template>
    <style scoped>.copy { color: var(--color-text-\\6d uted); }</style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(nonStatusToken)), [])
})

test('class attributes, escaped classes, ids, and arbitrary attributes are selector carriers', () => {
  const sources = [
    `
      <template><span :class="{ blocked: item.blocked }">State</span></template>
      <style scoped>[class~='blocked'] { color: var(--color-danger); }</style>
    `,
    `
      <template><span :class="{ 'blocked:state': item.blocked }">State</span></template>
      <style scoped>.blocked\\:state { color: var(--color-danger); }</style>
    `,
    `
      <template><span :class="{ blocked: item.blocked }">State</span></template>
      <style scoped>.\\62 locked { color: var(--color-danger); }</style>
    `,
    `
      <template><span :class="{ 'state/blocked': item.blocked }">State</span></template>
      <style scoped>.state\\/blocked { color: var(--color-danger); }</style>
    `,
    `
      <template><span :class="{ ошибка: item.blocked }">State</span></template>
      <style scoped>.ошибка { color: var(--color-danger); }</style>
    `,
    `
      <template><span :id="item.status">State</span></template>
      <style scoped>#blocked { color: var(--color-danger); }</style>
    `,
    `
      <template><span :title="item.status">State</span></template>
      <style scoped>[title='blocked'] { color: var(--color-danger); }</style>
    `,
  ]

  for (const source of sources)
    assert.equal(scanSemanticStateOwnership(component(source)).length, 1)
})

test('only an exact canonical data-tone carrier receives the provenance exemption', () => {
  const exact = `
    <script setup lang="ts">
      import { statePresentation } from '@/shared/lib/uiSystem.ts'
    </script>
    <template><span :data-tone="statePresentation('case', state).tone">State</span></template>
    <style scoped>[data\\-tone='dan\\67 er'] { color: var(--color-danger); }</style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(exact)), [])

  const broad = `
    <script setup lang="ts">
      import { statePresentation } from '@/shared/lib/uiSystem.ts'
    </script>
    <template><span :data-tone="statePresentation('case', state).tone">State</span></template>
    <style scoped>[data-tone^='danger'] { color: var(--color-danger); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(broad)).length, 1)
})
