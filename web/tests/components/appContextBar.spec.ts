/**
 * The context bar's choice of resource: it is offered only where there is a choice, a project the
 * bar can name with at least two resources its module owns. One resource is no choice, a global
 * scope has none, and a scope not yet named offers nothing beside it.
 */
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
    title: 'Alpha',
  },
]

function manifest(moduleId: string) {
  const result = OFFLINE_MODULE_FALLBACK.find((item) => item.module_id === moduleId)
  if (!result) throw new Error(`missing ${moduleId} manifest`)
  return result
}

type BarProps = InstanceType<typeof AppContextBar>['$props']

function mountBar(moduleId: string, props: Partial<BarProps> = {}) {
  return mount(AppContextBar, {
    props: {
      projects,
      resources: selectableProjectResources(manifest(moduleId), props.resources ?? resources),
      scope,
      title: 'Title',
      ...props,
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
        // A choice says the options it offers, each by its name.
        ChoiceSelect: {
          props: ['options'],
          template: '<ul data-choice><li v-for="one in options">{{ one.label }}</li></ul>',
        },
      },
    },
  })
}

/** The choices the bar offers, each by the names of its options. */
const choices = (bar: ReturnType<typeof mountBar>) =>
  bar.findAll('[data-choice]').map((choice) => choice.findAll('li').map((one) => one.text()))

const SCOPES = ['Global', 'Alpha']

describe('AppContextBar manifest-owned project resources', () => {
  it('offers the two mapped planning spaces of a project for Work', () => {
    expect(choices(mountBar('planning'))).toEqual([
      SCOPES,
      ['planning-space-1', 'planning-space-2'],
    ])
  })

  it('hides Planning resources from modules whose manifests do not own them', () => {
    for (const moduleId of ['memory', 'settings'])
      expect(choices(mountBar(moduleId))).toEqual([SCOPES])
  })

  it('offers no choice of one resource', () => {
    expect(choices(mountBar('planning', { resources: resources.slice(0, 1) }))).toEqual([SCOPES])
  })

  it('offers no resource in the global scope, nor before the projects are read', () => {
    expect(choices(mountBar('planning', { scope: { kind: 'global' } }))).toEqual([SCOPES])
    // Unread, the scope's own selector keeps its place with only «Global» to name.
    expect(choices(mountBar('planning', { projects: null }))).toEqual([['Global']])
  })
})
