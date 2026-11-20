/**
 * The questions window narrowed to one space. The oracle is the window's contract in DESIGN.md
 * («Questions waiting for an answer»): opened from a place narrowed to a space, the window lists
 * that space's own questions, read narrowed by the server, and says so; a chip names the space,
 * and removing it brings every space's questions back. The rail's count stays every space's.
 */
import { defineComponent, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import { requestListView } from '@/features/input-requests/utils/requestListView.ts'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { messages } from '@/shared/i18n/index.ts'
import { provideSpaceNames } from '@/shared/lib/spaceNames.ts'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { residentView } from '../support/residentView.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  fetchInputRequests: vi.fn(),
}))

const HERE = requestEntry()
const STORE = HERE.target.space_ref.data_scope_id
const TASK: PlanningSpaceRef = { data_scope_id: STORE, space_key: 'TASK' }

/** A question waiting on a card of another space. */
function elsewhere(): InputRequestEntry {
  const entry = requestEntry()
  return {
    target: {
      ...entry.target,
      space_ref: { data_scope_id: STORE, space_key: 'AWAY' },
      reference: 'AWAY-3',
    },
    request: {
      ...entry.request,
      request_id: '44444444-4444-4444-8444-444444444444',
      reference: 'AWAY-3',
      title: 'Pick a region',
    },
  }
}

const SPACES = [
  { data_scope_id: STORE, space_key: 'TASK', name: 'Requests space' },
  { data_scope_id: STORE, space_key: 'AWAY', name: 'Far space' },
]

const wrappers: ReturnType<typeof mount>[] = []

/** The window under a root that holds its scope, as the shell does, and clears it on `all`. */
function hub(locale: 'en' | 'ru', scope: PlanningSpaceRef | null) {
  const counts: unknown[] = []
  const Root = defineComponent({
    components: { InputRequestsHub },
    setup() {
      provideSpaceNames(ref(SPACES))
      return { scope: ref(scope), counted: (value: unknown) => counts.push(value) }
    },
    template:
      '<InputRequestsHub :open="true" :scope="scope" @all="scope = null" @count="counted" />',
  })
  const wrapper = mount(Root, {
    attachTo: document.body,
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
      stubs: { teleport: true },
    },
  })
  wrappers.push(wrapper)
  return { wrapper, counts }
}

/** The questions on show, by their titles. */
const TITLES = ['Confirm deployment', 'Pick a region']
const shown = () =>
  [...document.querySelectorAll('[data-request-waiting]')].map((card) =>
    TITLES.find((title) => card.textContent.includes(title)),
  )
const chip = () => document.querySelector<HTMLButtonElement>('[data-part="scope"]')

residentView(requestListView)

beforeEach(() => {
  vi.resetAllMocks()
  // The server's own narrowing: a space's read brings that space's cards only.
  vi.mocked(fetchInputRequests).mockImplementation(async (options = {}) =>
    requestList(options.space ? [HERE] : [HERE, elsewhere()]),
  )
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('the questions window narrowed to a space', () => {
  it('lists the space’s own questions, read narrowed, names the space and counts every space’s', async () => {
    const { counts } = hub('en', TASK)
    await flushPromises()
    const asked = vi
      .mocked(fetchInputRequests)
      .mock.calls.map(([options]) => options?.space ?? null)
    expect(asked).toContainEqual(TASK)
    expect(asked).toContainEqual(null)
    expect(shown()).toEqual(['Confirm deployment'])
    expect(chip()?.textContent.trim()).toBe('Requests space')
    expect(chip()?.getAttribute('aria-label')).toBe(
      'Show every space’s questions, not only those of Requests space',
    )
    expect(document.body.textContent).toContain(
      'Pending blocks of questions on the cards of Requests space',
    )
    expect(counts.at(-1)).toEqual({ value: 2, incomplete: false })
  })

  it('brings every space’s questions back when the chip is removed', async () => {
    hub('en', TASK)
    await flushPromises()
    expect(shown()).toHaveLength(1)
    chip()?.click()
    await flushPromises()
    expect(shown()).toHaveLength(2)
    expect(shown()).toContain('Pick a region')
    expect(chip()).toBeNull()
    expect(document.body.textContent).toContain(
      'Pending blocks of questions across mapped projects',
    )
  })

  it('opened from no space lists every space’s questions with no chip', async () => {
    hub('en', null)
    await flushPromises()
    expect(shown()).toHaveLength(2)
    expect(chip()).toBeNull()
    const asked = vi.mocked(fetchInputRequests).mock.calls.map(([options]) => options?.space)
    expect(asked.every((space) => space === undefined)).toBe(true)
  })

  it('says the narrowing in Russian', async () => {
    hub('ru', TASK)
    await flushPromises()
    expect(chip()?.getAttribute('aria-label')).toBe(
      'Показать вопросы всех пространств, а не только Requests space',
    )
    expect(document.body.textContent).toContain(
      'Открытые блоки вопросов в карточках пространства Requests space',
    )
  })
})
