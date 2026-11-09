/**
 * The harness page for the window's one hint (`TooltipHost`): a control with a hint of its
 * own, drawn under a control its hint stands over, a control with none inside an element
 * that has one, and two cut words side by side on one line, as a row's name and title stand.
 */
import { h, withDirectives } from 'vue'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import TooltipHost from '@/shared/ui/TooltipHost.vue'

export const hintsSurface = () =>
  h('main', { class: 'hints-harness' }, [
    h('button', { class: 'hints-under', type: 'button' }, 'Under'),
    withDirectives(h('button', { class: 'hints-own', type: 'button' }, 'Own'), [
      [vTooltip, 'A hint of its own', undefined, { detail: true }],
    ]),
    withDirectives(
      h('div', { class: 'hints-holder' }, [
        h('button', { class: 'hints-inner', type: 'button' }, 'Inside'),
      ]),
      [[vTooltip, 'The holder’s hint', undefined, { detail: true }]],
    ),
    h('p', { class: 'hints-row' }, [
      withDirectives(h('span', { class: 'hints-cut hints-name' }, 'A name cut short by its box'), [
        [vTooltip, 'A name cut short by its box', undefined, { clipped: true }],
      ]),
      withDirectives(h('span', { class: 'hints-cut hints-title' }, 'A title cut short beside it'), [
        [vTooltip, 'A title cut short beside it', undefined, { clipped: true }],
      ]),
    ]),
    h(TooltipHost),
  ])
