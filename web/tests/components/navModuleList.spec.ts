import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NavModuleList from '@/widgets/app-nav/components/NavModuleList.vue'

import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { messages } from '@/shared/i18n/index.ts'

function manifest(moduleId: string, titleKey: string): ModuleManifest {
  return {
    icon_key: 'work',
    module_id: moduleId,
    navigation_group: 'work',
    title_key: titleKey,
  } as ModuleManifest
}

const planning = manifest('planning', 'platform.modules.planning')
const sessions = manifest('sessions', 'platform.modules.sessions')

function mountList(modules: ModuleManifest[], heading: string) {
  return mount(NavModuleList, {
    props: { active: 'planning', heading, modules },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
    },
  })
}

describe('rail group heading', () => {
  // A group whose one entry is already called by the group's name printed the
  // word twice, one above the other. The heading stays in the document so the
  // group keeps its structure for a reader, and only its line is taken away.
  it('keeps the heading for readers but hides it when its only entry repeats it', () => {
    const list = mountList([planning], 'Work')
    const heading = list.get('h2')
    expect(heading.text()).toBe('Work')
    expect(heading.classes()).toContain('nav-group-heading-echo')
  })

  it('prints the heading over a group of several entries', () => {
    const list = mountList([planning, sessions], 'Work')
    expect(list.get('h2').classes()).not.toContain('nav-group-heading-echo')
  })
})
