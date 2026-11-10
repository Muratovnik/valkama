/**
 * The button that opens a session, through the real planner client and the real
 * dictionary: what it says before any press, row by row of the table the feature
 * promises. The server's plan and the window are the only doubles.
 */
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExecutorLink from '@/features/session-open/ExecutorLink.vue'

import { messages } from '@/shared/i18n/index.ts'
import { DEFAULT_SETTINGS } from '@/shared/lib/settings.ts'
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

import { hintOf } from '../support/hint.ts'
import {
  answerPlans,
  desktop,
  DESKTOP_LINK,
  desktopStep,
  executor,
  mountAction,
  NAME,
  nowhere,
  opened,
  plan,
  resetOutsideWorld,
  restoreOutsideWorld,
  say,
  SESSION,
  terminal,
  vscode,
  windowSteps,
} from '../support/openActionHarness.ts'

/**
 * What the button is called, what it shows, its tooltip and the note under it, and what a
 * screen reader hears after the name. What it shows is the name, then each glyph by the words
 * it is named and hinted by, which are the words it stands for: the client's sign, as a tile
 * draws the executor, then that it runs and that a setting chose the place. The place itself is
 * what a press does, so the tooltip and the name say it.
 */
function read(wrapper: ReturnType<typeof mountAction>) {
  const button = wrapper.get('button.open-action')
  const marks = button.findAll('.open-action-mark').map((mark) => {
    expect(mark.attributes('role')).toBe('img')
    expect(hintOf(mark)).toBe(mark.classes('word') ? undefined : mark.attributes('aria-label'))
    return mark.attributes('aria-label')
  })
  return {
    description: button.attributes('aria-description'),
    name: button.attributes('aria-label'),
    note: tooltipOf(button.element)?.note,
    shown: [button.get('.open-action-name').text(), marks.join(' · ')].filter(Boolean).join(' '),
    glyphs: button.findAll('.open-action-mark').map((mark) => mark.attributes('data-mark')),
    title: hintOf(button),
  }
}

/** The hints among words that stand for no button, other than a cut word's own whole words. */
const stillHints = (wrapper: ReturnType<typeof mountAction>) =>
  wrapper
    .findAll('.open-action-still [data-tooltip]')
    .filter((hinted) => hinted.attributes('data-tooltip-kind') !== 'clipped')
    .map((hinted) => hinted.attributes('data-tooltip'))

function always(choice: string) {
  localStorage.setItem(
    'valkama-settings',
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      sessions: {
        ...DEFAULT_SETTINGS.sessions,
        claude: { ...DEFAULT_SETTINGS.sessions.claude, always: choice },
      },
    }),
  )
}

beforeEach(resetOutsideWorld)
afterEach(restoreOutsideWorld)

describe('what stands before any press', () => {
  it('a known place that opens is named, and one press opens it', async () => {
    answerPlans(plan(desktop, { ...desktop, source: 'recorded' }, [desktopStep]))
    const wrapper = mountAction({ executor: executor(desktop) })
    await flushPromises()
    expect(read(wrapper)).toMatchObject({
      name: `Open session ${NAME} in Claude Desktop`,
      shown: `${NAME} Claude Code`,
    })
    // The hint says what a press does, never the holder the button shows.
    expect(read(wrapper)).toMatchObject({ title: 'Open in Claude Desktop', note: '' })

    await wrapper.get('button.open-action').trigger('click')
    await flushPromises()
    expect(opened.mock.calls.map(([link]) => link)).toEqual([DESKTOP_LINK])
    expect(say).toHaveBeenCalledWith(`Session ${NAME} opened in Claude Desktop`, 'done')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })

  it('the place reads in Russian as a phrase of the sentence', async () => {
    answerPlans(plan(vscode, { ...vscode, source: 'recorded' }, windowSteps))
    const wrapper = mountAction({ executor: executor(vscode) }, 'ru')
    await flushPromises()
    expect(read(wrapper).name).toBe(`Открыть сессию ${NAME} в VS Code`)
    wrapper.unmount()
  })

  it('an unknown place names where it falls back to, and says it does not know', async () => {
    answerPlans(
      plan({ ...nowhere, source: 'none' }, { ...vscode, source: 'fallback' }, windowSteps),
    )
    const wrapper = mountAction({ executor: executor(nowhere) })
    await flushPromises()
    expect(read(wrapper).shown).toBe(`${NAME} Claude Code`)
    expect(read(wrapper).title).toBe('Open in VS Code')
    expect(read(wrapper).description).toContain('Where it is open is unknown; it opens in VS Code')
    wrapper.unmount()
  })

  it('a place only a row’s first open gives is the plan’s, and says so', async () => {
    const codex = { opened_in: 'app', opened_host: 'codex-app' }
    answerPlans(
      plan({ ...codex, source: 'derived', first_open: true }, { ...codex, source: 'derived' }, [
        { kind: 'open-link', scheme: 'codex', link: `codex://threads/${SESSION}` },
      ]),
    )
    const wrapper = mountAction({ executor: executor(nowhere) })
    await flushPromises()
    expect(read(wrapper).shown).toBe(`${NAME} Claude Code`)
    expect(read(wrapper).title).toBe('Open in Codex')
    expect(read(wrapper).description).toContain('by where it was first opened')
    wrapper.unmount()
  })

  it('a session running in a terminal says so, and a press shows why and what can be done', async () => {
    answerPlans(
      plan(
        terminal,
        { ...vscode, source: 'fallback' },
        [{ kind: 'explain', reason: 'live-in-terminal' }, ...windowSteps],
        'live',
      ),
    )
    const wrapper = mountAction({ executor: executor(terminal, 'live') })
    await flushPromises()
    expect(read(wrapper).shown).toBe(`${NAME} Claude Code · running`)
    expect(read(wrapper).name).toContain('is running in a terminal')
    // The client and that it runs are glyphs: the button's words are its name alone.
    expect(read(wrapper).glyphs).toEqual(['client', 'live'])
    expect(wrapper.get('button.open-action .open-action-words').text()).toBe(NAME)
    expect(wrapper.find('.open-action [data-mark="client"] svg').exists()).toBe(true)
    // One line for what a press does, and the state under it in the quiet ink, with where.
    expect(read(wrapper)).toMatchObject({
      title: 'Show what can be done',
      note: 'running in a terminal',
    })

    const pressed = wrapper.get('button.open-action').element as HTMLElement
    pressed.focus()
    pressed.click()
    await flushPromises()
    const panel = document.querySelector('[role="dialog"]')
    expect(panel?.textContent).toContain('a second copy would write to the same session')
    expect(panel?.textContent).toContain('See it in VS Code')
    // Nothing runs on the press that only explains, and focus waits on the first action.
    expect(opened).not.toHaveBeenCalled()
    expect(document.activeElement?.textContent?.trim()).toBe('Open the project window in VS Code')

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flushPromises()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(pressed))
    wrapper.unmount()
  })

  it('an action leads its own name while the session runs, never stands in for a session', async () => {
    const running = plan(
      terminal,
      { ...vscode, source: 'fallback' },
      [{ kind: 'explain', reason: 'live-in-terminal' }, ...windowSteps],
      'live',
    )
    for (const [locale, action, name, title] of [
      [
        'en',
        'Open session',
        'Open session — it is running in a terminal: what can be done',
        'Show what can be done',
      ],
      [
        'ru',
        'Открыть сессию',
        'Открыть сессию — она идёт в терминале: что можно сделать',
        'Показать, что можно сделать',
      ],
    ] as const) {
      answerPlans(running)
      const wrapper = mountAction(
        { executor: executor(terminal, 'live'), name: undefined, action },
        locale,
      )
      await flushPromises()
      expect(read(wrapper).name).toBe(name)
      expect(read(wrapper).title).toBe(title)
      wrapper.unmount()
    }
  })

  it('says running in a terminal before any plan has answered', () => {
    answerPlans(new Promise(() => {}))
    const wrapper = mountAction({ executor: executor(terminal, 'live') })
    expect(read(wrapper).shown).toBe(`${NAME} Claude Code · running`)
    expect(read(wrapper).note).toBe('running in a terminal')
    wrapper.unmount()
  })

  it('a session running without a window is no button and says where it is stopped', async () => {
    const headless = { opened_in: 'headless', opened_host: '' }
    answerPlans(plan(headless, null, [{ kind: 'explain', reason: 'live-headless' }], 'headless'))
    const wrapper = mountAction({ executor: executor(headless, 'headless') })
    await flushPromises()
    expect(wrapper.find('button.open-action').exists()).toBe(false)
    expect(wrapper.text()).toContain('No window · running')
    // The words say nothing more on hover than their own whole words, and that only while a
    // narrow line cuts them: the why is the control beside them.
    expect(stillHints(wrapper)).toEqual([])
    expect(wrapper.get('.open-action-why').attributes('aria-label')).toContain(
      'it is stopped from its attempt',
    )
    wrapper.unmount()
  })

  it('a session the client lost is no button, in the quiet ink, and says a copy is kept', async () => {
    answerPlans(plan(nowhere, null, [{ kind: 'explain', reason: 'gone', archived: true }], 'gone'))
    const wrapper = mountAction({ executor: executor(nowhere, 'gone') })
    await flushPromises()
    expect(wrapper.find('button.open-action').exists()).toBe(false)
    expect(wrapper.get('.open-action-still .open-action-place').text()).toBe('session gone')
    expect(stillHints(wrapper)).toEqual([])
    const why = wrapper.get('.open-action-why').attributes('aria-label')
    expect(why).toContain('The client no longer has this session.')
    expect(why).toContain('A copy is kept in Valkama.')
    wrapper.unmount()
  })

  it('a session the card’s read says is gone is no button before any plan has answered', () => {
    answerPlans(new Promise(() => {}))
    const wrapper = mountAction({ executor: executor(nowhere, 'gone') })
    expect(wrapper.find('button.open-action').exists()).toBe(false)
    expect(wrapper.get('.open-action-still .open-action-place').text()).toBe('session gone')
    wrapper.unmount()
  })

  it('a reason is reachable with no pointer: the keyboard opens it and Escape closes it', async () => {
    answerPlans(plan(nowhere, null, [{ kind: 'explain', reason: 'gone' }], 'gone'))
    const wrapper = mountAction({ executor: executor(nowhere, 'gone') })
    await flushPromises()
    const why = wrapper.get('.open-action-why')
    expect(why.attributes('aria-label')).toBe('The client no longer has this session.')
    await why.trigger('click')
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      'The client no longer has this session.',
    )
    wrapper.unmount()
  })

  it('a folder or a program that is missing is said in place of the place, and is no button', async () => {
    for (const [step, words] of [
      [{ kind: 'explain', reason: 'no-folder' }, 'session folder unknown'],
      [{ kind: 'explain', reason: 'not-installed', host: 'vscode' }, 'VS Code is not installed'],
    ] as const) {
      answerPlans(plan(vscode, null, [step]))
      const wrapper = mountAction({ executor: executor(vscode) })
      await flushPromises()
      expect(wrapper.find('button.open-action').exists()).toBe(false)
      expect(wrapper.get('.open-action-still .open-action-place').text()).toBe(words)
      wrapper.unmount()
    }
  })

  it('a holder with no session stays the text it was', () => {
    const reads = answerPlans({})
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
    const none = {
      session: null,
      agent: null,
      opened_in: '',
      opened_host: '',
      family: '',
      state: 'none',
    } as const
    const wrapper = mount(ExecutorLink, {
      props: { holder: 'the owner', executor: none },
      global: { plugins: [createPinia(), i18n] },
    })
    expect(wrapper.text()).toBe('the owner')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(reads).not.toHaveBeenCalled()
  })

  it('a holder with a session names it, shortened, with the whole of it in its description', async () => {
    answerPlans(plan(desktop, { ...desktop, source: 'recorded' }, [desktopStep]))
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
    const holder = `claude (session ${SESSION})`
    const wrapper = mount(ExecutorLink, {
      props: { holder, executor: executor(desktop), detail: 'Responsible' },
      global: { plugins: [createPinia(), i18n] },
    })
    await flushPromises()
    const button = wrapper.get('button.open-action')
    expect(button.get('.open-action-name').text()).toBe('claude · 6f1c2a8e-0000')
    expect(button.attributes('aria-description')).toContain(holder)
    expect(button.attributes('aria-description')).toContain('Responsible')
    // The hover says what a press does; the holder's name is on the button.
    expect(hintOf(button)).toBe('Open in Claude Desktop')
  })
})

describe('"always open in" is named while it is on', () => {
  it('from the plan: the place and "by your setting", visibly and in the name', async () => {
    always('vscode')
    const reads = answerPlans(plan(desktop, { ...vscode, source: 'always' }, windowSteps))
    const wrapper = mountAction({ executor: executor(desktop) })
    await flushPromises()
    expect(read(wrapper).shown).toBe(`${NAME} Claude Code · by your setting`)
    expect(read(wrapper).title).toBe('Open in VS Code')
    expect(read(wrapper).name).toBe(`Open session ${NAME} in VS Code — by your setting`)
    expect(read(wrapper).description).toContain('opens in VS Code — by your setting')
    expect(String(reads.mock.calls[0])).toContain('always=vscode')
    wrapper.unmount()
  })

  it('before the plan has answered too, in Russian as the owner’s decision says it', () => {
    always('vscode')
    answerPlans(new Promise(() => {}))
    const wrapper = mountAction({ executor: executor(desktop) }, 'ru')
    expect(read(wrapper).shown).toBe(`${NAME} Claude Code · по настройке`)
    expect(read(wrapper).title).toBe('Открыть в VS Code')
    expect(read(wrapper).description).toContain('откроется в VS Code — по настройке')
    wrapper.unmount()
  })

  it('the owner’s own command takes no plan and says it is the setting', async () => {
    always('custom')
    const reads = answerPlans({})
    const wrapper = mountAction({ executor: executor(desktop) })
    await flushPromises()
    expect(read(wrapper).shown).toBe(`${NAME} Claude Code · by your setting`)
    expect(read(wrapper).title).toBe('Your own command')
    expect(reads).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('reading the plan before a press', () => {
  it('asks once for the buttons of one session, and opens nothing by asking', async () => {
    const reads = answerPlans(plan(vscode, { ...vscode, source: 'recorded' }, windowSteps))
    const openSession = vi.fn()
    const first = mountAction({ executor: executor(vscode) })
    const second = mountAction({ executor: executor(vscode), name: 'another' })
    await flushPromises()
    expect(reads).toHaveBeenCalledTimes(1)
    expect(opened).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
    first.unmount()
    second.unmount()
  })

  it('asks the app’s plan in the app, and the app is not asked to do anything', async () => {
    const openSession = vi.fn()
    Object.assign(window, { valkamaDesktop: { openSession } })
    const reads = answerPlans(plan(vscode, { ...vscode, source: 'recorded' }, windowSteps))
    const wrapper = mountAction({ executor: executor(vscode) })
    await flushPromises()
    expect(String(reads.mock.calls[0])).toContain('surface=desktop')
    expect(openSession).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps what the card’s read said when the read fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('C:\\work\\secret refused')
      }),
    )
    const wrapper = mountAction({ executor: executor(desktop) })
    await flushPromises()
    expect(read(wrapper).shown).toBe(`${NAME} Claude Code`)
    expect(read(wrapper).title).toBe('Open in Claude Desktop')
    expect(wrapper.html()).not.toContain('secret')
    wrapper.unmount()
  })

  it('a surface whose read names no holder waits for the plan to name the place', async () => {
    answerPlans(plan(desktop, { ...desktop, source: 'recorded' }, [desktopStep]))
    const wrapper = mountAction({ name: undefined, action: 'Open session' })
    expect(read(wrapper).shown).toBe('Open session')
    await flushPromises()
    expect(read(wrapper)).toMatchObject({
      name: 'Open session in Claude Desktop',
      shown: 'Open session Claude Code',
    })
    wrapper.unmount()
  })
})
