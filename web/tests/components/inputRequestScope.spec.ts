/**
 * The questions window narrowed to one scope. The oracle is the window's contract in DESIGN.md
 * («Questions waiting for an answer» and «Volumes»): opened from a place narrowed to a space, or
 * to a project of it, the window lists the questions on what the space's board holds, narrowed
 * to the project when the place was, read narrowed by the server, and says so; a chip names the
 * space and the project, and removing it brings every space's questions back. The rail's count
 * stays every space's.
 */
import { defineComponent, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import { requestListView } from '@/features/input-requests/utils/requestListView.ts'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import type { QuestionScope } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
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
const TASK: QuestionScope = { space: { data_scope_id: STORE, space_key: 'TASK' }, project: null }
const ALPHA: QuestionScope = { ...TASK, project: 'alpha' }

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
function hub(locale: 'en' | 'ru', scope: QuestionScope | null) {
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
  // The server's own narrowing: a scope's read brings what its board holds, here one card.
  vi.mocked(fetchInputRequests).mockImplementation(async (options = {}) =>
    requestList(options.scope ? [HERE] : [HERE, elsewhere()]),
  )
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('the questions window narrowed to a space', () => {
  it('lists the space’s board’s questions, read narrowed, names the space and counts every space’s', async () => {
    const { counts } = hub('en', TASK)
    await flushPromises()
    const asked = vi
      .mocked(fetchInputRequests)
      .mock.calls.map(([options]) => options?.scope ?? null)
    expect(asked).toContainEqual(TASK)
    expect(asked).toContainEqual(null)
    expect(shown()).toEqual(['Confirm deployment'])
    expect(chip()?.textContent.trim()).toBe('Requests space')
    expect(chip()?.getAttribute('aria-label')).toBe(
      'Show every space’s questions, not only those of Requests space',
    )
    expect(document.body.textContent).toContain(
      'Pending blocks of questions on the board of Requests space',
    )
    expect(counts.at(-1)).toEqual({ value: 2, incomplete: false })
  })

  it('reads a project’s questions narrowed to it and names the project beside the space', async () => {
    const { counts } = hub('en', ALPHA)
    await flushPromises()
    const asked = vi.mocked(fetchInputRequests).mock.calls.map(([options]) => options?.scope)
    expect(asked).toContainEqual(ALPHA)
    expect(shown()).toEqual(['Confirm deployment'])
    expect(chip()?.textContent.trim()).toBe('Requests space · alpha')
    expect(document.body.textContent).toContain(
      'Pending blocks of questions on the board of Requests space, project alpha',
    )
    // The rail's count is every space's, whatever the window is narrowed to.
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
    const asked = vi.mocked(fetchInputRequests).mock.calls.map(([options]) => options?.scope)
    expect(asked.every((scope) => scope === undefined)).toBe(true)
  })

  it('says the narrowing in Russian', async () => {
    hub('ru', ALPHA)
    await flushPromises()
    expect(chip()?.getAttribute('aria-label')).toBe(
      'Показать вопросы всех пространств, а не только Requests space · alpha',
    )
    expect(document.body.textContent).toContain(
      'Открытые блоки вопросов на доске пространства Requests space, проект alpha',
    )
  })
})
