/**
 * What each group of the settings says at its head: its heading's words, and every word its head
 * holds. `SettingsGroup` stands no paragraph under the heading, so the two are the same words;
 * read from the text, a note the head gains is found under whatever element or class it takes.
 */
import type { VueWrapper } from '@vue/test-utils'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'

export const groupHeads = (wrapper: VueWrapper) =>
  wrapper.findAllComponents(SettingsGroup).map((group) => ({
    heading: group.get('h2').text(),
    said: group.get('header').text(),
  }))
