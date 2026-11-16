import { defineComponent, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import { requestListView } from '@/features/input-requests/utils/requestListView.ts'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import { messages } from '@/shared/i18n/index.ts'
import { provideSpaceNames } from '@/shared/lib/spaceNames.ts'

import { requestEntry, requestList, unavailableSource } from '../support/inputRequests.ts'
import { residentView } from '../support/residentView.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  fetchInputRequests: vi.fn(),
}))

const STORE = requestEntry().target.space_ref.data_scope_id

/** The list the app loads: the question's space and one unread space are both in it. */
const SPACES = [
  { data_scope_id: STORE, space_key: 'TASK', name: 'Requests space' },
  { data_scope_id: STORE, space_key: 'AWAY', name: 'Detached space' },
]

const wrappers: ReturnType<typeof mount>[] = []

/** Mounts the hub under a root that provides the space list, as the app does. */
function hub(locale: 'en' | 'ru') {
  const Root = defineComponent({
    components: { InputRequestsHub },
    setup() {
      provideSpaceNames(ref(SPACES))
    },
    template: '<InputRequestsHub :open="true" />',
  })
  const wrapper = mount(Root, {
    attachTo: document.body,
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
      stubs: { teleport: true },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

residentView(requestListView)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchInputRequests).mockResolvedValue({
    ...requestList([requestEntry()]),
    coverage: [
      unavailableSource('AWAY', 'store_not_attached'),
      unavailableSource('GONE', 'store_not_attached'),
    ],
  })
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

// A question and an unread source are named by the space the app lists them under,
// as the finder names them. A space the list does not hold is named by its key.
describe('space names in the questions dialog', () => {
  it('names the space of a question and of an unread source by its name, in both languages', async () => {
    const en = hub('en')
    await flushPromises()
    expect(en.get('.request-context').text()).toBe('Requests space · TASK-7')
    const enNotes = en.findAll('.request-note').map((note) => note.text())
    expect(enNotes).toContain('Detached space: Store not attached')
    expect(enNotes).toContain('GONE: Store not attached')

    const ru = hub('ru')
    await flushPromises()
    expect(ru.get('.request-context').text()).toBe('Requests space · TASK-7')
    const ruNotes = ru.findAll('.request-note').map((note) => note.text())
    expect(ruNotes).toContain('Detached space: Хранилище не подключено')
    expect(ruNotes).toContain('GONE: Хранилище не подключено')
  })
})
