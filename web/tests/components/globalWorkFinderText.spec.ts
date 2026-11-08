/**
 * The finder opened on text another search hands it: the board filter's last row,
 * «Search for "…" in all projects». The search is for that text at once, and the
 * text then stays as a typed one does.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'

import GlobalWorkFinder from '@/features/global-find/GlobalWorkFinder.vue'

import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { finderResponse } from '../support/globalFinder.ts'

vi.mock('@/shared/api/planningGlobalSearchApi.ts', () => ({
  searchGlobalPlanningWorkItems: vi.fn(),
}))

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

it('opens on the text another search hands it, and keeps it like one typed', async () => {
  vi.useFakeTimers()
  vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(finderResponse('login form'))
  const wrapper = mount(GlobalWorkFinder, {
    props: { open: false },
    attachTo: document.body,
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { teleport: true },
    },
  })
  const field = () => wrapper.get('[role="combobox"]').element as HTMLInputElement

  await wrapper.setProps({ open: true, text: 'login form' })
  await vi.advanceTimersByTimeAsync(251)
  await flushPromises()
  expect(field().value).toBe('login form')
  expect(vi.mocked(searchGlobalPlanningWorkItems).mock.calls.map(([query]) => query)).toEqual([
    'login form',
  ])
  expect(wrapper.findAll('[role="option"]')).not.toHaveLength(0)

  // Changed by hand, then opened again with no text handed over: it is on the search it was left on.
  await wrapper.get('[role="combobox"]').setValue('login')
  await wrapper.setProps({ open: false, text: '' })
  await wrapper.setProps({ open: true })
  expect(field().value).toBe('login')
  wrapper.unmount()
})
