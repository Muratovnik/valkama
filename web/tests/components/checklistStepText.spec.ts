/**
 * A checklist step is free text an agent wrote, so it reads as the markdown it
 * is and a reference in it links as it does in a comment. The step used to be
 * one button with its text inside, which could hold no link at all: a
 * reference in a step was a word to copy by hand.
 */
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'

import { messages } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

const STEP = '00000000-0000-4000-8000-000000000010'

function overview(writable: boolean, open = vi.fn()) {
  const item = workItemFixture('Steps', 1)
  item.checklist = [
    {
      id: STEP,
      text: 'Merge after MAIN-12 lands, then run `npm test`',
      done: false,
      claimed_by: '',
      done_by: '',
    },
  ]
  const render = () => h(InspectorOverview, { item, writable })
  // The card's own layer of reference links, as the inspector provides it.
  const Host = defineComponent({
    setup() {
      provideReferenceLinks((reference, parent) =>
        reference.value === 'MAIN-12' ? { title: 'Open MAIN-12', open } : parent(reference),
      )
      return render
    },
  })
  return mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: {
        InspectorDescription: true,
        InspectorDiscussion: true,
        InspectorSummary: true,
      },
    },
  })
}

describe('a checklist step’s text', () => {
  it('is drawn as markdown, with its references linked, in the list and as the next step', () => {
    const open = vi.fn()
    const wrapper = overview(true, open)
    const text = wrapper.get('.step-row .step-text')
    expect(text.get('code').text()).toBe('npm test')
    const link = text.get('.rich-reference')
    expect(link.text()).toBe('MAIN-12')
    expect(wrapper.findAll('.next-step-text .rich-reference').map((ref) => ref.text())).toEqual([
      'MAIN-12',
    ])
    wrapper.unmount()
  })

  // That a press on the reference does not also tick the step is the
  // browser's label activation, which jsdom does not follow; the browser suite
  // holds it (production-card-head.spec.ts).
  it('labels the step’s box with its text, and a reference in it opens', async () => {
    const open = vi.fn()
    const wrapper = overview(true, open)
    const box = wrapper.get('[role="checkbox"]')
    const label = wrapper.get('.step-row label.step-text')
    // The text is the box's label: its name, and a second place to press it.
    expect(label.attributes('for')).toBe(box.attributes('id'))
    expect(box.attributes('id')).toMatch(/\S/u)
    expect(box.find('.step-text').exists()).toBe(false)

    await label.get('.rich-reference').trigger('click')
    expect(open).toHaveBeenCalledTimes(1)

    await box.trigger('click')
    expect(wrapper.findComponent(InspectorOverview).emitted('tick')?.at(-1)).toEqual([STEP, true])
    wrapper.unmount()
  })

  it('names the discuss button by the step’s words, not its markdown', () => {
    const wrapper = overview(true)
    expect(wrapper.get('.step-discuss').attributes('aria-label')).toBe(
      'Discuss step “Merge after MAIN-12 lands, then run npm test”',
    )
    wrapper.unmount()
  })
})
