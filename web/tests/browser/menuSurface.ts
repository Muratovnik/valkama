/**
 * The harness page for the menu primitive (`VMenu`): a control before it, the menu with an
 * action, a setting and a choice of three, and a line that says what was chosen last.
 */
import { defineComponent, h, ref } from 'vue'

import type { MenuEntry } from '@/shared/ui/menuEntries.ts'
import TooltipHost from '@/shared/ui/TooltipHost.vue'
import VMenu from '@/shared/ui/VMenu.vue'

export const MenuSurface = defineComponent({
  setup() {
    const said = ref('')
    const pinned = ref(false)
    const grouping = ref('none')
    const entries = (): MenuEntry[] => [
      {
        kind: 'action',
        key: 'copy',
        label: 'Copy link',
        icon: 'link',
        select: () => {
          said.value = 'copy'
        },
      },
      {
        kind: 'toggle',
        key: 'pin',
        label: 'Pin to Work',
        icon: 'pin',
        checked: pinned.value,
        select: (on) => {
          pinned.value = on
          said.value = `pin ${on}`
        },
      },
      {
        kind: 'choice',
        key: 'group',
        label: 'Group by',
        value: grouping.value,
        options: [
          { value: 'none', label: 'Nothing' },
          { value: 'epic', label: 'Epic' },
          { value: 'state', label: 'State' },
        ],
        select: (value) => {
          grouping.value = value
          said.value = `group ${value}`
        },
      },
    ]
    return () =>
      h('main', { class: 'menu-harness' }, [
        h('button', { class: 'menu-before', type: 'button' }, 'Before'),
        h(VMenu, { label: 'More', entries: entries() }),
        h('output', { class: 'menu-said' }, said.value),
        h(TooltipHost),
      ])
  },
})
