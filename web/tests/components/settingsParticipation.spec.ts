import { createI18n } from 'vue-i18n'

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SettingsParticipation from '@/pages/settings/components/SettingsParticipation.vue'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

import readModel from '../fixtures/server/planning-read-model.json'
import { participationDouble } from '../support/participationDouble.ts'
import type { ParticipationDoubleState, Write } from '../support/participationDouble.ts'

type Answer = { body: unknown; status: number }
type Double = ReturnType<typeof participationDouble>
/** `failReads`: how many participation reads fail before one is answered. */
type ServeOptions = { failReads?: number; hold?: boolean; launch?: () => Answer }

const SPACE = { data_scope_id: '00000000-0000-4000-8000-000000000001', space_key: 'MAIN' }
const REFUSED = (message: string): Answer => ({
  status: 400,
  body: { error: { code: 'invalid', message } },
})

function json({ body, status }: Answer) {
  return new Response(JSON.stringify(body), { status })
}

/**
 * The server: participation from the double, the space's read from the server's own answer,
 * and its settings write answering with the space's record. With `hold` a participation write
 * waits until the test releases it, with the double's answer or another.
 */
function serve(double: Double, options: ServeOptions = {}) {
  let failedReads = 0
  const held: { release: (answer?: Answer) => void }[] = []
  const launches: unknown[] = []
  /** Every participation write, as it was sent. */
  const writes: Write[] = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input as string, 'http://valkama.test')
    const method = init?.method ?? 'GET'
    if (url.pathname === '/api/security/bootstrap')
      return json({ status: 200, body: { session_token: 'x'.repeat(64) } })
    const body = method === 'POST' ? (JSON.parse(init?.body as string) as Write) : null
    if (url.pathname === '/api/planning/participation' && body !== null) {
      writes.push(body)
      if (!options.hold) return json(double.write(body))
      return new Promise<Response>((resolve) => {
        held.push({ release: (given) => resolve(json(given ?? double.write(body))) })
      })
    }
    if (url.pathname === '/api/planning/participation') {
      if (failedReads < (options.failReads ?? 0)) {
        failedReads += 1
        return json({ status: 503, body: { error: { code: 'unavailable', message: 'busy' } } })
      }
      return json({ status: 200, body: double.read(url.searchParams.get('space')) })
    }
    if (url.pathname === '/api/planning/space/settings' && body !== null) {
      launches.push(body)
      const record = { ...readModel.planning_space, workflow: readModel.workflow }
      const answer = options.launch?.() ?? {
        status: 200,
        body: { ...record, launch_place: body.launch_place },
      }
      return json(answer)
    }
    return url.pathname === '/api/planning'
      ? json({ status: 200, body: readModel })
      : new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { held, launches, writes }
}

function mountTab(
  state: ParticipationDoubleState,
  space: typeof SPACE | null = SPACE,
  options: ServeOptions = {},
) {
  const double = participationDouble(state)
  const served = serve(double, options)
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages,
    pluralRules,
  })
  const wrapper = mount(SettingsParticipation, {
    props: { space },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  return { double, wrapper, ...served }
}

const row = (wrapper: VueWrapper, key: string) => wrapper.get(`[data-participation-row="${key}"]`)
const checked = (wrapper: VueWrapper, key: string) =>
  row(wrapper, key)
    .findAll('[role="radio"][aria-checked="true"]')
    .map((radio) => radio.text())
const radio = (wrapper: VueWrapper, key: string, name: string) => {
  const found = row(wrapper, key)
    .findAll('[role="radio"]')
    .find((candidate) => candidate.text() === name)
  if (found === undefined) throw new Error(`${key} has no «${name}»`)
  return found
}
const ownSwitch = (wrapper: VueWrapper, key: string) =>
  row(wrapper, key).get('[role="switch"][aria-label^="Own value"]')
const POINT_KEYS = [
  'finding',
  'proposed_goal',
  'task_in_goal',
  'decision',
  'cancel_outside',
  'cancel_shared',
  'condition',
  'goal_close',
  'goal_defer',
]

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Participation tab', () => {
  it('says a failed read with no rows, and shows the rows once a retry reads them', async () => {
    const { wrapper } = mountTab({}, null, { failReads: 1 })
    await flushPromises()

    expect(wrapper.text()).toContain('Could not read the participation settings.')
    expect(wrapper.find('[data-participation-row]').exists()).toBe(false)

    await wrapper.get('.platform-state-retry').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Could not read the participation settings.')
    expect(checked(wrapper, 'finding')).toEqual(['Person'])
  })

  it('with all spaces in the context bar shows the shared values, the default set and no launch place', async () => {
    const { wrapper } = mountTab({}, null)
    await flushPromises()

    expect(wrapper.findAll('[role="radiogroup"][aria-label="Scope"] [role="radio"]')).toHaveLength(
      1,
    )
    expect(checked(wrapper, 'set')).toEqual(['Default'])
    expect(checked(wrapper, 'finding')).toEqual(['Person'])
    expect(checked(wrapper, 'task_in_goal')).toEqual(['Agent'])
    expect(wrapper.find('[data-participation-row="launch"]').exists()).toBe(false)
  })

  it('choosing a set shows every row with the value the set gives it, and writes the set', async () => {
    const { wrapper, writes } = mountTab({}, null, { hold: true })
    await flushPromises()

    await radio(wrapper, 'set', 'Minimal').trigger('click')
    // Before the answer: every point is the set's at once.
    for (const key of POINT_KEYS) expect(checked(wrapper, key)).toEqual(['Agent'])
    expect(row(wrapper, 'queue').get('[role="switch"]').attributes('aria-checked')).toBe('true')
    await flushPromises()
    expect(writes).toEqual([{ space: null, set: 'minimal' }])

    await radio(wrapper, 'set', 'Manual work').trigger('click')
    for (const key of POINT_KEYS) expect(checked(wrapper, key)).toEqual(['Person'])
    expect(row(wrapper, 'queue').get('[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(checked(wrapper, 'set')).toEqual(['Manual work'])
  })

  it('says a set no row group matches as a custom set, with no set chosen', async () => {
    const { wrapper } = mountTab({ own: { '': { finding: 'agent' } } }, null)
    await flushPromises()

    expect(checked(wrapper, 'set')).toEqual([])
    expect(row(wrapper, 'set').text()).toContain('Custom set: differs in 1 row')
  })

  it('in a space says of each row whether it inherits the shared value or holds its own', async () => {
    const { wrapper } = mountTab({ own: { MAIN: { goal_close: 'human' } } })
    await flushPromises()

    expect(ownSwitch(wrapper, 'finding').attributes('aria-checked')).toBe('false')
    expect(row(wrapper, 'finding').text()).toContain('Shared: Person')
    expect(row(wrapper, 'finding').find('[role="radiogroup"]').exists()).toBe(false)

    expect(ownSwitch(wrapper, 'goal_close').attributes('aria-checked')).toBe('true')
    expect(row(wrapper, 'goal_close').text()).toContain('Shared: Agent')
    expect(checked(wrapper, 'goal_close')).toEqual(['Person'])
    expect(row(wrapper, 'goal_close').get('.settings-row-label').text()).toBe('Closing a goal own')
  })

  it('overrides a row for the space and returns it to inheritance, each in one write', async () => {
    const { double, wrapper, writes } = mountTab({})
    await flushPromises()

    await ownSwitch(wrapper, 'finding').trigger('click')
    await flushPromises()
    expect(checked(wrapper, 'finding')).toEqual(['Person'])
    await radio(wrapper, 'finding', 'Agent').trigger('click')
    await flushPromises()
    expect(checked(wrapper, 'finding')).toEqual(['Agent'])
    expect(row(wrapper, 'finding').text()).toContain('The agent decides')

    await ownSwitch(wrapper, 'finding').trigger('click')
    await flushPromises()
    expect(row(wrapper, 'finding').text()).toContain('Shared: Person')
    expect(writes).toEqual([
      { space: 'MAIN', key: 'finding', value: 'human' },
      { space: 'MAIN', key: 'finding', value: 'agent' },
      { space: 'MAIN', key: 'finding', value: null },
    ])
    expect(double.read('MAIN').values.find((value) => value.key === 'finding')?.own).toBe(false)
  })

  it('takes a refused change back with the reason under its row, and keeps another row’s change', async () => {
    const { wrapper, held, writes } = mountTab({}, null, { hold: true })
    await flushPromises()

    await radio(wrapper, 'decision', 'Agent').trigger('click')
    await radio(wrapper, 'condition', 'Agent').trigger('click')
    expect(checked(wrapper, 'decision')).toEqual(['Agent'])
    expect(checked(wrapper, 'condition')).toEqual(['Agent'])

    held[0]?.release(REFUSED('the listener is busy'))
    await flushPromises()
    // The second change waited beside the first rather than replacing it, and goes now.
    held[1]?.release()
    await flushPromises()

    expect(checked(wrapper, 'decision')).toEqual(['Person'])
    expect(row(wrapper, 'decision').get('[role="alert"]').text()).toBe(
      'Not saved: the listener is busy',
    )
    expect(checked(wrapper, 'condition')).toEqual(['Agent'])
    expect(row(wrapper, 'condition').find('[role="alert"]').exists()).toBe(false)
    expect(writes.map((write) => write.key)).toEqual(['decision', 'condition'])
  })

  it('writes a number when its field is left or Enter is pressed, and only within its bounds', async () => {
    const { wrapper, writes } = mountTab({}, null)
    await flushPromises()

    const field = row(wrapper, 'lease_quiet_days').get('input')
    await field.setValue('0')
    await field.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(writes).toEqual([])
    expect((field.element as HTMLInputElement).value).toBe('3')

    await field.setValue('5')
    await field.trigger('focusout')
    await flushPromises()
    expect(writes).toEqual([{ space: null, key: 'lease_quiet_days', value: 5 }])
    expect(row(wrapper, 'lease_quiet_days').text()).toContain('silent 5 days')
  })
})

describe('label rules', () => {
  const FLOW = { labels: { '': { flow: { ready: true, description: 'The main line of work' } } } }

  it('reads a label’s rule and changes it in the shared scope', async () => {
    const { wrapper, writes } = mountTab(FLOW, null)
    await flushPromises()

    const flow = wrapper.get('[data-participation-label="flow"]')
    expect(flow.text()).toContain('The main line of work')
    await flow.get('[role="switch"]').trigger('click')
    await flushPromises()
    expect(writes).toEqual([
      { space: null, label: 'flow', ready: false, description: 'The main line of work' },
    ])
    expect(flow.get('[role="switch"]').attributes('aria-checked')).toBe('false')
  })

  it('removes a shared rule with the answer, and keeps a refused one with the reason under it', async () => {
    const DOCS = { docs: { ready: null, description: 'Documents' } }
    const rules = { labels: { '': { ...FLOW.labels[''], ...DOCS } } }
    const { wrapper, held, writes } = mountTab(rules, null, { hold: true })
    await flushPromises()
    const ruleRow = (label: string) => wrapper.find(`[data-participation-label="${label}"]`)
    const removeOf = (label: string) =>
      ruleRow(label).get(`button[aria-label="Remove the rule of ${label}"]`)

    const flowRemove = removeOf('flow')
    ;(flowRemove.element as HTMLElement).focus()
    await flowRemove.trigger('click')
    await flushPromises()
    expect(writes).toEqual([{ space: null, label: 'flow', ready: null, description: null }])
    // Until the answer the row stands as it was.
    expect(ruleRow('flow').exists()).toBe(true)
    held[0]?.release()
    await flushPromises()
    expect(ruleRow('flow').exists()).toBe(false)
    // The focus left with the row and goes to the one field that adds a rule.
    expect(wrapper.findAll('input[role="combobox"]')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('input[role="combobox"]').element)

    await removeOf('docs').trigger('click')
    held[1]?.release(REFUSED('the store is busy'))
    await flushPromises()
    expect(ruleRow('docs').text()).toContain('Documents')
    expect(ruleRow('docs').get('[role="alert"]').text()).toBe('Not saved: the store is busy')
  })

  it('in a space inherits the shared rule until it holds its own, and gives it back', async () => {
    const { wrapper, writes } = mountTab(FLOW)
    await flushPromises()

    const flow = () => wrapper.get('[data-participation-label="flow"]')
    expect(flow().text()).toContain('Shared: Ready at once')
    // A space gives a rule back through «Own value»; «Remove rule» is the shared scope's.
    expect(flow().find('button[aria-label^="Remove the rule"]').exists()).toBe(false)
    await flow().get('[role="switch"][aria-label^="Own value"]').trigger('click')
    await flushPromises()
    await flow().get('[role="switch"][aria-label^="Ready at once"]').trigger('click')
    await flushPromises()
    await flow().get('[role="switch"][aria-label^="Own value"]').trigger('click')
    await flushPromises()

    // Owning the answer leaves the description to the shared rule: it is written null.
    expect(writes).toEqual([
      { space: 'MAIN', label: 'flow', ready: true, description: null },
      { space: 'MAIN', label: 'flow', ready: false, description: null },
      { space: 'MAIN', label: 'flow', ready: null, description: null },
    ])
    expect(flow().text()).toContain('Shared: Ready at once')
  })

  it('in a space changes «ready» alone and leaves the description inherited', async () => {
    const { double, wrapper, writes } = mountTab({
      labels: { ...FLOW.labels, MAIN: { flow: { ready: true, description: null } } },
    })
    await flushPromises()

    const flow = () => wrapper.get('[data-participation-label="flow"]')
    await flow().get('[role="switch"][aria-label^="Ready at once"]').trigger('click')
    await flushPromises()

    expect(writes).toEqual([{ space: 'MAIN', label: 'flow', ready: false, description: null }])
    // After the answer the space holds the answer and still reads the shared description.
    expect(
      flow().get('[role="switch"][aria-label^="Ready at once"]').attributes('aria-checked'),
    ).toBe('false')
    expect((flow().get('input').element as HTMLInputElement).value).toBe('The main line of work')
    const read = double.read('MAIN').labels.find((rule) => rule.label === 'flow')
    expect(read?.own).toEqual({ ready: true, description: false })

    // A description of the space's own is written with the answer the space already holds.
    await flow().get('input').setValue('Ours')
    await flow().get('input').trigger('focusout')
    await flushPromises()
    expect(writes.at(-1)).toEqual({
      space: 'MAIN',
      label: 'flow',
      ready: false,
      description: 'Ours',
    })
  })

  it('in a space changes the description alone and leaves «ready» inherited', async () => {
    const { wrapper, writes } = mountTab({
      labels: { ...FLOW.labels, MAIN: { flow: { ready: null, description: 'Ours' } } },
    })
    await flushPromises()

    const flow = () => wrapper.get('[data-participation-label="flow"]')
    await flow().get('input').setValue('Ours, and more')
    await flow().get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(writes).toEqual([
      { space: 'MAIN', label: 'flow', ready: null, description: 'Ours, and more' },
    ])
    expect(
      flow().get('[role="switch"][aria-label^="Ready at once"]').attributes('aria-checked'),
    ).toBe('true')
  })
})

describe('the launch place', () => {
  it('is the space’s own record: its change writes the space, and its refusal takes back only it', async () => {
    const refusing = { now: false }
    const record = { ...readModel.planning_space, workflow: readModel.workflow }
    const { wrapper, launches } = mountTab({}, SPACE, {
      launch: () =>
        refusing.now
          ? REFUSED('launch_place must be space or item_project')
          : { status: 200, body: { ...record, launch_place: 'item_project' } },
    })
    await flushPromises()

    expect(checked(wrapper, 'launch')).toEqual(['From the space'])
    await radio(wrapper, 'launch', 'From the card’s project').trigger('click')
    await flushPromises()
    expect(launches).toEqual([{ author: 'user', space: 'MAIN', launch_place: 'item_project' }])
    expect(checked(wrapper, 'launch')).toEqual(['From the card’s project'])

    refusing.now = true
    await ownSwitch(wrapper, 'decision').trigger('click')
    await radio(wrapper, 'launch', 'From the space').trigger('click')
    await flushPromises()
    expect(checked(wrapper, 'launch')).toEqual(['From the card’s project'])
    expect(row(wrapper, 'launch').get('[role="alert"]').text()).toContain('launch_place must be')
    // The participation write beside it held.
    expect(ownSwitch(wrapper, 'decision').attributes('aria-checked')).toBe('true')
    expect(checked(wrapper, 'decision')).toEqual(['Person'])
    expect(row(wrapper, 'decision').find('[role="alert"]').exists()).toBe(false)
  })
})
