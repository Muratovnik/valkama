import { createI18n } from 'vue-i18n'

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SettingsAlerts from '@/pages/settings/components/SettingsAlerts.vue'

import { messages } from '@/shared/i18n/index.ts'
import SelectionControl from '@/shared/ui/SelectionControl.vue'

type Answer = { body: unknown; status?: number }
type Held = { body: unknown; release: (answer?: Answer) => void }

const STORED = {
  enabled: true,
  events: { question: true, review: false, launchFailed: false },
  content: 'title',
  locale: 'en',
}
const WINDOWS_READY = { state: 'enabled', setting: 0, reason: null }
const TRIAL_SHOWN = { ...WINDOWS_READY, shown: true }

function statusOf(shortcut: boolean, windows: unknown = WINDOWS_READY) {
  return { shortcut, windows, helper: true, autostart: 'disabled' }
}

const STATUS_READY = statusOf(true)

function json({ body, status = 200 }: Answer) {
  return new Response(JSON.stringify(body), { status })
}

/** The server this screen talks to; a test replaces the answers it is about. */
function serve(
  options: {
    holdTest?: boolean
    holdWrites?: boolean
    settings?: () => Answer
    status?: () => Answer
    test?: () => Answer
  } = {},
) {
  const writes: unknown[] = []
  const held: Held[] = []
  const calls: string[] = []
  const holdable = (body: unknown, answer: () => Answer) =>
    new Promise<Response>((resolve) => {
      held.push({
        body,
        release: (given) => {
          resolve(json(given ?? answer()))
        },
      })
    })
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = input as string
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    if (url === '/api/security/bootstrap') return json({ body: { session_token: 'x'.repeat(64) } })
    // The listener refuses a write that does not say it is JSON.
    if (method !== 'GET' && new Headers(init?.headers).get('Content-Type') !== 'application/json')
      return json({ body: { error: { code: 'unsupported', message: 'not JSON' } }, status: 415 })
    if (url === '/api/alerts/settings' && method === 'PUT') {
      const body: unknown = JSON.parse(init?.body as string)
      writes.push(body)
      return options.holdWrites ? holdable(body, () => ({ body })) : json({ body })
    }
    if (url === '/api/alerts/settings') return json(options.settings?.() ?? { body: STORED })
    if (url === '/api/alerts/status') return json(options.status?.() ?? { body: STATUS_READY })
    if (url === '/api/alerts/test') {
      const answer = options.test ?? (() => ({ body: TRIAL_SHOWN }))
      return options.holdTest ? holdable(null, answer) : json(answer())
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, held, writes }
}

async function mountAlerts(locale = 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  const wrapper = mount(SettingsAlerts, {
    props: { locale },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsAlerts settings', () => {
  it('writes the whole record with the interface language when one box changes', async () => {
    const { writes } = serve()
    const wrapper = await mountAlerts('ru')

    await wrapper.findAll('input[type="checkbox"]')[1]?.setValue(true)
    await flushPromises()

    expect(writes).toEqual([
      {
        enabled: true,
        events: { question: true, review: true, launchFailed: false },
        content: 'title',
        locale: 'ru',
      },
    ])
  })

  it('clears every box with the master switch and brings the choices back', async () => {
    const { writes } = serve()
    const wrapper = await mountAlerts()
    const boxes = () => wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes().map((box) => box.element.checked)).toEqual([true, false, false])

    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()
    expect(boxes().map((box) => box.element.checked)).toEqual([false, false, false])
    expect(boxes().every((box) => box.element.disabled)).toBe(true)
    expect(writes.at(-1)).toMatchObject({
      enabled: false,
      events: { question: true, review: false },
    })

    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()
    expect(boxes().map((box) => box.element.checked)).toEqual([true, false, false])
    expect(boxes().every((box) => !box.element.disabled)).toBe(true)
  })

  it('puts the old value back when a write fails, and says why beside that row', async () => {
    const { held } = serve({ holdWrites: true })
    const wrapper = await mountAlerts()

    const review = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')[1]
    await review?.setValue(true)
    expect(review?.element.checked).toBe(true)
    await flushPromises()
    held[0]?.release({
      body: { error: { code: 'refused', message: 'the store is read-only' } },
      status: 400,
    })
    await flushPromises()

    expect(review?.element.checked).toBe(false)
    const rows = wrapper.findAll('.settings-row')
    expect(rows[1]?.get('[role="alert"]').text()).toBe('Not saved: the store is read-only')
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
  })

  it('lets a press through during a write and never lands an older record last', async () => {
    const { held, writes } = serve({ holdWrites: true })
    const wrapper = await mountAlerts()
    const boxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')

    await boxes[1]?.setValue(true)
    await flushPromises()
    await boxes[2]?.setValue(true)
    await boxes[0]?.setValue(false)
    await flushPromises()
    // One write is out and nothing overlaps it; the two later presses wait as one record.
    expect(writes).toHaveLength(1)

    held[0]?.release()
    await flushPromises()
    expect(writes).toHaveLength(2)
    expect(writes[1]).toMatchObject({
      events: { question: false, review: true, launchFailed: true },
    })
    held[1]?.release()
    await flushPromises()
    expect(boxes.map((box) => box.element.checked)).toEqual([false, true, true])
  })

  it('does not take a change back for a write a newer one has replaced', async () => {
    const { held } = serve({ holdWrites: true })
    const wrapper = await mountAlerts()
    const boxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')

    await boxes[1]?.setValue(true)
    await flushPromises()
    await boxes[2]?.setValue(true)
    held[0]?.release({ body: {}, status: 500 })
    await flushPromises()
    expect(boxes[1]?.element.checked).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    held[1]?.release()
    await flushPromises()
    expect(boxes.map((box) => box.element.checked)).toEqual([true, true, true])
  })

  it('writes the language when the interface changes it', async () => {
    const { writes } = serve()
    const wrapper = await mountAlerts('en')
    await wrapper.setProps({ locale: 'ru' })
    await flushPromises()
    expect(writes).toEqual([{ ...STORED, locale: 'ru' }])
  })

  it('stores the chosen content and warns where the text of a question will stay', async () => {
    const { writes } = serve()
    const wrapper = await mountAlerts()
    expect(wrapper.text()).not.toContain('Windows notification history')

    wrapper.getComponent(SelectionControl).vm.$emit('update:modelValue', 'prompt')
    await flushPromises()

    expect(writes.at(-1)).toMatchObject({ content: 'prompt' })
    expect(wrapper.text()).toContain('Windows notification history')
  })

  it('offers a retry when the settings cannot be read', async () => {
    let broken = true
    serve({ settings: () => (broken ? { body: {}, status: 500 } : { body: STORED }) })
    const wrapper = await mountAlerts()
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Could not read the notification settings.',
    )
    expect(wrapper.find('[role="switch"]').exists()).toBe(false)

    broken = false
    await wrapper.get('.platform-state-retry').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="switch"]').exists()).toBe(true)
  })
})

describe('SettingsAlerts readiness', () => {
  it('turns a status it cannot read into a failed check, not an empty row', async () => {
    serve({ status: () => ({ body: { shortcut: true } }) })
    const wrapper = await mountAlerts()
    const readiness = wrapper.get('.settings-alerts-readiness')
    expect(readiness.text()).toContain('The check failed')
    expect(readiness.find('[data-state="degraded"]').exists()).toBe(true)
  })

  it('keeps the last answer on screen while it reads again when the window comes back', async () => {
    const answers = [
      {
        body: statusOf(true, { state: 'disabled-for-application', setting: 1, reason: null }),
      },
      { body: STATUS_READY },
    ]
    const { calls } = serve({ status: () => answers.shift() ?? { body: STATUS_READY } })
    const wrapper = await mountAlerts()
    expect(wrapper.get('.settings-alerts-readiness').text()).toContain(
      'Windows turned off Valkama notifications',
    )

    window.dispatchEvent(new Event('focus'))
    expect(wrapper.get('.settings-alerts-readiness').text()).toContain(
      'Windows turned off Valkama notifications',
    )
    await flushPromises()
    expect(wrapper.get('.settings-alerts-readiness').text()).toContain('Ready')
    expect(calls.filter((call) => call === 'GET /api/alerts/status')).toHaveLength(2)
  })

  it('reads again on request, and the button that asked stays for the focus on it', async () => {
    serve({ status: () => ({ body: statusOf(false) }) })
    const wrapper = await mountAlerts()
    expect(wrapper.get('.settings-alerts-readiness').text()).toContain('No Valkama shortcut')
    const again = wrapper.get<HTMLButtonElement>('.settings-alerts-recheck')
    again.element.focus()

    serve()
    await again.trigger('click')
    await flushPromises()

    expect(wrapper.get('.settings-alerts-readiness').text()).toContain('Ready')
    expect(document.activeElement).toBe(again.element)
  })
})

const testButton = (wrapper: Awaited<ReturnType<typeof mountAlerts>>) =>
  wrapper.get<HTMLButtonElement>('.settings-alerts-test')

describe('SettingsAlerts test notification', () => {
  it('blocks a second send while it waits, without letting go of the keyboard focus', async () => {
    const { calls, held } = serve({ holdTest: true })
    const wrapper = await mountAlerts()
    const button = testButton(wrapper)
    button.element.focus()

    await button.trigger('click')
    await flushPromises()
    expect(button.attributes('aria-disabled')).toBe('true')
    expect(button.element.disabled).toBe(false)
    expect(document.activeElement).toBe(button.element)
    expect(button.text()).toBe('Sending…')

    await button.trigger('click')
    await flushPromises()
    expect(calls.filter((call) => call === 'POST /api/alerts/test')).toHaveLength(1)

    held[0]?.release()
    await flushPromises()
    expect(button.attributes('aria-disabled')).toBeUndefined()
    expect(wrapper.get('[role="status"].settings-alerts-detail').text()).toContain('Do Not Disturb')
  })

  it('says why Windows refused, and reads the readiness again', async () => {
    const { calls } = serve({
      test: () => ({
        body: { state: 'disabled-by-group-policy', setting: 3, reason: null, shown: false },
      }),
    })
    const wrapper = await mountAlerts()

    await testButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.get('.settings-alerts-failure').text()).toContain(
      'Notifications are off by policy: A Windows group policy turned them off.',
    )
    expect(wrapper.find('[role="status"].settings-alerts-detail').exists()).toBe(false)
    expect(calls.filter((call) => call === 'GET /api/alerts/status')).toHaveLength(2)
  })

  it('does not call a test sent when its helper did not start', async () => {
    serve({ test: () => ({ body: { ...WINDOWS_READY, shown: false } }) })
    const wrapper = await mountAlerts()

    await testButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="status"].settings-alerts-detail').exists()).toBe(false)
    expect(wrapper.get('.settings-alerts-failure').text()).toContain(
      'The notification did not start.',
    )
  })

  it('names the reason a failed check gave, and the refusal the server gave', async () => {
    const answers: Answer[] = [
      {
        body: {
          state: 'unavailable',
          setting: null,
          reason: 'csc.exe was not found',
          shown: false,
        },
      },
      { body: { error: { code: 'refused', message: 'no desktop session' } }, status: 503 },
    ]
    serve({ test: () => answers.shift() ?? { body: TRIAL_SHOWN } })
    const wrapper = await mountAlerts()

    await testButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('.settings-alerts-failure').text()).toBe(
      'The check failed: csc.exe was not found',
    )
    // A mark beside the words, so the failure is not told from a detail by its colour alone.
    expect(wrapper.get('[role="alert"].settings-alerts-failure').find('svg').exists()).toBe(true)

    await testButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('.settings-alerts-failure').text()).toBe(
      'The check failed: no desktop session',
    )
  })
})
