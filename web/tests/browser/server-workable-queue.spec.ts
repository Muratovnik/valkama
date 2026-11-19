import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { python, serverStore, storeEnvironment } from './serverStore.ts'
import { test } from './test.ts'

/**
 * «Workable» in the Work filter is what the take-next queue hands out, read from the real
 * server on one store: the rows the filter lets through are the tasks claim-ready gives,
 * one by one, until it gives none. The filter reads the list's own answer for each row,
 * not a copy of the queue's rule, so a rule the server adds is one the filter follows.
 *
 * Runs only with VALKAMA_BROWSER_STORE naming a store for the server: a space with a
 * project of its own, so a run leaves the store's other spaces as they were.
 */

const store = serverStore() ?? ''
if (!store) throw new Error('VALKAMA_BROWSER_STORE names no store: this runs on the real server')
const stamp = Date.now().toString(36).toUpperCase().slice(-6)
const KEY = `W${stamp}`
const PROJECT = `workable-${stamp.toLowerCase()}`
const ROOT = join(store, 'projects', PROJECT)

/** The server's own command line, in the store the server runs with. */
function valkama(...args: string[]) {
  execFileSync(python, ['../valkama.py', ...args], {
    env: { ...process.env, ...storeEnvironment(store) },
    stdio: 'pipe',
  })
}

/** A call as the app makes it: through the page, with the session its bootstrap grants. */
async function call(page: Page, path: string, body?: object): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ path, body }) => {
      const granted = await fetch('/api/security/bootstrap')
      const token = (await granted.json()) as { session_token: string }
      const response = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Valkama-Session': token.session_token,
        },
        body: body ? JSON.stringify(body) : null,
      })
      const answer = (await response.json()) as Record<string, unknown>
      if (!response.ok)
        throw new Error(`${path} answered ${response.status}: ${JSON.stringify(answer)}`)
      return answer
    },
    { path, body },
  )
}

/** Files an item in the space and answers its reference. */
async function file(page: Page, fields: Record<string, unknown>): Promise<string> {
  const answer = await call(page, '/api/planning/work-items', { space: KEY, ...fields })
  const item = (answer.work_item ?? answer) as { reference: string }
  return item.reference
}

/** The tasks the queue gives, asked until it gives nothing, each one claimed as it is given. */
async function drainQueue(page: Page): Promise<Set<string>> {
  const given = new Set<string>()
  for (let asked = 0; asked < 10; asked += 1) {
    const answer = await call(page, '/api/planning/work-item/claim-ready', { space: KEY })
    const item = answer.work_item as { reference: string } | null
    if (item === null) break
    given.add(item.reference)
  }
  return given
}

test('«Workable» lets through exactly what the queue hands out', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  mkdirSync(ROOT, { recursive: true })
  valkama('projects', 'add', PROJECT, '--name', 'Browser check', '--root', ROOT)
  await call(page, '/api/planning/spaces', {
    project_id: PROJECT,
    name: `Workable check ${stamp}`,
    key: KEY,
  })
  const free = await file(page, { title: 'Ready, nothing in its way', state: 'ready' })
  const blocker = await file(page, { title: 'Ready, and in the way', state: 'ready' })
  const blocked = await file(page, { title: 'Ready, waiting on another', state: 'ready' })
  const untriaged = await file(page, { title: 'Not yet accepted', state: 'triage' })
  const goal = await file(page, { title: 'A goal not yet accepted', kind: 'goal', state: 'triage' })
  const under = await file(page, { title: 'Ready, under that goal', state: 'ready', parent: goal })
  await call(page, '/api/planning/work-item/link', { id: blocker, other: blocked, kind: 'blocks' })
  valkama('projects', 'bind', PROJECT, '--space', KEY)

  // The list of the space, narrowed by the condition from the filter's menu.
  await page.goto(`/open/${free}?in=browser`)
  await expect(page.locator('.drawer')).toHaveCSS('transform', 'none')
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'List', exact: true }).click()
  await page.getByRole('combobox', { name: 'Filter work' }).click()
  await page.getByRole('option', { name: 'Workable', exact: true }).click()
  await page.keyboard.press('Escape')
  const rows = page.locator('tbody .list-open')
  await expect(rows.first()).toBeVisible()
  const shown = new Set(await rows.allTextContents())

  const given = await drainQueue(page)

  expect([...shown].sort()).toEqual([...given].sort())
  // Not a match of two empty sets: the free task is given, and what waits is not.
  expect(shown.has(free)).toBe(true)
  for (const withheld of [untriaged, goal, under]) expect(shown.has(withheld)).toBe(false)
  expect(shown.has(blocker) && shown.has(blocked)).toBe(false)
})
