import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import ImprovementsView from '@/pages/improvements/components/ImprovementsView.vue'

import { messages } from '@/shared/i18n/index.ts'

import { improvementProfile, improvementsSnapshot } from '../support/improvements.ts'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => (resolve = accept))
  return { promise, resolve }
}

class FakeEventSource {
  readonly listeners = new Map<string, Array<(event: Event) => void>>()
  closed = false

  constructor(readonly url: string) {
    sources.push(this)
  }

  addEventListener(type: string, handler: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  emit(type: string, event: Event) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  message(payload: unknown) {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(payload) }))
  }

  close() {
    this.closed = true
  }
}

const originalFetch = globalThis.fetch
const originalEventSource = globalThis.EventSource
let sources: FakeEventSource[] = []

function answer(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function snapshot(scope: string, model: string) {
  return improvementsSnapshot(scope, {
    profile: improvementProfile(scope, { analyzer_model: model }),
  })
}

function mountView(scope = 'personal') {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  return mount(ImprovementsView, {
    props: { active: true, scope },
    global: { plugins: [i18n] },
  })
}

beforeEach(() => {
  sources = []
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.EventSource = originalEventSource
})

describe('Improvements snapshot state', () => {
  it('distinguishes a cold failure from empty data and retries from the state panel', async () => {
    let request = 0
    globalThis.fetch = async () => {
      request += 1
      return request === 1
        ? answer(
            { interface_version: 'improvements-api', error: { code: 'temporary_failure' } },
            500,
          )
        : answer(snapshot('personal', 'retry-model'))
    }

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.platform-state-panel[data-tone="danger"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Improvement evidence is temporarily unavailable')
    expect(wrapper.text()).not.toContain('No recurring cases detected')

    const retry = wrapper.get('.platform-state-retry')
    await retry.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('retry-model')
    expect(request).toBe(2)
    wrapper.unmount()
  })

  it('keeps the committed same-scope DOM while a retry is pending', async () => {
    const refresh = deferred<Response>()
    let request = 0
    globalThis.fetch = async () => {
      request += 1
      return request === 1 ? answer(snapshot('personal', 'stable-model')) : refresh.promise
    }

    const wrapper = mountView()
    await flushPromises()
    const committedHead = wrapper.get('.improvements-head').element

    sources[0].emit('error', new Event('error'))
    await nextTick()
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Try again')
    if (retry === undefined) throw new Error('Expected the degraded-state retry action')
    await retry.trigger('click')
    await nextTick()

    expect(wrapper.get('.improvements-head').element).toBe(committedHead)
    expect(wrapper.text()).toContain('stable-model')

    refresh.resolve(answer(snapshot('personal', 'replacement-model')))
    await flushPromises()
    expect(wrapper.text()).toContain('replacement-model')
    wrapper.unmount()
  })

  it('lets the newest SSE snapshot beat older HTTP and isolates a switched scope', async () => {
    const alpha = deferred<Response>()
    const beta = deferred<Response>()
    globalThis.fetch = async (input) => {
      let target: string
      if (input instanceof Request) target = input.url
      else if (input instanceof URL) target = input.href
      else target = input
      const scope = new URL(target, 'https://valkama.invalid').searchParams.get('scope')
      return scope === 'alpha' ? alpha.promise : beta.promise
    }

    const wrapper = mountView('alpha')
    await nextTick()
    sources[0].message(snapshot('alpha', 'alpha-live'))
    await flushPromises()
    expect(wrapper.text()).toContain('alpha-live')

    alpha.resolve(answer(snapshot('alpha', 'alpha-old-http')))
    await flushPromises()
    expect(wrapper.text()).toContain('alpha-live')
    expect(wrapper.text()).not.toContain('alpha-old-http')

    await wrapper.setProps({ scope: 'beta' })
    await nextTick()
    expect(sources[0].closed).toBe(true)
    expect(wrapper.text()).not.toContain('alpha-live')
    expect(wrapper.find('.platform-state-panel[data-tone="info"][aria-busy="true"]').exists()).toBe(
      true,
    )

    sources[0].message(snapshot('alpha', 'alpha-late'))
    sources[1].message(snapshot('beta', 'beta-live'))
    await flushPromises()
    expect(wrapper.text()).toContain('beta-live')
    expect(wrapper.text()).not.toContain('alpha-late')

    beta.resolve(answer(snapshot('beta', 'beta-old-http')))
    await flushPromises()
    expect(wrapper.text()).toContain('beta-live')
    expect(wrapper.text()).not.toContain('beta-old-http')
    wrapper.unmount()
  })
})
