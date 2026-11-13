import { createI18n } from 'vue-i18n'

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SettingsQuota from '@/pages/settings/components/SettingsQuota.vue'

import { messages } from '@/shared/i18n/index.ts'

type Answer = { body: unknown; status?: number }

function json({ body, status = 200 }: Answer) {
  return new Response(JSON.stringify(body), { status })
}

/** The listener's quota settings route; a test replaces the answer it is about. */
function serve(options: { read?: () => Answer; write?: (body: unknown) => Answer } = {}) {
  const writes: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = input as string
      const method = init?.method ?? 'GET'
      if (url === '/api/security/bootstrap')
        return json({ body: { session_token: 'x'.repeat(64) } })
      if (url === '/api/quota/settings' && method === 'PUT') {
        const body: unknown = JSON.parse(init?.body as string)
        writes.push(body)
        return json(options.write?.(body) ?? { body })
      }
      return url === '/api/quota/settings'
        ? json(options.read?.() ?? { body: { poll: false } })
        : new Response('{}', { status: 404 })
    }),
  )
  return { writes }
}

async function mountQuota(locale = 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  const wrapper = mount(SettingsQuota, { global: { plugins: [i18n] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsQuota', () => {
  it('shows the poll off as the server stores it on a clean install', async () => {
    serve()
    const wrapper = await mountQuota()
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
  })

  // The owner's condition for shipping the source: the warning stands beside the switch.
  it.each([
    ['en', 'The endpoint is undocumented', "Anthropic's terms do not explicitly permit this use"],
    ['ru', 'Эндпоинт не документирован', 'условия Anthropic явно не разрешают такое использование'],
  ])('warns beside the switch that the use is not explicitly permitted (%s)', async (...args) => {
    const [locale, undocumented, terms] = args
    serve()
    const wrapper = await mountQuota(locale)
    const hint = wrapper.get('.settings-row-hint').text()
    expect(hint).toContain(undocumented)
    expect(hint).toContain(terms)
  })

  it('writes the whole record when the switch is turned on', async () => {
    const { writes } = serve()
    const wrapper = await mountQuota()
    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()
    expect(writes).toEqual([{ poll: true }])
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
  })

  it('puts the switch back and says so when the write is refused', async () => {
    serve({ write: () => ({ body: { error: { message: 'refused' } }, status: 500 }) })
    const wrapper = await mountQuota()
    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(wrapper.text()).toContain('Not saved:')
  })

  it('offers a retry when the setting cannot be read, and shows it once it can', async () => {
    let failing = true
    serve({ read: () => (failing ? { body: {}, status: 500 } : { body: { poll: true } }) })
    const wrapper = await mountQuota()
    expect(wrapper.find('[role="switch"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Could not read the quota settings.')
    failing = false
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
  })
})
