import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { python, serverStore, storeEnvironment } from './serverStore.ts'
import { test } from './test.ts'

/**
 * `@` in a description, through the real server rather than mocked routes: a task taken
 * from the list is told when the description is saved, and the item it names shows the
 * record (connection contract, "Mentions"). Saved again with that task still in its
 * words, the description tells nobody twice: a re-edit tells only the items its previous
 * text did not name, which is the owner's rule for descriptions and summaries.
 *
 * Runs only with VALKAMA_BROWSER_STORE naming a store for the server, which is created
 * for each run here: a space with a project of its own, so a run leaves the store's other
 * spaces as they were and several runs can share one store.
 */

// The configuration runs this file only with a store named, and nothing else may.
const store = serverStore() ?? ''
if (!store) throw new Error('VALKAMA_BROWSER_STORE names no store: this runs on the real server')
const stamp = Date.now().toString(36).toUpperCase().slice(-6)
const KEY = `M${stamp}`
const PROJECT = `check-${stamp.toLowerCase()}`
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

type MentionRecord = { from: string; in: string; quote: string }
/** The records of the texts that named an item, as its card reads them. */
async function recordsOn(page: Page, reference: string) {
  const answer = await call(page, `/api/planning/work-item?id=${reference}`)
  return (answer.work_item as { mentions?: MentionRecord[] }).mentions ?? []
}

test('a task chosen in a description is told once, and saved again tells nobody twice', async ({
  page,
}) => {
  await page.goto('/')
  mkdirSync(ROOT, { recursive: true })
  valkama('projects', 'add', PROJECT, '--name', 'Browser check', '--root', ROOT)
  await call(page, '/api/planning/spaces', { project_id: PROJECT, name: 'Browser check', key: KEY })
  await call(page, '/api/planning/work-items', { space: KEY, title: 'The source' })
  await call(page, '/api/planning/work-items', { space: KEY, title: 'Drop the old route' })
  valkama('projects', 'bind', PROJECT, '--space', KEY)
  const source = `${KEY}-1`
  const named = `${KEY}-2`

  await page.goto(`/open/${source}?in=browser`)
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveCSS('transform', 'none')
  const list = page.getByRole('listbox', { name: 'Mentions' })
  const description = drawer.getByRole('textbox', { name: 'Description' })
  const saves: Record<string, unknown>[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/planning/work-item/update'))
      saves.push(request.postDataJSON() as Record<string, unknown>)
  })

  // Chosen from the list, the task is written as its number and told when saved.
  await drawer.getByRole('button', { name: 'Add description' }).click()
  await description.click()
  await page.keyboard.type('Waits on @Drop')
  await list
    .getByRole('group', { name: 'Tasks' })
    .getByRole('option', { name: new RegExp(named, 'u') })
    .click()
  await expect(description).toHaveValue(`Waits on ${named} `)
  await drawer.getByRole('button', { name: 'Save description' }).click()
  await expect(description).toHaveCount(0)
  expect(saves.at(-1)?.mentions).toEqual([named])
  const told = await recordsOn(page, named)
  expect(told).toEqual([expect.objectContaining({ in: 'description', from: source })])
  expect(told[0]?.quote).toContain(`Waits on ${named}`)

  // Saved again, choosing it again: the previous words already named it, so its card
  // gains no second record.
  await drawer.getByRole('button', { name: 'Edit description' }).click()
  await description.click()
  await page.keyboard.press('End')
  await page.keyboard.type('and @Drop')
  await list
    .getByRole('group', { name: 'Tasks' })
    .getByRole('option', { name: new RegExp(named, 'u') })
    .click()
  await drawer.getByRole('button', { name: 'Save description' }).click()
  await expect(description).toHaveCount(0)
  expect(saves.at(-1)?.mentions).toEqual([named])
  expect(await recordsOn(page, named)).toHaveLength(1)
})
