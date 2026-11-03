/**
 * What the specs of the session button share: the server's plan, the outside world (the
 * window, the status region) as doubles, and the button mounted as a card mounts it.
 */
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { vi } from 'vitest'

import OpenAction from '@/features/session-open/OpenAction.vue'
import { provideOpenNotice } from '@/features/session-open/openNotice.ts'

import type { Executor } from '@/shared/api/executorModel.ts'
import { messages } from '@/shared/i18n/index.ts'

export const SESSION = '6f1c2a8e-0000-4000-8000-000000000001'
export const FOLDER_LINK = 'vscode://file/C:/work/example-project'
export const SESSION_LINK = `vscode://anthropic.claude-code/open?session=${SESSION}`
export const DESKTOP_LINK = 'claude://code/continue?session=local_1'
export const NAME = 'claude · d89b6225'

export const vscode = { opened_in: 'ide', opened_host: 'vscode' } as const
export const desktop = { opened_in: 'app', opened_host: 'claude-desktop' } as const
export const terminal = { opened_in: 'terminal', opened_host: '' } as const
export const nowhere = { opened_in: '', opened_host: '' } as const

interface Place {
  opened_host: string
  opened_in: string
}

export function executor(place: Place, state: Executor['state'] = 'ended'): Executor {
  return { session: SESSION, agent: null, family: 'claude', state, ...place } as Executor
}

export function plan(
  place: Place & { first_open?: boolean; source?: string },
  opens: (Place & { source: string; missed?: string }) | null,
  steps: unknown[],
  state = 'ended',
) {
  return {
    target: { kind: 'session', session: SESSION, agent: '' },
    surface: 'browser',
    client: 'claude',
    state,
    place: { source: 'recorded', first_open: false, ...place },
    opens: opens && { missed: '', ...opens },
    one_action: steps.length === 1,
    steps,
  }
}

export const windowSteps = [
  { kind: 'focus-folder', ide: 'vscode', folder: 'C:\\work\\example-project', link: FOLDER_LINK },
  { kind: 'open-link', scheme: 'vscode', link: SESSION_LINK },
]
export const desktopStep = { kind: 'open-link', scheme: 'claude', link: DESKTOP_LINK }

export const say = vi.fn()
export const opened = vi.fn()

export function answerPlans(...bodies: unknown[]) {
  const reads = vi.fn(async () => {
    const body = bodies.length > 1 ? bodies.shift() : bodies[0]
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', reads)
  return reads
}

export function mountAction(props: Record<string, unknown>, locale: 'en' | 'ru' = 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  const render = () => h(OpenAction, { session: SESSION, name: NAME, ...props })
  const Host = defineComponent({
    setup() {
      provideOpenNotice(say)
      return render
    },
  })
  return mount(Host, { attachTo: document.body, global: { plugins: [createPinia(), i18n] } })
}

export function buttonNamed(name: string) {
  const found = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === name,
  )
  if (!found) throw new Error(`no button "${name}"`)
  return found
}

export function resetOutsideWorld() {
  localStorage.clear()
  say.mockReset()
  opened.mockReset()
  vi.spyOn(window, 'open').mockImplementation((...args) => {
    opened(...args)
    return null
  })
}

export function restoreOutsideWorld() {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'valkamaDesktop')
  document.body.replaceChildren()
}
