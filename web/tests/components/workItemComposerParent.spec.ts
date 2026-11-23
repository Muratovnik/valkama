/**
 * The new-task dialog's parent and its failed write.
 *
 * The parent is chosen from the space's goals and stages at any depth, laid out by the tree's
 * model: a stage five levels down can be chosen, found by its title or by the number of a goal
 * above it. A failed write keeps everything typed and says, in the dialog's own words, that
 * the work was not created and why. The planning client runs for real and only `fetch` is a
 * double, so a refusal reaches the dialog the way the server words it.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WorkItemComposer from '@/features/work-item-compose/WorkItemComposer.vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItem } from '../browser/planningFixtures.ts'
import { present } from '../support/present.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from '../support/request.ts'

const SPACE = '7a1c2f3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'
const CREATE = '/api/planning/work-items'
const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A brief of the space's work, as the board holds it. */
const brief = (n: number, fields: Partial<WorkItemBrief> = {}): WorkItemBrief => ({
  ...workItem,
  comment_count: 0,
  work_item_id: identity(n),
  reference: `MAIN-${n}`,
  number: n,
  title: `Item ${n}`,
  parent_id: null,
  labels: [],
  projects: [],
  other_space: null,
  ...fields,
})

/** An accepted open goal, or a stage inside `parent`. */
const container = (n: number, parent: number | null, title: string) =>
  brief(n, {
    kind: parent === null ? 'goal' : 'stage',
    parent_id: parent === null ? null : identity(parent),
    title,
    state: null,
    container_state: 'in_progress',
  })

/** A goal five levels deep with a task in its deepest stage, a later goal and another space's. */
const DEEP = [
  container(1, null, 'Ship the release'),
  container(2, 1, 'Storage'),
  container(3, 2, 'Migration'),
  container(4, 3, 'Backups'),
  container(5, 4, 'Restore drill'),
  brief(6, { parent_id: identity(5), title: 'Run the drill' }),
  container(9, null, 'Docs'),
  brief(41, {
    kind: 'goal',
    reference: 'ALPHA-41',
    other_space: { key: 'ALPHA', name: 'Alpha' },
    title: 'Their goal',
  }),
]

const mounted: VueWrapper[] = []

function mountComposer(items: readonly WorkItemBrief[], locale = 'en') {
  const wrapper = mount(WorkItemComposer, {
    attachTo: document.body,
    props: { open: true, space: SPACE, items },
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
      stubs: { OverlayHost: { template: '<div><slot /></div>' } },
    },
  })
  mounted.push(wrapper)
  return wrapper
}

/** Answer the create with `answer`, and keep what was sent. */
function serveCreate(answer: () => Promise<Response>) {
  const sent: Record<string, unknown>[] = []
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    withSecurityBootstrap(async (input, init) => {
      const path = new URL(requestUrl(input), 'http://localhost').pathname
      if (path !== CREATE) throw new Error(`unexpected request ${path}`)
      sent.push(JSON.parse(requestBody(init?.body)) as Record<string, unknown>)
      return answer()
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return sent
}

const json = (payload: unknown, status: number) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

/** Each option as its reference and title, and the note under it. */
const options = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => ({
    title: option.querySelector('.combo-title')?.textContent?.trim(),
    note: option.querySelector('.combo-note')?.textContent?.trim() ?? '',
  }))

const parentField = (wrapper: ReturnType<typeof mountComposer>) =>
  present(wrapper.findAll<HTMLInputElement>('input[role="combobox"]')[1], 'the parent field')

async function openParents(wrapper: ReturnType<typeof mountComposer>, typed = '') {
  const field = parentField(wrapper)
  field.element.focus()
  if (typed) await field.setValue(typed)
  else await field.trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  return field
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('WorkItemComposer parent', () => {
  it('offers every goal and stage of the space, each under the one it stands in', async () => {
    const wrapper = mountComposer(DEEP)
    await openParents(wrapper)
    const offered = options()
    expect(offered.map((option) => option.title)).toEqual([
      'No goal',
      'MAIN-9 · Docs',
      'MAIN-1 · Ship the release',
      'MAIN-2 · Storage',
      'MAIN-3 · Migration',
      'MAIN-4 · Backups',
      'MAIN-5 · Restore drill',
    ])
    // A goal says only its state; a stage says the path above it first.
    expect(offered[2]?.note).toBe('In progress')
    expect(offered[6]?.note).toBe('MAIN-1 › MAIN-2 › MAIN-3 › MAIN-4 · In progress')
  })

  it('finds a stage five levels down by a goal above it and sends it as the parent', async () => {
    const sent = serveCreate(async () => json({ error: { code: 'x', message: 'x' } }, 422))
    const wrapper = mountComposer(DEEP)
    await wrapper.get('input').setValue('Rehearse')
    const field = await openParents(wrapper, 'MAIN-4')
    // MAIN-4 itself, and MAIN-5 whose path names it.
    expect(options().map((option) => option.title)).toEqual([
      'MAIN-4 · Backups',
      'MAIN-5 · Restore drill',
    ])
    await field.setValue('drill')
    await flushPromises()
    await field.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(sent).toEqual([expect.objectContaining({ title: 'Rehearse', parent: 'MAIN-5' })])
  })

  it('offers only «Без цели» where the space has no goal or stage', async () => {
    for (const [locale, word] of [
      ['en', 'No goal'],
      ['ru', 'Без цели'],
    ] as const) {
      const wrapper = mountComposer([brief(6), brief(7, { kind: 'bug' })], locale)
      await openParents(wrapper)
      expect(
        options().map((option) => option.title),
        locale,
      ).toEqual([word])
      wrapper.unmount()
      document.body.innerHTML = ''
    }
  })
})

/** Fill every field the dialog asks for, write it, and read what stayed. */
async function failWith(answer: () => Promise<Response>, locale = 'en') {
  serveCreate(answer)
  const wrapper = mountComposer(DEEP, locale)
  await wrapper.get('input').setValue('Rehearse the restore')
  const [labels] = wrapper.findAll<HTMLInputElement>('input[role="combobox"]')
  labels?.element.focus()
  await labels?.setValue('ops')
  await flushPromises()
  await labels?.trigger('keydown', { key: 'Enter' })
  const field = await openParents(wrapper, 'drill')
  await field.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  await wrapper.get('textarea').setValue('Steps in the runbook.')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  return wrapper
}

/** What stayed in the fields after the write failed. */
function kept(wrapper: Awaited<ReturnType<typeof failWith>>) {
  expect(wrapper.emitted('created')).toBeUndefined()
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('Rehearse the restore')
  expect(wrapper.get('textarea').element.value).toBe('Steps in the runbook.')
  expect(wrapper.text()).toContain('ops')
  expect(parentField(wrapper).element.value).toBe('MAIN-5 · Restore drill')
}

describe('WorkItemComposer failed write', () => {
  it('keeps what was typed and gives the server’s reason in the dialog’s words', async () => {
    const reason = 'parent MAIN-5 is closed; choose an open goal or stage'
    const wrapper = await failWith(async () =>
      json({ error: { code: 'invalid_request', message: reason } }, 422),
    )
    kept(wrapper)
    expect(wrapper.get('.dialog-frame-error').text()).toBe(`The work was not created: ${reason}`)
  })

  it('says the server did not answer, never a bare status, when it is away', async () => {
    for (const answer of [
      async () => new Response('', { status: 503 }),
      async () => Promise.reject(new TypeError('Failed to fetch')),
    ]) {
      const wrapper = await failWith(answer)
      kept(wrapper)
      const error = wrapper.get('.dialog-frame-error').text()
      expect(error).toBe(
        'The work was not created: the server did not answer. What you typed is kept; try again.',
      )
      expect(error).not.toMatch(/HTTP|fetch/u)
      wrapper.unmount()
      document.body.innerHTML = ''
      vi.unstubAllGlobals()
    }
  })

  it('says it in Russian', async () => {
    const wrapper = await failWith(async () => new Response('', { status: 503 }), 'ru')
    expect(wrapper.get('.dialog-frame-error').text()).toBe(
      'Работа не создана: сервер не ответил. Введённое сохранено — попробуйте ещё раз.',
    )
  })

  it('clears the reason when the dialog opens again', async () => {
    const wrapper = await failWith(async () => new Response('', { status: 503 }))
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(wrapper.find('.dialog-frame-error').exists()).toBe(false)
  })
})
