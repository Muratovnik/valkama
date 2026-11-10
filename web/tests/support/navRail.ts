/**
 * The rail with its list of work going on now, mounted as the shell mounts it, and the ways
 * its specs read the rows: by the item's reference or the session's name, in drawn order.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'

import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'
import { planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

const SCOPE = '123e4567-e89b-42d3-a456-426614174000'
const planning = {
  icon_key: 'board',
  module_id: 'planning',
  navigation_group: 'work',
  title_key: 'platform.modules.planning',
} as ModuleManifest

function target(place: { key: string; project_id: string | null; reference: string | null }) {
  if (place.project_id === null || place.reference === null) return null
  return planningTargetRoute({
    project_id: place.project_id,
    space_ref: { data_scope_id: SCOPE, space_key: place.key },
    reference: place.reference,
    writable: true,
  })
}

const mounted: { unmount: () => void }[] = []

/** Unmount every rail a spec mounted, so their rows let go of the list's one clock. */
export function unmountRails() {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
}

/** The rail over a frame, in a language, with a card on show if one is named. */
export function rail(frame: LiveFrame | null, locale: 'en' | 'ru' = 'en', shown = null as never) {
  const store = useLiveWorkStore()
  if (frame) store.accept(frame)
  const wrapper = mount(AppNav, {
    attachTo: document.body,
    props: { active: 'planning', modules: [planning], liveTarget: target, liveShown: shown },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale,
          fallbackLocale: 'en',
          messages,
          pluralRules,
          datetimeFormats: {
            en: { day: { month: 'short', day: '2-digit' } },
            ru: { day: { month: 'short', day: '2-digit' } },
          },
        }),
      ],
    },
  })
  mounted.push(wrapper)
  return { store, wrapper }
}

export type Rail = ReturnType<typeof rail>['wrapper']

/** The hint a row shows beside the rail. */
export const hintOf = (row: Element) => tooltipOf(row)?.text

/** The rows of the rail's list, as elements, in the order it draws them. */
const rowsOf = (wrapper: Rail, within = '.nav-work-list') =>
  wrapper.findAll(`${within} .nav-row`).map((each) => each.element as HTMLElement)

/** What each row of the list is: an item's reference, or a session's title. */
export const drawn = (wrapper: Rail, within = '.nav-work-list') =>
  rowsOf(wrapper, within).map(
    (each) =>
      each.querySelector('a.nav-row-link')?.getAttribute('aria-label')?.split(' ')[0] ??
      each.querySelector('.nav-row-title')?.textContent,
  )

/** An item's row by its reference, or a session's row by its title. */
export function row(wrapper: Rail, name: string, within = '.nav-work-list'): HTMLElement {
  const found = rowsOf(wrapper, within).find(
    (each) =>
      each.querySelector('a.nav-row-link')?.getAttribute('aria-label')?.startsWith(`${name} `) ||
      each.querySelector('.nav-row-title')?.textContent === name,
  )
  if (!found) throw new Error(`no row ${name}`)
  return found
}
