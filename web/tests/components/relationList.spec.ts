import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RelationList from '@/widgets/work-item-inspector/components/RelationList.vue'

import type { PlatformRelation } from '@/shared/api/platformRelations.ts'
import { messages } from '@/shared/i18n/index.ts'

const states = ['resolved', 'unavailable', 'missing', 'ambiguous', 'malformed'] as const

function relation(state: (typeof states)[number]): PlatformRelation {
  return {
    interface_version: 'valkama-relations',
    relation_id: `relation-${state}`,
    source: { kind: 'work-item', resource_id: 'MAIN-264' },
    kind: 'adapter-resource',
    target: {
      connection_ref: {
        service_ref: { owner_id: 'workspace', service_id: 'notes' },
        adapter_lineage_id: 'lineage-notes',
        connection_id: 'primary',
      },
      resource_type: 'note',
      external_id: `N-${state}`,
    },
    provider: {
      service_ref: { owner_id: 'workspace', service_id: 'notes' },
      adapter_id: 'notes-adapter',
      adapter_lineage_id: 'lineage-notes',
      adapter_version: '1.0.0',
      connection_id: 'primary',
    },
    state,
    provenance: { source_kind: 'adapter', observed_at: '2026-08-13T09:00:00Z' },
    presentation: { label: `${state} relation` },
    actions: [],
  }
}

function relationList(locale: 'en' | 'ru') {
  return mount(RelationList, {
    props: { busy: false, registry: null, relations: states.map((state) => relation(state)) },
    global: {
      plugins: [createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })],
      stubs: { VIcon: true },
    },
  })
}

describe('RelationList', () => {
  it.each([
    ['en', ['Resolved', 'Unavailable', 'Missing', 'Ambiguous', 'Malformed']],
    ['ru', ['Разрешена', 'Недоступна', 'Не найдена', 'Неоднозначна', 'Некорректна']],
  ] as const)(
    'renders every relation state through the shared semantic owner in %s',
    (locale, labels) => {
      const rendered = relationList(locale).findAll('[data-dimension="relation-state"]')

      expect(rendered.map((state) => state.attributes('data-state'))).toEqual(states)
      expect(rendered.map((state) => state.text())).toEqual(labels)
    },
  )
})
