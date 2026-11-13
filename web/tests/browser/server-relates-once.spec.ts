import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { python, serverStore, storeEnvironment } from './serverStore.ts'
import { test } from './test.ts'

/**
 * A relation linked from both ends, through the real server rather than mocked routes:
 * the server keeps one link whichever end writes it, so each card lists it once, under
 * "Relates to", and unlinked from the end that did not write it, it is gone from both
 * (connection contract, "What a link says about its other end"). Two records of one
 * relation used to make each card list it twice.
 *
 * Runs only with VALKAMA_BROWSER_STORE naming a store for the server, which is created
 * for each run here: a space with a project of its own, so a run leaves the store's other
 * spaces as they were and several runs can share one store.
 */

// The configuration runs this file only with a store named, and nothing else may.
const store = serverStore() ?? ''
if (!store) throw new Error('VALKAMA_BROWSER_STORE names no store: this runs on the real server')
const stamp = Date.now().toString(36).toUpperCase().slice(-6)
const KEY = `R${stamp}`
const PROJECT = `relates-${stamp.toLowerCase()}`
// A project's root is its own: two runs in one store cannot share one.
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

/** The card of `reference`, on its Relations tab. */
async function relationsOf(page: Page, reference: string) {
  await page.goto(`/open/${reference}?in=browser`)
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveCSS('transform', 'none')
  await drawer.getByRole('tab', { name: 'Relations', exact: true }).focus()
  await page.keyboard.press('Enter')
  const relations = drawer.locator('.relations')
  await expect(relations).toBeVisible()
  return relations
}

/** The group the card lists under "Relates to". */
function relatesTo(relations: Locator) {
  return relations
    .locator('.relation-group')
    .filter({ has: relations.page().getByRole('heading', { name: /^Relates to/u }) })
}

test('a relation linked from both ends is one link on each card, and either end removes it', async ({
  page,
}) => {
  await page.goto('/')
  mkdirSync(ROOT, { recursive: true })
  valkama('projects', 'add', PROJECT, '--name', 'Browser check', '--root', ROOT)
  await call(page, '/api/planning/spaces', { project_id: PROJECT, name: 'Browser check', key: KEY })
  await call(page, '/api/planning/work-items', { space: KEY, title: 'Writes the link' })
  await call(page, '/api/planning/work-items', { space: KEY, title: 'Links it back' })
  // A card opens only through a project bound to its space.
  valkama('projects', 'bind', PROJECT, '--space', KEY)
  const first = `${KEY}-1`
  const second = `${KEY}-2`
  const link = '/api/planning/work-item/link'
  await call(page, link, { id: first, other: second, kind: 'relates-to' })
  await call(page, link, { id: second, other: first, kind: 'relates-to' })

  for (const [reference, other] of [
    [first, second],
    [second, first],
  ] as const) {
    const group = relatesTo(await relationsOf(page, reference))
    await expect(group).toHaveCount(1)
    await expect(group.locator('.group-count')).toHaveText('1')
    await expect(group.locator('.link-row')).toHaveCount(1)
    await expect(group.locator('.link-reference')).toHaveText(other)
  }

  // Unlinked from the end that did not write it, the one link is gone from both cards.
  await call(page, link, { id: second, other: first, kind: 'relates-to', remove: true })
  for (const reference of [first, second]) {
    const relations = await relationsOf(page, reference)
    await expect(relatesTo(relations)).toHaveCount(0)
  }
})
