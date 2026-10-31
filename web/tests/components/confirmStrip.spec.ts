import { defineComponent, ref } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'

// The way the inspector asks: the trigger stays in the document, hidden, while
// the strip stands in its place.
const Asker = defineComponent({
  components: { ConfirmStrip },
  setup() {
    const asking = ref(false)
    const answers = ref<string[]>([])
    return { asking, answers }
  },
  template: `
    <div>
      <button v-show="!asking" class="ask" @click="asking = true">Discard</button>
      <ConfirmStrip
        v-if="asking"
        message="Unsaved changes will be lost."
        confirm-label="Discard"
        cancel-label="Keep editing"
        @confirm="answers.push('confirm'); asking = false"
        @cancel="answers.push('cancel'); asking = false"
      />
    </div>`,
})

async function ask() {
  const wrapper = mount(Asker, { attachTo: document.body })
  const trigger = wrapper.get<HTMLButtonElement>('.ask')
  trigger.element.focus()
  await trigger.trigger('click')
  return { wrapper, trigger: trigger.element }
}

describe('ConfirmStrip', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('takes focus on the way back and returns it to the asker on either answer', async () => {
    const { wrapper, trigger } = await ask()
    const cancel = wrapper.get<HTMLButtonElement>('.confirm-cancel')
    expect(document.activeElement).toBe(cancel.element)

    await cancel.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)
    expect(wrapper.vm.answers).toEqual(['cancel'])
    expect(document.activeElement).toBe(trigger)

    await wrapper.get('.ask').trigger('click')
    await wrapper.get('.confirm-go').trigger('click')
    expect(wrapper.vm.answers).toEqual(['cancel', 'confirm'])
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })
})
