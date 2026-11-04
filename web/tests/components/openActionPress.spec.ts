/**
 * What a press on the session button does: one action at once, more through the panel,
 * and a session long silent only on its own press, after a warning. Through the real
 * planner client and bridge reader; the plan, the window and the app's bridge are doubles.
 */
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deferred } from '../fixtures/workItem.ts'
import {
  answerPlans,
  buttonNamed,
  desktop,
  desktopStep,
  executor,
  FOLDER_LINK,
  mountAction,
  opened,
  plan,
  resetOutsideWorld,
  restoreOutsideWorld,
  say,
  SESSION,
  SESSION_LINK,
  terminal,
  vscode,
  windowSteps,
} from '../support/openActionHarness.ts'

const RESUME_COMMAND = `claude --resume ${SESSION}`
const SILENT_SINCE = '2026-08-10T09:15:00Z'
const RESUME_LABEL = 'Resume, if the window is closed'
const COPY_LABEL = 'Copy the command, if the window is closed'

const explainSilent = { kind: 'explain', reason: 'live-in-terminal', silent_since: SILENT_SINCE }
const resumeStep = {
  kind: 'resume-in-terminal',
  client: 'claude',
  session: SESSION,
  folder: 'C:\\work\\example-project',
}
const lookElsewhere = { ...vscode, source: 'fallback' }

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return writeText
}

beforeEach(resetOutsideWorld)
afterEach(restoreOutsideWorld)

describe('a press', () => {
  it('in a browser, two steps take two presses in order, the second only after the first', async () => {
    answerPlans(plan(vscode, { ...vscode, source: 'recorded' }, windowSteps))
    const wrapper = mountAction({ executor: executor(vscode) })
    await flushPromises()
    await wrapper.get('button.open-action').trigger('click')
    await flushPromises()
    expect(opened).not.toHaveBeenCalled()
    const first = buttonNamed('Open the project window in VS Code')
    const second = buttonNamed('Open the session in VS Code')
    expect(document.activeElement).toBe(first)
    expect(second.disabled).toBe(true)

    first.click()
    await flushPromises()
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK])
    expect(second.disabled).toBe(false)
    expect(document.activeElement).toBe(second)
    expect(document.querySelector('.open-panel-note')?.textContent).toContain(
      'Now open the session in it.',
    )

    second.click()
    await flushPromises()
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK, SESSION_LINK])
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(say).toHaveBeenCalledWith('Opened in VS Code')
    wrapper.unmount()
  })

  it('is busy while it works and takes no second press; once answered it can be pressed again', async () => {
    const answering = deferred<Response>()
    const body = plan(desktop, { ...desktop, source: 'recorded' }, [desktopStep])
    answerPlans(body)
    const wrapper = mountAction({ executor: executor(desktop) })
    await flushPromises()
    const slow = vi.fn(() => answering.promise)
    vi.stubGlobal('fetch', slow)
    const button = wrapper.get('button.open-action')
    await button.trigger('click')
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(slow).toHaveBeenCalledTimes(1)

    answering.resolve(new Response(JSON.stringify(body), { status: 200 }))
    await flushPromises()
    expect(button.attributes('aria-busy')).toBeUndefined()
    expect(opened).toHaveBeenCalledTimes(1)
    answerPlans(body)
    await button.trigger('click')
    await flushPromises()
    expect(opened).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('in the app, runs the plan the app reads and follows only the app’s own next step', async () => {
    const openSession = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        mode: 'explained',
        reason: 'live-in-terminal',
        next: 1,
        plan: plan(
          terminal,
          { ...vscode, source: 'fallback' },
          [{ kind: 'explain', reason: 'live-in-terminal' }, ...windowSteps],
          'live',
        ),
      })
      .mockResolvedValue({
        ok: true,
        mode: 'opened',
        next: null,
        plan: plan(terminal, { ...vscode, source: 'fallback' }, windowSteps, 'live'),
      })
    Object.assign(window, { valkamaDesktop: { openSession } })
    answerPlans(plan(terminal, { ...vscode, source: 'fallback' }, windowSteps, 'live'))
    const wrapper = mountAction({ executor: executor(terminal, 'live') })
    await flushPromises()
    await wrapper.get('button.open-action').trigger('click')
    await flushPromises()
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('in a terminal')

    buttonNamed('Open the project window in VS Code').click()
    await flushPromises()
    expect(openSession).toHaveBeenLastCalledWith({ session: SESSION, fallback: 'vscode', step: 1 })
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(say).toHaveBeenCalledWith('Opened in VS Code')
    wrapper.unmount()
  })

  it('in the app, a live session the process check found dead resumes with no panel', async () => {
    const openSession = vi.fn().mockResolvedValue({ ok: true, mode: 'opened', next: null })
    Object.assign(window, { valkamaDesktop: { openSession } })
    answerPlans({})
    const wrapper = mountAction({ executor: executor(terminal, 'live') })
    await flushPromises()
    await wrapper.get('button.open-action').trigger('click')
    await flushPromises()
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(say).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('says a refusal in words and reads the plan again, whatever the app put in its answer', async () => {
    const openSession = vi.fn().mockResolvedValue({
      ok: false,
      mode: 'refused',
      reason: 'Error: spawn ENOENT C:\\work\\a.exe',
      next: null,
    })
    Object.assign(window, { valkamaDesktop: { openSession } })
    const reads = answerPlans(plan(desktop, { ...desktop, source: 'recorded' }, [desktopStep]))
    const wrapper = mountAction({ executor: executor(desktop) })
    await flushPromises()
    expect(reads).toHaveBeenCalledTimes(1)
    await wrapper.get('button.open-action').trigger('click')
    await flushPromises()
    expect(say).toHaveBeenCalledWith('The Valkama app could not open it.')
    expect(reads).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('a refused step keeps the panel and says why in it', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('blocked C:\\work\\secret')
    })
    answerPlans(
      plan(vscode, { ...vscode, source: 'recorded' }, [
        { kind: 'focus-folder', ide: 'vscode', folder: 'C:\\work\\a' },
        { kind: 'open-link', scheme: 'vscode', link: SESSION_LINK },
      ]),
    )
    const wrapper = mountAction({ executor: executor(vscode) })
    await flushPromises()
    await wrapper.get('button.open-action').trigger('click')
    await flushPromises()
    buttonNamed('Open the project window in VS Code').click()
    await flushPromises()
    expect(document.querySelector('.open-panel-note')?.textContent).toBe(
      'Only the Valkama app can open this.',
    )
    expect(buttonNamed('Open the session in VS Code').disabled).toBe(true)
    wrapper.unmount()
  })
})

describe('a session long silent', () => {
  const silentInBrowser = plan(
    terminal,
    lookElsewhere,
    [explainSilent, ...windowSteps, { kind: 'copy', text: RESUME_COMMAND }],
    'live',
  )

  async function openPanel(executorState = executor(terminal, 'live')) {
    const wrapper = mountAction({ executor: executorState })
    await flushPromises()
    await wrapper.get('button.open-action').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('still says it runs, and the panel warns before anything can be pressed', async () => {
    answerPlans(silentInBrowser)
    const wrapper = await openPanel()
    expect(wrapper.get('button.open-action').text()).toContain('Terminal · running')
    const panel = document.querySelector('[role="dialog"]')?.textContent ?? ''
    expect(panel).toContain('Last sign of it:')
    // In the units every span of the app takes; the exact span is the browser spec's, on its clock.
    expect(panel).toMatch(/\d+\u{A0}d(?:\u{A0}\d+\u{A0}h)? ago\./u)
    expect(panel).toContain('a second process would write to the same transcript')
    expect(panel.indexOf('a second process')).toBeLessThan(panel.indexOf(COPY_LABEL))
    expect(opened).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('walking the way to look at it never reaches the offer', async () => {
    const writeText = stubClipboard()
    answerPlans(silentInBrowser)
    const wrapper = await openPanel()
    expect(document.activeElement?.textContent?.trim()).toBe('Open the project window in VS Code')

    buttonNamed('Open the project window in VS Code').click()
    await flushPromises()
    buttonNamed('Open the session in VS Code').click()
    await flushPromises()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(opened.mock.calls.map(([link]) => link)).toEqual([FOLDER_LINK, SESSION_LINK])
    expect(writeText).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('in a browser, its own press copies the command and says so', async () => {
    const writeText = stubClipboard()
    answerPlans(silentInBrowser)
    const wrapper = await openPanel()
    expect(writeText).not.toHaveBeenCalled()
    buttonNamed(COPY_LABEL).click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(RESUME_COMMAND)
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(say).toHaveBeenCalledWith('Command copied — paste it into a terminal')
    wrapper.unmount()
  })

  it('where looking elsewhere is not on offer, focus does not stand on the offer', async () => {
    answerPlans(
      plan(terminal, null, [explainSilent, { kind: 'copy', text: RESUME_COMMAND }], 'live'),
    )
    const wrapper = await openPanel()
    expect(buttonNamed(COPY_LABEL)).toBeTruthy()
    expect(document.activeElement).not.toBe(buttonNamed(COPY_LABEL))
    expect(document.querySelector('.open-panel-steps')).toBeNull()
    wrapper.unmount()
  })

  it('a press that follows another under a pointer that has not moved does not reach it', async () => {
    const writeText = stubClipboard()
    answerPlans(silentInBrowser)
    const wrapper = await openPanel()
    const pressAt = (target: Element, type: string, detail = 0) =>
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX: 500, clientY: 500, detail }),
      )
    pressAt(document.body, 'pointerdown')
    const offer = buttonNamed(COPY_LABEL)
    pressAt(offer, 'pointerdown')
    pressAt(offer, 'click', 1)
    await flushPromises()
    expect(writeText).not.toHaveBeenCalled()

    document.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 600, clientY: 600 }),
    )
    pressAt(offer, 'pointerdown')
    pressAt(offer, 'click', 1)
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('in the app, the answer offers it, the walk stops short of it, and its press names its step', async () => {
    const silentInApp = plan(
      terminal,
      lookElsewhere,
      [explainSilent, ...windowSteps, resumeStep],
      'live',
    )
    const openSession = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        mode: 'explained',
        reason: 'live-in-terminal',
        silent_since: SILENT_SINCE,
        next: 1,
        plan: silentInApp,
      })
      .mockResolvedValue({ ok: true, mode: 'opened', next: null, plan: silentInApp })
    Object.assign(window, { valkamaDesktop: { openSession } })
    answerPlans(silentInApp)
    const wrapper = await openPanel()
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('a second process')

    buttonNamed(RESUME_LABEL).click()
    await flushPromises()
    expect(openSession).toHaveBeenLastCalledWith({ session: SESSION, fallback: 'vscode', step: 3 })
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    // Where it went, and not where the plan's route would have.
    expect(say).toHaveBeenCalledWith('Opened in a terminal')
    wrapper.unmount()
  })

  it('in the app, the last step of the walk is the end of it, with the offer left unrun', async () => {
    const silentInApp = plan(
      terminal,
      lookElsewhere,
      [explainSilent, ...windowSteps, resumeStep],
      'live',
    )
    const openSession = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        mode: 'explained',
        reason: 'live-in-terminal',
        silent_since: SILENT_SINCE,
        next: 1,
        plan: silentInApp,
      })
      .mockResolvedValueOnce({ ok: true, mode: 'opened', next: 2, plan: silentInApp })
      .mockResolvedValueOnce({ ok: true, mode: 'opened', next: 3, plan: silentInApp })
    Object.assign(window, { valkamaDesktop: { openSession } })
    answerPlans(silentInApp)
    const wrapper = await openPanel()
    buttonNamed('Open the project window in VS Code').click()
    await flushPromises()
    buttonNamed('Open the session in VS Code').click()
    await flushPromises()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(openSession).toHaveBeenCalledTimes(3)
    expect(openSession.mock.lastCall).toEqual([{ session: SESSION, fallback: 'vscode', step: 2 }])
    wrapper.unmount()
  })

  it('in the app, a plan with only the explanation and the offer still opens the panel', async () => {
    const onlyOffer = plan(terminal, null, [explainSilent, resumeStep], 'live')
    const openSession = vi.fn().mockResolvedValue({
      ok: false,
      mode: 'explained',
      reason: 'live-in-terminal',
      silent_since: SILENT_SINCE,
      next: 1,
      plan: onlyOffer,
    })
    Object.assign(window, { valkamaDesktop: { openSession } })
    answerPlans(onlyOffer)
    const wrapper = await openPanel()
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(buttonNamed(RESUME_LABEL)).toBeTruthy()
    wrapper.unmount()
  })
})
