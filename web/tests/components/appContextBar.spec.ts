import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppContextBar from '@/app/components/AppContextBar.vue'
import { selectableProjectResources } from '@/app/composables/useModuleRouteAuthority.ts'

import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'

const resources = ['planning-space-1', 'planning-space-2'].map((resource_id) => ({
  resource_ref: { kind: 'planning-space' as const, resource_id },
  state: 'mapped' as const,
}))
const scope = {
  kind: 'project' as const,
  project_ref: { project_id: 'project-alpha' },
}
const projects = [
  {
    binding_state: 'mapped' as const,
    project_id: 'project-alpha',
    resources,
    source_hash: 'source-hash',
    title: 'Alpha',
  },
]

function manifest(moduleId: string) {
  const result = OFFLINE_MODULE_FALLBACK.find((item) => item.module_id === moduleId)
  if (!result) throw new Error(`missing ${moduleId} manifest`)
  return result
}

function mountBar(moduleId: string) {
  return mount(AppContextBar, {
    props: {
      activities: [],
      description: 'Description',
      projects,
      resources: selectableProjectResources(manifest(moduleId), resources),
      scope,
      title: 'Title',
    },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'en',
          messages: {
            en: {
              platform: {
                bindings: { mapped: 'Mapped' },
                planning: { empty: 'No resources' },
                scope: { global: 'Global', label: 'Scope' },
              },
              settings: {
                emptyOptions: 'No options',
                noOptions: 'No options',
                searchOptions: 'Search',
              },
            },
          },
        }),
      ],
      stubs: {
        ActivityBell: true,
        ChoiceSelect: { template: '<button class="choice-select-stub" />' },
      },
    },
  })
}

describe('AppContextBar manifest-owned project resources', () => {
  it('shows two mapped planning spaces for Planning and Analytics', () => {
    expect(mountBar('planning').find('.resource-scope').exists()).toBe(true)
    expect(mountBar('analytics').find('.resource-scope').exists()).toBe(true)
  })

  it('hides Planning resources from modules whose manifests do not own them', () => {
    for (const moduleId of ['skills', 'sessions', 'improvements', 'settings'])
      expect(mountBar(moduleId).find('.resource-scope').exists()).toBe(false)
  })
})
