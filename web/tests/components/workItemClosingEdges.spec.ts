/**
 * The edges of the windows a card closes work in, as the server answers them: work that opened
 * under a goal while its close was being confirmed, a goal's list that could not be read, and a
 * card to wait on that is cancelled.
 *
 * Only `fetch` is a double here, so each refusal reaches the window as the planning client reads
 * the server's envelope, and each write leaves as the server receives it.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CancelGoalDialog from '@/features/work-item-closing/CancelGoalDialog.vue'
import ConfirmCloseDialog from '@/features/work-item-closing/ConfirmCloseDialog.vue'
import DeferDialog from '@/features/work-item-closing/DeferDialog.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'

import cancelRefused from '../fixtures/server/refusal-cancel-list.json'
import { workItemFixture } from '../fixtures/workItem.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from '../support/request.ts'

const dialogStub = {
  props: ['closeLabel', 'error', 'open', 'title'],
  emits: ['submit', 'close'],
  template:
    '<form v-if="open" @submit.prevent="$emit(\'submit\')"><h2>{{ title }}</h2><button class="frame-close" type="button" @click="$emit(\'close\')">{{ closeLabel }}</button><slot/><p role="alert">{{ error }}</p><slot name="footer"/></form>',
}
const mountOf = <T>(component: T, props: Record<string, unknown>) =>
  mount(component as never, {
    props: { open: true, ...props } as never,
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })],
      stubs: { DialogFrame: dialogStub },
    },
  })

type Answer = (body: Record<string, unknown>, url: URL) => Response
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
/** A guard's refusal as the batch route words it: on the step it refused. */
const guard = (message: string) =>
  json({ error: { code: 'workflow_guard', message, step: { group: 'transition', index: 0 } } }, 409)

/** Every request the window makes, answered by its path. */
function serve(answers: Record<string, Answer>) {
  const sent: { body: Record<string, unknown> | null; path: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      withSecurityBootstrap(async (input, init) => {
        const url = new URL(requestUrl(input), 'http://localhost')
        const body = init?.body
          ? (JSON.parse(requestBody(init.body)) as Record<string, unknown>)
          : null
        sent.push({ path: url.pathname, body })
        const answer = answers[url.pathname]
        if (!answer) throw new Error(`unexpected request ${url.pathname}`)
        return answer(body ?? {}, url)
      }),
    ),
  )
  return sent
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const goal = (patch: Partial<WorkItem> = {}): WorkItem => ({
  ...workItemFixture('Release', 1),
  reference: 'QA-1',
  kind: 'goal',
  state: null,
  container_state: 'awaiting_confirmation',
  description: 'Every channel delivers.',
  ...patch,
})
/** The server's refusal of a goal's close while work is open under it, as it words it. */
const CHILDREN_OPEN =
  'transition: [children] QA-1 has 2 open item(s) under it: QA-12, QA-13; close, cancel or move' +
  ' out what is open under it, and it awaits confirmation once nothing is'

describe('a goal confirmed while work opened under it', () => {
  it('says it is at work again with what opened, and its one press lets the card read it', async () => {
    const sent = serve({ '/api/planning/work-item/apply': () => guard(CHILDREN_OPEN) })
    const wrapper = mountOf(ConfirmCloseDialog, { item: goal(), state: 'done' })
    expect(wrapper.find('[data-part="description"]').exists()).toBe(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(sent.map(({ path }) => path)).toEqual(['/api/planning/work-item/apply'])
    expect(wrapper.get('[data-part="reopened"]').text()).toBe(
      'The goal is at work again, work opened under it: QA-12, QA-13. There is nothing to confirm.',
    )
    // Nothing is left to check, and no press offers a write.
    expect(wrapper.find('[data-part="description"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toBe('')
    const presses = wrapper.findAll('button:not(.frame-close)')
    expect(presses.map((press) => press.text())).toEqual(['Close'])
    expect(wrapper.emitted('done')).toBeUndefined()

    await presses[0].trigger('click')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  it('names no work where the refusal names none, and its frame’s close reads the card too', async () => {
    serve({
      '/api/planning/work-item/apply': () =>
        guard('transition: [children] QA-1 has 7 open item(s) under it'),
    })
    const wrapper = mountOf(ConfirmCloseDialog, { item: goal({ kind: 'stage' }), state: 'done' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-part="reopened"]').text()).toBe(
      'The stage is at work again, work opened under it. There is nothing to confirm.',
    )
    expect(wrapper.get('.frame-close').text()).toBe('Close')
    await wrapper.get('.frame-close').trigger('click')
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('keeps the window as it was for a refusal of anything else', async () => {
    serve({
      '/api/planning/work-item/apply': () =>
        guard('transition: [summary] QA-1 has no closing summary; record what was done'),
    })
    const wrapper = mountOf(ConfirmCloseDialog, { item: goal(), state: 'done' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-part="reopened"]').exists()).toBe(false)
    expect(wrapper.find('[data-part="description"]').exists()).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain('has no closing summary')
    await wrapper.get('.frame-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('done')).toBeUndefined()
  })
})

describe("a goal's cancel whose list could not be read", () => {
  it('leaves the press with nothing to send and reads the list again on Retry', async () => {
    let reads = 0
    const sent = serve({
      '/api/planning/work-item/apply': () => {
        reads += 1
        return reads === 1
          ? new Response('', { status: 503 })
          : json(
              {
                error: {
                  code: 'cancel_list',
                  message: 'Cancelling QA-1 closes 1 open item under it.',
                  cancels: [
                    {
                      reference: 'QA-2',
                      title: 'Tray',
                      kind: 'task',
                      state: { key: 'dev', name: 'Dev', category: 'active' },
                      container_state: null,
                      holder: [],
                    },
                  ],
                  dependents: [],
                  list_token: '0123456789abcdef',
                },
              },
              409,
            )
      },
    })
    const wrapper = mountOf(CancelGoalDialog, {
      item: goal({ container_state: 'in_progress' }),
      state: 'dropped',
      given: 'The plan changed',
    })
    await flushPromises()
    // What happened, in the catalogue's words: no status code reaches the owner.
    expect(wrapper.text()).toContain(
      'What closes could not be read. The local service did not complete the request.',
    )
    expect(wrapper.text()).not.toMatch(/HTTP|503/u)
    expect(wrapper.find('[data-reference]').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(sent).toHaveLength(1)

    const retry = wrapper.findAll('button').find((button) => button.text() === 'Retry')
    await retry?.trigger('click')
    await flushPromises()
    expect(sent).toHaveLength(2)
    expect(sent[1].body?.transition).toEqual({ state: 'dropped', reason: 'The plan changed' })
    expect(wrapper.text()).not.toContain('What closes could not be read.')
    expect(
      wrapper.findAll('[data-reference]').map((row) => row.attributes('data-reference')),
    ).toEqual(['QA-2'])
  })

  it('says an answer it cannot read is one this build cannot read, and what to do', async () => {
    serve({
      '/api/planning/work-item/apply': () =>
        json({ error: { code: 'cancel_list', message: 'Cancelling QA-1', cancels: 'all' } }, 409),
    })
    const wrapper = mountOf(CancelGoalDialog, {
      item: goal({ container_state: 'in_progress' }),
      state: 'dropped',
    })
    await flushPromises()
    expect(wrapper.text()).toContain(
      'What closes could not be read. This build cannot read the local service response.' +
        ' Restart or update Valkama, then retry.',
    )
    expect(wrapper.text()).not.toMatch(/HTTP|409/u)
  })

  it('says a cancel the connection lost in the catalogue’s words, under the list', async () => {
    let calls = 0
    serve({
      '/api/planning/work-item/apply': () => {
        calls += 1
        if (calls > 1) throw new TypeError('Failed to fetch')
        return json(cancelRefused, 409)
      },
    })
    const wrapper = mountOf(CancelGoalDialog, {
      item: goal({ reference: 'MAIN-31', container_state: 'in_progress' }),
      state: 'cancelled',
      given: 'The plan changed',
    })
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(calls).toBe(2)
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'The local service did not complete the request.',
    )
    expect(wrapper.findAll('[data-reference]')).toHaveLength(2)
  })
})

describe("a goal's cancel as the real server refuses it", () => {
  it('lists what closes and what waits on it from the refusal of its batch step', async () => {
    // The server's own answer (`tests/test_web_contract_fixtures.py`): the batch names its step.
    serve({
      '/api/planning/work-item/apply': () => json(cancelRefused, 409),
    })
    const wrapper = mountOf(CancelGoalDialog, {
      item: goal({ reference: 'MAIN-31', container_state: 'in_progress' }),
      state: 'cancelled',
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('What closes could not be read.')
    expect(
      wrapper.findAll('[data-reference]').map((row) => row.attributes('data-reference')),
    ).toEqual(['MAIN-32', 'MAIN-33'])
    expect(wrapper.text()).toContain('waits on MAIN-32')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Cancel 1 card')
  })
})

/** The space the card waits in, which the search answers for. */
const SPACE = { data_scope_id: '123e4567-e89b-42d3-a456-426614174000', space_key: 'QA' }
const card = (reference: string, open: boolean) => ({
  target: {
    space_ref: SPACE,
    reference,
    writable: true,
  },
  item: {
    work_item_id: `00000000-0000-4000-8000-0000000002${reference.slice(-2)}`,
    planning_space_id: '00000000-0000-4000-8000-000000000001',
    reference,
    title: `API ${reference}`,
    state: { name: open ? 'Dev' : 'Dropped' },
    open,
    container_state: null,
    claim_ref: '',
  },
})

describe('putting work off until a card that is cancelled', () => {
  it('offers only the open cards, and keeps what was chosen when the server says it closed', async () => {
    vi.useFakeTimers()
    const sent = serve({
      '/api/modules/planning/search': () =>
        json({
          interface_version: 'valkama-planning-search',
          query: 'api',
          limit: 50,
          has_more: false,
          items: [card('QA-41', true), card('QA-42', false)],
          coverage: [],
        }),
      '/api/planning/work-item/defer': () =>
        json(
          {
            error: {
              code: 'invalid_request',
              message: '[deferred] QA-41 is closed already: name an open item, or a day',
            },
          },
          400,
        ),
    })
    const wrapper = mountOf(DeferDialog, {
      item: workItemFixture('Tray', 1),
      scope: { own: 'own', space: SPACE },
    })
    const search = wrapper.getComponent(SearchCombobox)
    // A generic component: its props are read as the field hands them over.
    const field = () => search.props() as unknown as { modelValue: string; options: unknown }
    search.vm.$emit('search', 'api')
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    expect(field().options).toEqual([{ value: 'QA-41', label: 'QA-41 API QA-41' }])

    // Cancelled while the window was open: the server refuses, the choice and the reason stay.
    search.vm.$emit('update:modelValue', 'QA-41')
    await wrapper.get('.defer-reason textarea, .defer-reason input').setValue('Waits on the API')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(sent.at(-1)?.body).toMatchObject({ until: 'QA-41', reason: 'Waits on the API' })
    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      '[deferred] QA-41 is closed already: name an open item, or a day',
    )
    expect(field().modelValue).toBe('QA-41')
    expect(
      (wrapper.get('.defer-reason textarea, .defer-reason input').element as HTMLInputElement)
        .value,
    ).toBe('Waits on the API')
  })
})
