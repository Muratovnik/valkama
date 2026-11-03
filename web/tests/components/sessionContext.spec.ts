/**
 * The session dialog's button, through the real executor: the two VS Code steps
 * take two presses, a refusal is words from the dictionary, and an app that hands
 * back a plan the page cannot read still leaves a button to press. Navigation and
 * the read are stubbed, so no test follows a link.
 */
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SessionContext from '@/features/session-open/SessionContext.vue'

import { messages } from '@/shared/i18n/index.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'

const SESSION = '6f1c2a8e-0000-4000-8000-000000000001'
const FOLDER_LINK = 'vscode://file/C:/work/example-project'
const SESSION_LINK = `vscode://anthropic.claude-code/open?session=${SESSION}`

const context: ResolvedRef = {
  kind: 'session',
  value: SESSION,
  resolved: true,
  detail: 'claude',
  session: SESSION,
  client: 'claude',
  client_family: 'claude',
  work_item: 'MAIN-12',
}

const planned = {
  target: { kind: 'session', session: SESSION, agent: '' },
  surface: 'browser',
  client: 'claude',
  state: 'ended',
  place: { opened_in: 'ide', opened_host: 'vscode', source: 'recorded', first_open: false },
  opens: { opened_in: 'ide', opened_host: 'vscode', source: 'recorded', missed: '' },
  one_action: false,
  steps: [
    { kind: 'focus-folder', ide: 'vscode', folder: 'C:\\work\\example-project', link: FOLDER_LINK },
    { kind: 'open-link', scheme: 'vscode', link: SESSION_LINK },
  ],
}

function answer(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  )
}

function mountDialog() {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  return mount(SessionContext, {
    props: { context },
    attachTo: document.body,
    global: { plugins: [createPinia(), i18n] },
  })
}

const button = (name: string) => {
  const found = [...document.querySelectorAll('button')].find((node) => node.textContent === name)
  if (!found) throw new Error(`no button "${name}"`)
  return found
}

async function press(name: string) {
  button(name).click()
  await flushPromises()
}

describe('SessionContext opening its session', () => {
  const opened = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    opened.mockReset()
    vi.spyOn(window, 'open').mockImplementation((...args) => {
      opened(...args)
      return null
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'valkamaDesktop')
    document.body.replaceChildren()
  })

  it('opens the window on the first press and the session only on the second', async () => {
    answer(planned)
    const wrapper = mountDialog()
    await press('Open session')
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK])
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Now open the session')

    await press('Open the session in it')
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK, SESSION_LINK])
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Opened in VS Code')
    wrapper.unmount()
  })

  it('says a refusal in words, whatever the app put in its answer', async () => {
    const openSession = vi.fn().mockResolvedValue({
      ok: false,
      mode: 'refused',
      reason: 'Error: spawn ENOENT C:\\private\\a.exe',
      next: null,
    })
    Object.assign(window, { valkamaDesktop: { openSession } })
    const wrapper = mountDialog()
    await press('Open session')
    const status = document.querySelector('[role="status"]')?.textContent ?? ''
    expect(status).toBe('The Valkama app could not open it.')
    wrapper.unmount()
  })

  it('keeps a button to press when the app names a next step of a plan it cannot read', async () => {
    const openSession = vi
      .fn()
      .mockResolvedValue({ ok: true, mode: 'opened', next: 1, plan: { steps: 'unreadable' } })
    Object.assign(window, { valkamaDesktop: { openSession } })
    const wrapper = mountDialog()
    await press('Open session')
    await press('Open session')
    expect(openSession).toHaveBeenLastCalledWith({ session: SESSION, fallback: 'vscode', step: 1 })
    wrapper.unmount()
  })
})
