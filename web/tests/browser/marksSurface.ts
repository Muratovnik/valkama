/**
 * The harness page for marks and control states: what the browser has to
 * paint for a colour rule to hold, rendered with the product stylesheet.
 */
import { h } from 'vue'

import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'

/** A switch thrown each way, so a test can compare the two tracks. */
function switches() {
  return h('section', { 'class': 'marks-harness-row', 'data-harness': 'switches' }, [
    h(ToggleSwitch, {
      'label': 'On',
      'modelValue': true,
      'onLabel': 'On',
      'offLabel': 'Off',
      'data-switch': 'on',
    }),
    h(ToggleSwitch, {
      'label': 'Off',
      'modelValue': false,
      'onLabel': 'On',
      'offLabel': 'Off',
      'data-switch': 'off',
    }),
  ])
}

export function marksSurface() {
  return h('main', { class: 'marks-harness' }, [switches()])
}
