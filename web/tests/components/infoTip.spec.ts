/**
 * Escape on an InfoTip: it closes the tip while the tip is open, and otherwise goes on to the
 * dialog or panel the tip stands in, which closes on it as it would anywhere else.
 */
import { defineComponent, ref } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import InfoTip from '@/shared/ui/InfoTip.vue'

function host() {
  const heard = ref(0)
  const wrapper = mount(
    defineComponent({
      components: { InfoTip },
      setup: () => ({ heard }),
      template:
        '<div class="around" @keydown.esc="heard += 1"><InfoTip label="About this">Why it is so</InfoTip></div>',
    }),
    { attachTo: document.body },
  )
  return { heard, trigger: wrapper.get('.info-tip-trigger'), wrapper }
}

const panel = () => document.querySelector('.info-tip-panel')

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Escape on an InfoTip', () => {
  it('reaches what holds the tip while the tip is closed', async () => {
    const { heard, trigger } = host()
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(heard.value).toBe(1)
  })

  it('closes an open tip, gives focus back to its control and goes no further', async () => {
    const { heard, trigger } = host()
    await trigger.trigger('click')
    expect(panel()).not.toBeNull()
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    expect(heard.value).toBe(0)
    // Closed now, the next Escape is the surrounding surface's.
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(heard.value).toBe(1)
  })
})
