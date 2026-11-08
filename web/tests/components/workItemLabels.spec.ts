/**
 * An item's labels where they can be changed: the «+» that opens a field over the space's
 * labels, what choosing one asks for, and the way back with nothing attached.
 */
import { h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { provideSpaceLabels } from '@/features/work-item-labels/spaceLabels.ts'
import WorkItemLabels from '@/features/work-item-labels/WorkItemLabels.vue'

import { messages } from '@/shared/i18n/index.ts'

const show = vi.fn()
/** The field, which says what it was given and opens when the labels ask it to. */
const fieldStub = {
  name: 'SearchCombobox',
  props: {
    createLabel: { type: Function, default: undefined },
    hideLabel: Boolean,
    label: { type: String, default: '' },
    modelValue: { type: Array, default: () => [] },
    options: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  expose: ['show'],
  methods: { show },
  template: '<input class="field-stub" />',
}

/** One label per item: `web` is on three, `phase-1` on two, `platform` and `docs` on one each. */
const SPACE = ['web', 'web', 'web', 'platform', 'phase-1', 'phase-1', 'docs']
const spaceItems = () => SPACE.map((label) => ({ labels: [label] }))

/** The labels under a page that knows the space's, which it offers the most used first. */
function labels(attached: string[]) {
  const asked: string[][] = []
  const record = (next: string[]) => asked.push(next)
  const render = () => h(WorkItemLabels, { labels: attached, writable: true, onLabels: record })
  const host = {
    setup() {
      provideSpaceLabels(spaceItems)
      return render
    },
  }
  const wrapper = mount(host, {
    attachTo: document.body,
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { SearchCombobox: fieldStub },
    },
  })
  return { wrapper, asked }
}

const plus = (wrapper: ReturnType<typeof mount>) => wrapper.find('button[aria-label="Add a label"]')

describe('attaching a label', () => {
  it('opens a field over the space’s labels it does not carry, and asks for the one chosen', async () => {
    const { wrapper, asked } = labels(['platform'])
    await plus(wrapper).trigger('click')
    await flushPromises()
    expect(show).toHaveBeenCalled()
    const field = wrapper.getComponent(fieldStub)
    expect(field.props('label')).toBe('Add a label')
    expect(field.props('hideLabel')).toBe(true)
    expect(field.props('options')).toEqual([
      { value: 'web', label: 'web' },
      { value: 'phase-1', label: 'phase-1' },
      { value: 'docs', label: 'docs' },
    ])
    expect(field.props('createLabel')('new')).toBe('Add “new”')

    field.vm.$emit('update:modelValue', ['docs'])
    await flushPromises()
    expect(asked).toEqual([['platform', 'docs']])
    expect(wrapper.findComponent(fieldStub).exists()).toBe(false)
    expect(document.activeElement).toBe(plus(wrapper).element)
    wrapper.unmount()
  })

  it('gives the «+» back with nothing attached on Escape', async () => {
    const { wrapper, asked } = labels([])
    await plus(wrapper).trigger('click')
    await flushPromises()
    await wrapper.get('.item-labels-field').trigger('keydown', { key: 'Escape' })
    await nextTick()
    await flushPromises()
    expect(wrapper.findComponent(fieldStub).exists()).toBe(false)
    expect(asked).toEqual([])
    expect(document.activeElement).toBe(plus(wrapper).element)
    wrapper.unmount()
  })

  it('offers no «+» once the item carries as many labels as it may', () => {
    const full = Array.from({ length: 32 }, (_, index) => `label-${index}`)
    const { wrapper } = labels(full)
    expect(plus(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })
})
