import { defineComponent, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import { messages } from '@/shared/i18n/index.ts'
import { provideProjectTitles } from '@/shared/lib/projectTitles.ts'

import { requestEntry, requestList, unavailableSource } from '../support/inputRequests.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  fetchInputRequests: vi.fn(),
}))

/** The list the app loads: the question's project and one unread source are both in it. */
const PROJECTS = [
  { project_id: 'requests-project', title: 'Requests title' },
  { project_id: 'detached-project', title: 'Detached title' },
]

const wrappers: ReturnType<typeof mount>[] = []

/** Mounts the hub under a root that provides the project list, as the app does. */
function hub(locale: 'en' | 'ru') {
  const Root = defineComponent({
    components: { InputRequestsHub },
    setup() {
      provideProjectTitles(ref(PROJECTS))
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

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchInputRequests).mockResolvedValue({
    ...requestList([requestEntry()]),
    coverage: [
      unavailableSource('detached-project', 'store_not_attached'),
      unavailableSource('unlisted-project', 'store_not_attached'),
    ],
  })
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

// The questions dialog printed the id of each project ("requests-project · TASK-7"),
// which the finder had already replaced with its title. A project the list does
// not hold still shows its id.
describe('project names in the questions dialog', () => {
  it('names the project of a question and of an unread source by its title, in both languages', async () => {
    const en = hub('en')
    await flushPromises()
    expect(en.get('.request-context').text()).toBe('Requests title · TASK-7')
    const enNotes = en.findAll('.request-note').map((note) => note.text())
    expect(enNotes).toContain('Detached title · TASK: Store not attached')
    expect(enNotes).toContain('unlisted-project · TASK: Store not attached')

    const ru = hub('ru')
    await flushPromises()
    expect(ru.get('.request-context').text()).toBe('Requests title · TASK-7')
    const ruNotes = ru.findAll('.request-note').map((note) => note.text())
    expect(ruNotes).toContain('Detached title · TASK: Хранилище не подключено')
    expect(ruNotes).toContain('unlisted-project · TASK: Хранилище не подключено')
  })
})
