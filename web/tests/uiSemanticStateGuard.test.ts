import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanSemanticStateOwnership } from '../scripts/ui-system/semantic-states.mjs'

const component = (source: string) => [{ file: 'future/StatusView.vue', source }]

test('a binding-state class cannot recreate the semantic palette locally', () => {
  const source = `
    <template>
      <span class="binding-chip" :class="[project.binding_state]">Mapped</span>
    </template>
    <style scoped>
      .binding-chip {
        color: var(--color-text-muted);

        &.mapped {
          color: var(--color-success);
        }
      }
    </style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /canonical uiSystem presentation API/)
})

test('a relation-state class cannot own several semantic outcomes', () => {
  const source = `
    <template>
      <span class="relation-state" :class="[relation.state]">Resolved</span>
    </template>
    <style scoped>
      .relation-state {
        &.resolved {
          color: var(--color-success);
        }

        &:is(.unavailable, .malformed) {
          color: var(--color-danger);
        }
      }
    </style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /state-to-tone mapping in uiSystem\.ts/)
})

test('semantic status edges are marks selected by a dynamic class', () => {
  const source = `
    <template><aside class="health-note" :class="[record.condition]">Offline</aside></template>
    <style scoped>
      .health-note.offline { border-inline-start: 3px solid var(--color-danger); }
    </style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /semantic status mark/)
})

test('health and readiness fields cannot bypass selector correlation', () => {
  const source = `
    <template>
      <span class="health" :class="[service.health]">Ready</span>
      <span :class="{ waiting: item.readiness === 'waiting' }">Waiting</span>
    </template>
    <style scoped>
      .health.ready { color: var(--color-success); }
      .waiting::before { background: var(--color-warning); }
    </style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /dynamic selector carrier/)
})

test('a bound data-state selector cannot own a semantic status mark', () => {
  const source = `
    <template><span class="resource" :data-state="resource.phase">Unavailable</span></template>
    <style scoped>
      .resource[data-state=unavailable]::before { fill: var(--color-danger); }
    </style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /semantic status mark/)
})

test('an object class selected by operational state cannot map that class to a semantic colour', () => {
  const source = `
    <template>
      <span class="item-state" :class="{ blocked: item.status === 'blocked' }">Blocked</span>
    </template>
    <style scoped>
      .item-state.blocked { color: var(--color-danger); }
      .item-note { color: var(--color-info); }
    </style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /canonical uiSystem presentation API/)
})

test('a component-local external stylesheet cannot hide a second state-to-colour mapping', () => {
  const sources = [
    {
      file: 'future/ExternalStatus.vue',
      source: `
        <template><span class="item-state" :class="[item.status]">Blocked</span></template>
        <style scoped src="./ExternalStatus.css"></style>
      `,
    },
    {
      file: 'future/ExternalStatus.css',
      source: '.item-state.blocked { color: var(--color-danger); }',
    },
  ]

  const violations = scanSemanticStateOwnership(sources)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /future\/ExternalStatus\.vue/)
})

test('a computed canonical presentation retains data-tone provenance', () => {
  const source = `
    <script setup lang="ts">
      import { computed } from 'vue'
      import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'

      const props = defineProps<{ dimension: string; state: string }>()
      const presentation = computed(() => semanticStatePresentation(props))
    </script>
    <template>
      <span
        class="semantic-state"
        :data-tone="presentation.tone"
        :data-state="state"
      >{{ label }}</span>
    </template>
    <style scoped>
      [data-tone='info'] { color: var(--color-info); }
      [data-tone='success'] { color: var(--color-success); }
      [data-tone='warning'] { color: var(--color-warning); }
      [data-tone='danger'] { color: var(--color-danger); }
    </style>
  `

  assert.deepEqual(scanSemanticStateOwnership(component(source)), [])
})

test('aliased canonical presentation APIs may drive exact data-tone carriers', () => {
  const source = `
    <script setup lang="ts">
      import {
        semanticStatePresentation as presentSemanticState,
        statePresentation as presentState,
      } from '@/shared/lib/uiSystem.ts'
    </script>
    <template>
      <span :data-tone="presentState('case', state).tone">State</span>
      <span :data-tone="presentSemanticState(pair).tone">Semantic state</span>
    </template>
    <style scoped>
      [data-tone='danger'] { color: var(--color-danger); }
      [data-tone='success'] { color: var(--color-success); }
    </style>
  `

  assert.deepEqual(scanSemanticStateOwnership(component(source)), [])
})

test('object-form v-bind cannot hide class or data selector carriers', () => {
  const classCarrier = `
    <template><span v-bind="{ class: item.status }">State</span></template>
    <style scoped>.blocked { color: var(--color-danger); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(classCarrier)).length, 1)

  const dataCarrier = `
    <template><span v-bind="{ 'data-state': item.status }">State</span></template>
    <style scoped>
      [data-state='blocked'] { border-inline-start: 2px solid var(--color-danger); }
    </style>
  `
  assert.equal(scanSemanticStateOwnership(component(dataCarrier)).length, 1)
})

test('dynamic v-bind arguments fail closed for class, data, and static decoys', () => {
  const source = `
    <script setup lang="ts">
      const carrier = asClass ? 'class' : 'data-state'
    </script>
    <template>
      <i class="blocked">Static decoy</i>
      <span v-bind:[carrier]="item.status">Dynamic argument</span>
      <span v-bind="{ [carrier]: item.status }">Computed object key</span>
    </template>
    <style scoped>
      .blocked { color: var(--color-danger); }
      [data-state='blocked'] { outline-color: var(--color-warning); }
    </style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /dynamic selector carrier/)
})

test('finite non-selector v-bind arguments remain valid', () => {
  const source = `
    <template>
      <span v-bind="{ title: item.status, 'aria-label': label }">Named</span>
      <span v-bind:[flag ? 'title' : 'aria-label']="item.status">Named twice</span>
      <i class="fixed-note">Fixed note</i>
    </template>
    <style scoped>.fixed-note { color: var(--color-info); }</style>
  `

  assert.deepEqual(scanSemanticStateOwnership(component(source)), [])
})

test('object and statically resolved dynamic data-tone retain canonical provenance', () => {
  const source = `
    <script setup lang="ts">
      import { statePresentation as presentState } from '@/shared/lib/uiSystem.ts'
      const toneAttribute = 'data-tone'
    </script>
    <template>
      <span v-bind="{ 'data-tone': presentState('case', state).tone }">Object</span>
      <span v-bind:[toneAttribute]="presentState('case', state).tone">Argument</span>
    </template>
    <style scoped>[data-tone='danger'] { color: var(--color-danger); }</style>
  `

  assert.deepEqual(scanSemanticStateOwnership(component(source)), [])
})

test('template lexical bindings cannot spoof a canonical helper import', () => {
  const loop = `
    <script setup lang="ts">
      import { statePresentation as presentState } from '@/shared/lib/uiSystem.ts'
    </script>
    <template>
      <span v-for="presentState in rows" :data-tone="presentState(item).tone">Loop</span>
    </template>
    <style scoped>[data-tone='danger'] { color: var(--color-danger); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(loop)).length, 1)

  const slot = `
    <script setup lang="ts">
      import { semanticStatePresentation as presentState } from '@/shared/lib/uiSystem.ts'
    </script>
    <template>
      <Provider v-slot="{ presentState }">
        <span :data-tone="presentState(item).tone">Slot</span>
      </Provider>
    </template>
    <style scoped>[data-tone='success'] { color: var(--color-success); }</style>
  `
  assert.equal(scanSemanticStateOwnership(component(slot)).length, 1)
})

test('script callback parameters cannot spoof canonical helper provenance', () => {
  const source = `
    <script setup lang="ts">
      import { computed } from 'vue'
      import { statePresentation as presentState } from '@/shared/lib/uiSystem.ts'
      const presentation = computed((presentState) => presentState('case', state))
    </script>
    <template><span :data-tone="presentation.tone">State</span></template>
    <style scoped>[data-tone='danger'] { color: var(--color-danger); }</style>
  `

  assert.equal(scanSemanticStateOwnership(component(source)).length, 1)
})

test('a sibling template scope does not shadow the canonical import globally', () => {
  const source = `
    <script setup lang="ts">
      import { statePresentation as presentState } from '@/shared/lib/uiSystem.ts'
    </script>
    <template>
      <i v-for="presentState in rows">{{ presentState }}</i>
      <span :data-tone="presentState('case', state).tone">State</span>
    </template>
    <style scoped>[data-tone='success'] { color: var(--color-success); }</style>
  `

  assert.deepEqual(scanSemanticStateOwnership(component(source)), [])
})

test('classic script imports are not treated as template presentation bindings', () => {
  const source = `
    <script lang="ts">
      import { statePresentation as presentState } from '@/shared/lib/uiSystem.ts'
    </script>
    <template><span :data-tone="presentState('case', state).tone">State</span></template>
    <style scoped>[data-tone='danger'] { color: var(--color-danger); }</style>
  `

  assert.equal(scanSemanticStateOwnership(component(source)).length, 1)
})

test('bound styles cannot choose paint locally or hide it behind a function', () => {
  const conditional = `
    <template>
      <span :style="{ color: blocked ? 'var(--color-danger)' : 'var(--color-success)' }">
        State
      </span>
    </template>
  `
  assert.equal(scanSemanticStateOwnership(component(conditional)).length, 1)

  const functionReturn = `
    <script setup lang="ts">
      function stateStyle(item: { blocked: boolean }) {
        return { width: '10px', background: item.blocked ? '#f00' : '#0f0' }
      }
    </script>
    <template><span :style="stateStyle(item)">State</span></template>
  `
  assert.equal(scanSemanticStateOwnership(component(functionReturn)).length, 1)
})

test('an opaque bound style fails closed while proven geometry stays valid', () => {
  const opaque = `<template><span :style="externalStyle">State</span></template>`
  assert.equal(scanSemanticStateOwnership(component(opaque)).length, 1)

  const geometry = `
    <script setup lang="ts">
      import { computed } from 'vue'
      const panel = computed(() => ({ width: \`\${width}px\`, left: \`\${left}px\` }))
    </script>
    <template><span :style="[panel, { '--column-count': columns.length }]">Panel</span></template>
    <style scoped>.panel { grid-template-columns: repeat(var(--column-count), 1fr); }</style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(geometry)), [])
})

test('custom-property chains preserve every semantic selector source', () => {
  const source = `
    <template><span :class="{ blocked: item.blocked }">State</span></template>
    <style scoped>
      .scope { --semantic-tone: var(--color-danger); }
      .blocked { --local-tone: var(--semantic-tone); }
      .label { color: var(--local-tone); }
    </style>
  `

  assert.equal(scanSemanticStateOwnership(component(source)).length, 1)
})

test('inline custom properties that feed paint are guarded too', () => {
  const source = `
    <template><span class="label" :style="{ '--local-tone': item.color }">State</span></template>
    <style scoped>.label { color: var(--local-tone); }</style>
  `

  assert.equal(scanSemanticStateOwnership(component(source)).length, 1)
})

test('literal data-tone branches cannot claim canonical presentation provenance', () => {
  const source = `
    <template><span :data-tone="health ? 'success' : 'danger'">Health</span></template>
    <style scoped>
      [data-tone='success'] { color: var(--color-success); }
      [data-tone='danger'] { color: var(--color-danger); }
    </style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /state-to-tone mapping in uiSystem\.ts/)
})

test('a tone-prefixed raw status remains a local state mapping', () => {
  const source = `
    <template><span :class="\`tone-\${item.status}\`">Status</span></template>
    <style scoped>.tone-danger { color: var(--color-danger); }</style>
  `

  const violations = scanSemanticStateOwnership(component(source))
  assert.equal(violations.length, 1)
  assert.match(violations[0], /dynamic selector carrier/)
})

test('SemanticState usage and unrelated dynamic classes remain allowed', () => {
  const semanticStateUsage = `
    <template>
      <SemanticState
        dimension="relation-state"
        :label="stateLabel(relation.state)"
        :state="relation.state"
      />
    </template>
    <style scoped>.relation-copy { color: var(--color-info); }</style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(semanticStateUsage)), [])

  const unrelatedClass = `
    <template><span :class="{ selected: isSelected(entry) }">Selected</span></template>
    <style scoped>.selected { background: var(--color-surface-selected); }</style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(unrelatedClass)), [])

  const unrelatedStateCondition = `
    <template>
      <span :class="{ 'is-terminal': finished }">Done</span>
      <i class="separate-note">Healthy</i>
    </template>
    <style scoped>.separate-note { color: var(--color-success); }</style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(unrelatedStateCondition)), [])
})

test('both halves are required before the guard reports a second state mapping', () => {
  const stateClassWithoutColor = `
    <template><span :class="record.status">Status</span></template>
    <style scoped>.status { color: var(--color-text-muted); }</style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(stateClassWithoutColor)), [])

  const colorWithoutStateClass = `
    <template><span class="ready">Ready</span></template>
    <style scoped>.ready { color: var(--color-success); }</style>
  `
  assert.deepEqual(scanSemanticStateOwnership(component(colorWithoutStateClass)), [])
})
