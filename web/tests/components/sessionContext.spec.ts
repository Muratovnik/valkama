/**
 * The session dialog: what it says of a session is the dictionary's whatever the
 * server wrote, and it opens the session with the shared button, so a press that takes
 * two steps stands over the dialog. Navigation and the read are stubbed, so no test
 * follows a link.
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
  detail: 'claude · ended · no directory',
  session: SESSION,
  client: 'claude',
  client_family: 'claude',
  status: 'ended',
  cwd: 'C:\\work\\example-project',
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

function mountDialog(shown: ResolvedRef = context, locale: 'en' | 'ru' = 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  return mount(SessionContext, {
    props: { context: shown },
    attachTo: document.body,
    global: { plugins: [createPinia(), i18n] },
  })
}

const button = (name: string) => {
  const found = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === name,
  )
  if (!found) throw new Error(`no button "${name}"`)
  return found
}

async function press(name: string) {
  button(name).click()
  await flushPromises()
}

const line = () => document.querySelector('.session-context-line')?.textContent

describe('SessionContext', () => {
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

  it('says the session in its own words, never the server’s detail', () => {
    answer(planned)
    const wrapper = mountDialog({ ...context, cwd: '', status: 'active' }, 'ru')
    expect(line()).toBe('claude · идёт · папка неизвестна')
    expect(document.body.textContent).not.toContain('no directory')
    wrapper.unmount()
  })

  it.each([
    ['ended', 'claude · ended · C:\\work\\example-project'],
    ['failed', 'claude · failed · C:\\work\\example-project'],
    ['something new', 'claude · C:\\work\\example-project'],
  ])('reads the state "%s" as the dictionary has it', (status, words) => {
    answer(planned)
    const wrapper = mountDialog({ ...context, status })
    expect(line()).toBe(words)
    wrapper.unmount()
  })

  it.each([
    [{ status: 'missing' }, 'Valkama knows no such session.'],
    [{ status: 'ambiguous' }, 'This id matches several sessions.'],
    [{ status: 'ambiguous', session: SESSION }, 'This session is linked to several spaces'],
  ])('says why no one session answers, and offers no opening: %j', (extra, words) => {
    answer(planned)
    const wrapper = mountDialog({
      kind: 'session',
      value: SESSION,
      resolved: false,
      detail: 'no observed session matches this id',
      ...extra,
    })
    expect(line()).toContain(words)
    expect(document.body.textContent).not.toContain('no observed session')
    expect(document.querySelector('button.open-action')).toBeNull()
    wrapper.unmount()
  })

  it('a failed link says our words and keeps the error out of the page', async () => {
    answer(planned)
    const wrapper = mountDialog({ ...context, work_item: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"detail":"C:\\\\work\\\\store refused"}', {
            status: 500,
            headers: { 'x-valkama-token': 'x' },
          }),
      ),
    )
    const field = document.querySelector('input')
    if (!field) throw new Error('no field')
    field.value = 'MAIN-12'
    field.dispatchEvent(new Event('input'))
    await flushPromises()
    await press('Attach')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not link the session',
    )
    expect(document.body.textContent).not.toContain('store refused')
    wrapper.unmount()
  })

  it('opens the session through the panel: the window, then the session in it', async () => {
    answer(planned)
    const wrapper = mountDialog()
    await flushPromises()
    expect(document.querySelector('button.open-action')?.getAttribute('aria-label')).toBe(
      'Open session in VS Code',
    )
    ;(document.querySelector('button.open-action') as HTMLElement).click()
    await flushPromises()
    expect(opened).not.toHaveBeenCalled()

    await press('Open the project window')
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK])
    await press('Open the session in it')
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK, SESSION_LINK])
    wrapper.unmount()
  })

  it('keeps a button to press when the app names a next step of a plan it cannot read', async () => {
    answer(planned)
    const openSession = vi
      .fn()
      .mockResolvedValue({ ok: true, mode: 'opened', next: 1, plan: { steps: 'unreadable' } })
    Object.assign(window, { valkamaDesktop: { openSession } })
    const wrapper = mountDialog()
    await flushPromises()
    ;(document.querySelector('button.open-action') as HTMLElement).click()
    await flushPromises()
    await press('Open session')
    expect(openSession).toHaveBeenLastCalledWith({ session: SESSION, fallback: 'vscode', step: 1 })
    wrapper.unmount()
  })
})
