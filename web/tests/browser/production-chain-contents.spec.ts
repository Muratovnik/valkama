import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainResponse } from '../fixtures/chain.ts'
import { installBackend } from './backend.ts'
import { showChain, smallChain } from './chainFixtures.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * A goal's card reads first what the goal holds: the counts by state, then its stages and
 * tasks as the tree of rows, a stage with open work open and one with none folded. The
 * toggle turns it to what the work grew into, and back.
 */

const ROOT = workItemRef.reference
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`

const DONE = { key: 'done', name: 'Done', category: 'completed', is_terminal: true } as const
const DEV = { key: 'dev', name: 'Development', category: 'active', is_terminal: false } as const

function member(number: number, parent: string, overrides: Record<string, unknown> = {}) {
  return {
    work_item_id: id(number),
    reference: `MAIN-${number}`,
    title: `Contents item ${number}`,
    kind: 'task',
    state: DEV,
    open: true,
    container_state: null,
    claim_ref: '',
    claim_state: null,
    parent_reference: parent,
    created_at: '2026-10-20T10:00:00Z',
    closed_at: null,
    workable: false,
    queue_order: null,
    ...overrides,
  }
}

const done = (number: number, parent: string) =>
  member(number, parent, { state: DONE, open: false, closed_at: '2026-10-29T10:00:00Z' })
const stage = (number: number, derived: string) =>
  member(number, ROOT, { kind: 'stage', state: null, container_state: derived })

/** The goal's contents: a stage under way, a finished one, and a task of its own. */
function contents() {
  const members = [
    stage(1501, 'in_progress'),
    member(1502, 'MAIN-1501', { claim_ref: 'codex (session 1baa03d7)', claim_state: 'live' }),
    done(1503, 'MAIN-1501'),
    stage(1504, 'awaiting_confirmation'),
    done(1505, 'MAIN-1504'),
    member(1506, ROOT, { title: 'A task of the goal’s own, its title long enough to clip' }),
  ]
  const { chain } = smallChain()
  return {
    ...chain,
    root: { ...chain.root, totals: { chain: 16, tree: members.length } },
    scope: 'tree',
    total: members.length,
    closed: 2,
    open: members.length - 2,
    workable: 0,
    by_category: { active: 2, completed: 2 },
    by_container_state: { in_progress: 1, awaiting_confirmation: 1 },
    origins: [],
    members,
    edges: [],
  }
}

/** Answer each chain read by its scope, and record the scopes asked. */
async function serveBoth(page: Page) {
  const asked: string[] = []
  await page.route('**/api/planning/work-item/chain?*', (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope') ?? ''
    asked.push(scope)
    return route.fulfill({
      json: chainResponse((scope === 'tree' ? contents() : smallChain().chain) as never),
    })
  })
  return asked
}

for (const width of [1280, 390]) {
  test(`a goal's card opens on its contents as a tree at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installBackend(page, {
      // An accepted open goal: no state of its own, what it derives instead, and no holder.
      card: (read) => ({
        ...read,
        kind: 'goal',
        state: null,
        container_state: 'in_progress',
        claim_ref: '',
        claim_state: null,
        claim: null,
      }),
    })
    const asked = await serveBoth(page)
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: spaceScope,
        entity: planningWorkItemEntity(workItemRef),
      }),
    )
    await showChain(page)
    const section = page.locator('.drawer section.chain')
    const tree = section.getByRole('treegrid', { name: `Contents of ${ROOT}` })
    await expect(tree).toBeVisible()
    expect(asked).toEqual(['tree'])
    await expect(section.getByRole('radio', { name: 'Contents' })).toBeChecked()
    await expect(section.locator('.branch-map')).toHaveCount(0)

    // The counts are the read's: two tasks under way and two done; one stage under way, one done.
    await expect(section.locator('[data-counts="category"] [data-count]')).toHaveText([
      /In progress\s*2/u,
      /Done\s*2/u,
    ])
    await expect(section.locator('[data-counts="container"] [data-count]')).toHaveCount(2)

    const rows = tree.locator('tbody tr')
    await expect(rows).toHaveCount(5)
    expect(await rows.evaluateAll((all) => all.map((row) => row.dataset.reference))).toEqual([
      'MAIN-1501',
      'MAIN-1502',
      'MAIN-1503',
      'MAIN-1504',
      'MAIN-1506',
    ])
    await expect(tree.locator('tr[data-reference="MAIN-1501"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(tree.locator('tr[data-reference="MAIN-1502"]')).toHaveAttribute('aria-level', '2')

    // The finished stage opens from the keys: one Tab stop, ↓ to it, → opens it.
    const finished = tree.locator('tr[data-reference="MAIN-1504"]')
    await expect(finished).toHaveAttribute('aria-expanded', 'false')
    await finished.focus()
    await page.keyboard.press('ArrowRight')
    await expect(finished).toHaveAttribute('aria-expanded', 'true')
    await expect(tree.locator('tr[data-reference="MAIN-1505"]')).toBeVisible()

    // Nothing in the section runs past its edge, the long title included.
    const overflow = await section.evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const title = tree.locator('tr[data-reference="MAIN-1506"] .contents-title')
    const [titleBox, rowBox] = await Promise.all([
      title.boundingBox(),
      tree.locator('tr[data-reference="MAIN-1506"]').boundingBox(),
    ])
    expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual(
      (rowBox?.x ?? 0) + (rowBox?.width ?? 0),
    )
    // At a phone's width the holder gives way; at a desk's it stands on its row.
    await expect(tree.locator('tr[data-reference="MAIN-1502"] .contents-holder')).toBeVisible({
      visible: width >= 1280,
    })

    // The toggle turns to the chain, which draws its map, and back.
    await section.getByRole('radio', { name: 'Chain' }).click()
    await expect(section.locator('.branch-map')).toBeVisible()
    await expect(tree).toHaveCount(0)
    await section.getByRole('radio', { name: 'Contents' }).click()
    await expect(tree).toBeVisible()
    expect(asked).toEqual(['tree', 'chain', 'tree'])
  })
}
