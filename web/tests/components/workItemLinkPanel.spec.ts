import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WorkItemLinkPanel from '@/features/work-item-link/WorkItemLinkPanel.vue'

import { messages } from '@/shared/i18n/index.ts'

import { finderResponse, finderTarget } from '../support/globalFinder.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

const SPACE = finderTarget().space_ref
const PROJECT = finderTarget().project_id

function serve(...answers: { body: unknown; status?: number }[]) {
  const fetchMock = vi.fn<typeof fetch>()
  for (const { status = 200, body } of answers)
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function nothingFound(query: string, status = 'searched', reason: string | null = null) {
  return {
    interface_version: 'valkama-planning-search',
    query,
    limit: 50,
    has_more: false,
    items: [],
    coverage: [{ project_id: PROJECT, space_ref: SPACE, status, reason }],
  }
}

async function mountPanel(text: string, locale = 'en') {
  const wrapper = mount(WorkItemLinkPanel, {
    props: { text },
    global: { plugins: [createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })] },
  })
  await flushPromises()
  return wrapper
}

function button(wrapper: Awaited<ReturnType<typeof mountPanel>>, name: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === name)
  if (!found) throw new Error(`no button named ${name}: ${wrapper.text()}`)
  return found
}

describe('the page behind a work item address that led nowhere', () => {
  it('is the page main region, and says which number is missing and where', async () => {
    serve({ body: nothingFound('TASK-999') })
    const wrapper = await mountPanel('task-999')
    expect(wrapper.element.tagName).toBe('MAIN')
    expect(wrapper.text()).toContain('There is no task TASK-999')
    expect(wrapper.text()).toContain('Space TASK has no task with that number')
    expect(wrapper.find('[data-tone="danger"]').exists()).toBe(false)

    await button(wrapper, 'Open space TASK').trigger('click')
    expect(wrapper.emitted('go')?.[0]?.[0]).toMatchObject({
      module_id: 'planning',
      scope: { project_ref: { project_id: PROJECT } },
      entity: { kind: 'planning-space' },
    })
    await button(wrapper, 'Find a task').trigger('click')
    expect(wrapper.emitted('find')).toHaveLength(1)
    await button(wrapper, 'Go to Work').trigger('click')
    expect(wrapper.emitted('home')).toHaveLength(1)
  })

  it('says a space is not here, with no space to go to', async () => {
    serve({ body: nothingFound('NOPE-1') })
    const wrapper = await mountPanel('NOPE-1')
    expect(wrapper.text()).toContain('There is no space NOPE')
    expect(wrapper.text()).toContain('NOPE-1 cannot be opened here')
    expect(wrapper.text()).not.toContain('Open space')
    button(wrapper, 'Find a task')
  })

  it('repeats a malformed address as inert text, and only so much of it', async () => {
    const fetchMock = serve()
    const wrapper = await mountPanel(`<img src=x onerror=alert(1)>${'x'.repeat(200)}`)
    expect(wrapper.text()).toContain('This link does not name a task')
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.text()).not.toContain('x'.repeat(100))
    expect(wrapper.find('img').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says what a task link looks like when the address stops before the number', async () => {
    serve()
    const wrapper = await mountPanel('')
    expect(wrapper.text()).toContain('The address stops before the number')
  })

  it('offers another try when a store could not answer, and that try can succeed', async () => {
    serve(
      { body: nothingFound('TASK-7', 'unavailable', 'store_unreadable') },
      { body: finderResponse('TASK-7') },
    )
    const wrapper = await mountPanel('TASK-7')
    expect(wrapper.text()).toContain('Space TASK cannot be read right now')
    expect(wrapper.find('[data-tone="danger"]').exists()).toBe(true)
    await button(wrapper, 'Retry').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('found')?.[0]?.[0]).toMatchObject({
      entity: { kind: 'work-item' },
    })
  })

  it('says it could not check when the search itself fails', async () => {
    serve({ status: 500, body: { error: { code: 'request_failed', message: 'x' } } })
    const wrapper = await mountPanel('TASK-7')
    expect(wrapper.text()).toContain('Valkama could not check this link')
    button(wrapper, 'Retry')
  })

  it('speaks Russian on a Russian interface', async () => {
    serve({ body: nothingFound('TASK-999') })
    const wrapper = await mountPanel('TASK-999', 'ru')
    expect(wrapper.text()).toContain('Задачи TASK-999 нет')
    button(wrapper, 'Открыть пространство TASK')
  })
})
