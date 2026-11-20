/**
 * Settings → Participation against the whole built app, at the widths its layout changes at:
 * a set changes every row, a space overrides a row and gives it back, a refused save takes the
 * value back with the reason under its row, a label gets a rule, a shared rule is removed and a
 * space changes one field of a rule alone, and the space's launch place is changed through the
 * space's own record. At each width nothing runs out of the screen.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { participationDouble } from '../support/participationDouble.ts'
import type { ParticipationDoubleState, Write } from '../support/participationDouble.ts'
import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope, planningReadModel, spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

const state = { section: 'participation' }
const IN_SPACE = serializePlatformRoute({ module_id: 'settings', scope: spaceScope, state })
const ALL_SPACES = serializePlatformRoute({ module_id: 'settings', scope: globalScope, state })
const WIDTHS = [1280, 760, 390] as const
const POINTS = [
  'finding',
  'proposed_goal',
  'task_in_goal',
  'decision',
  'cancel_outside',
  'cancel_shared',
  'condition',
  'goal_close',
  'goal_defer',
]

/** The participation routes and the space's settings write; routed after the backend, so they win. */
async function installParticipation(
  page: Page,
  given: ParticipationDoubleState = {},
  refuse: (write: Write) => string | null = () => null,
) {
  const double = participationDouble(given, refuse)
  const writes: Write[] = []
  const launches: Write[] = []
  await page.route(
    (url) => url.pathname === '/api/planning/participation',
    (route) => {
      const request = route.request()
      if (request.method() !== 'POST') {
        const space = new URL(request.url()).searchParams.get('space')
        return route.fulfill({ json: double.read(space) })
      }
      const body = request.postDataJSON() as Write
      writes.push(body)
      const answer = double.write(body)
      return route.fulfill({ status: answer.status, json: answer.body })
    },
  )
  await page.route(
    (url) => url.pathname === '/api/planning/space/settings',
    (route) => {
      const body = route.request().postDataJSON() as Write
      launches.push(body)
      return route.fulfill({
        json: {
          ...planningReadModel.planning_space,
          workflow: planningReadModel.workflow,
          launch_place: body.launch_place,
        },
      })
    },
  )
  return { writes, launches }
}

async function open(page: Page, width: number, address = IN_SPACE) {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(address)
  await expect(page.locator('[data-participation-row="set"]')).toBeVisible()
}

const row = (page: Page, key: string) => page.locator(`[data-participation-row="${key}"]`)
const checked = (place: Locator) => place.locator('[role="radio"][aria-checked="true"]')
const ownSwitch = (page: Page, key: string) =>
  row(page, key).getByRole('switch', { name: /^Own value/u })

for (const width of WIDTHS) {
  test(`a set shows every row with its value, and a custom set chooses none, at ${width}px`, async ({
    page,
  }) => {
    await installBackend(page)
    const { writes } = await installParticipation(page)
    await open(page, width, ALL_SPACES)
    // With all spaces the scope has its shared segment alone.
    await expect(page.getByRole('radiogroup', { name: 'Scope' }).getByRole('radio')).toHaveCount(1)
    await expect(checked(row(page, 'set'))).toHaveText('Default')

    await row(page, 'set').getByRole('radio', { name: 'Minimal' }).click()
    for (const key of POINTS) await expect(checked(row(page, key))).toHaveText('Agent')
    await expect.poll(() => writes).toEqual([{ space: null, set: 'minimal' }])

    await row(page, 'goal_close').getByRole('radio', { name: 'Person' }).click()
    await expect(checked(row(page, 'set'))).toHaveCount(0)
    await expect(row(page, 'set')).toContainText('Custom set: differs in 1 row')
    await expectNoSilentClipping(page, `Participation, shared, at ${width}px`)
  })

  test(`a space overrides a row and gives it back; a refused save takes it back at ${width}px`, async ({
    page,
  }) => {
    await installBackend(page)
    const { writes } = await installParticipation(page, {}, (write) =>
      write.key === 'decision' ? 'the store is busy' : null,
    )
    await open(page, width)
    await expect(row(page, 'finding')).toContainText('Shared: Person')

    await ownSwitch(page, 'finding').click()
    await row(page, 'finding').getByRole('radio', { name: 'Agent' }).click()
    await expect(checked(row(page, 'finding'))).toHaveText('Agent')
    await expect(row(page, 'finding')).toContainText('own')
    await expectNoSilentClipping(page, `Participation, own value, at ${width}px`)
    await ownSwitch(page, 'finding').click()
    await expect(row(page, 'finding').getByRole('radiogroup')).toHaveCount(0)
    await expect(row(page, 'finding')).toContainText('Shared: Person')

    await ownSwitch(page, 'decision').click()
    await expect(ownSwitch(page, 'decision')).toHaveAttribute('aria-checked', 'false')
    await expect(row(page, 'decision').getByRole('alert')).toHaveText(
      'Not saved: the store is busy',
    )
    await expect(ownSwitch(page, 'decision')).toBeFocused()
    await expectNoSilentClipping(page, `Participation, refused save, at ${width}px`)
    expect(writes).toEqual([
      { space: 'MAIN', key: 'finding', value: 'human' },
      { space: 'MAIN', key: 'finding', value: 'agent' },
      { space: 'MAIN', key: 'finding', value: null },
      { space: 'MAIN', key: 'decision', value: 'human' },
    ])
  })

  test(`a label gets a rule and the launch place is changed at ${width}px`, async ({ page }) => {
    await installBackend(page)
    const { writes, launches } = await installParticipation(page, {
      labels: { '': { flow: { ready: true, description: 'The main line of work' } } },
    })
    await open(page, width)
    const flow = page.locator('[data-participation-label="flow"]')
    await expect(flow).toContainText('The main line of work')
    await expect(flow).toContainText('Shared: Ready at once')

    // A label the space's work carries is offered; it gets a rule that its findings are ready.
    const field = page.getByRole('combobox', { name: 'Add a rule to a label' })
    await field.fill('plat')
    await page.getByRole('option', { name: 'platform' }).click()
    const platform = page.locator('[data-participation-label="platform"]')
    // The row's name names its choice, as every scoped row's does; «own» marks it the space's.
    await expect(platform.getByRole('switch', { name: 'platform own' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect
      .poll(() => writes)
      .toEqual([{ space: 'MAIN', label: 'platform', ready: true, description: null }])

    const launch = row(page, 'launch')
    await expect(checked(launch)).toHaveText('From the space')
    await launch.getByRole('radio', { name: 'From the card’s project' }).click()
    await expect(checked(launch)).toHaveText('From the card’s project')
    await expect(launch).toContainText('the card’s one project')
    await expect
      .poll(() => launches)
      .toEqual([{ author: 'user', space: 'MAIN', launch_place: 'item_project' }])
    await expectNoSilentClipping(page, `Participation, labels and launch place, at ${width}px`)
  })

  test(`a shared rule is removed, and a refused removal keeps its row, at ${width}px`, async ({
    page,
  }) => {
    await installBackend(page)
    const { writes } = await installParticipation(
      page,
      {
        labels: {
          '': {
            flow: { ready: true, description: 'The main line of work' },
            docs: { ready: null, description: 'Documents' },
          },
        },
      },
      (write) => (write.label === 'docs' ? 'the store is busy' : null),
    )
    await open(page, width, ALL_SPACES)
    const flow = page.locator('[data-participation-label="flow"]')
    const docs = page.locator('[data-participation-label="docs"]')
    await expect(flow).toBeVisible()
    await expectNoSilentClipping(page, `Participation, a rule to remove, at ${width}px`)

    await flow.getByRole('button', { name: 'Remove the rule of flow' }).click()
    await expect(flow).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Add a rule to a label' })).toBeFocused()

    const removeDocs = docs.getByRole('button', { name: 'Remove the rule of docs' })
    await removeDocs.click()
    await expect(docs.getByRole('alert')).toHaveText('Not saved: the store is busy')
    await expect(docs).toContainText('Documents')
    await expect(removeDocs).toBeFocused()
    await expectNoSilentClipping(page, `Participation, a refused removal, at ${width}px`)
    expect(writes).toEqual([
      { space: null, label: 'flow', ready: null, description: null },
      { space: null, label: 'docs', ready: null, description: null },
    ])
  })

  test(`a space changes a rule's answer alone and keeps the shared description at ${width}px`, async ({
    page,
  }) => {
    await installBackend(page)
    const { writes } = await installParticipation(page, {
      labels: {
        '': { flow: { ready: true, description: 'The main line of work' } },
        'MAIN': { flow: { ready: true, description: null } },
      },
    })
    await open(page, width)
    const flow = page.locator('[data-participation-label="flow"]')
    // In a space a rule is given back through «Own value», not removed.
    await expect(flow.getByRole('button', { name: /^Remove the rule/u })).toHaveCount(0)
    // The row's name names its answer, as every scoped row's does.
    const ready = flow.getByRole('switch', { name: 'flow own', exact: true })
    await ready.click()
    await expect(ready).toHaveAttribute('aria-checked', 'false')
    await expect(flow.getByRole('textbox', { name: 'Description of flow' })).toHaveValue(
      'The main line of work',
    )
    await expectNoSilentClipping(page, `Participation, a space rule's own answer, at ${width}px`)
    expect(writes).toEqual([{ space: 'MAIN', label: 'flow', ready: false, description: null }])
  })
}

test('the longest Russian words fit a phone, with a refused save', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await installBackend(page)
  await installParticipation(
    page,
    { own: { MAIN: { goal_close: 'human' } } },
    () => 'хранилище занято',
  )
  await open(page, 390)
  await expect(row(page, 'goal_close')).toContainText('Общее: Агент')
  await row(page, 'cancel_shared')
    .getByRole('switch', { name: /^Своё значение/u })
    .click()
  await expect(row(page, 'cancel_shared').getByRole('alert')).toHaveText(
    'Не сохранено: хранилище занято',
  )
  await expectNoSilentClipping(page, 'Participation in Russian at 390px')
})

/**
 * A choice wider than half its row reaches toward the name rather than wrapping: held to half
 * the row, the set's four segments put the last on a second line at 1280px, and the scope's
 * and the launch place's two did at 1024px.
 */
for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 1024] as const)
    test(`the scope, the set and the launch place each stand on one line at ${width}px in ${locale}`, async ({
      page,
    }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await installBackend(page)
      await installParticipation(page)
      await open(page, width)
      await expect(row(page, 'launch').getByRole('radio').first()).toBeVisible()
      const lines = await page.evaluate(() =>
        Object.fromEntries(
          [
            ['scope', '.settings-row:has(.settings-scope-segments)'],
            ['set', '[data-participation-row="set"]'],
            ['launch', '[data-participation-row="launch"]'],
          ].map(([name, selector]) => {
            const segments = document.querySelector(selector)?.querySelectorAll('[role="radio"]')
            const tops = [...(segments ?? [])].map((one) =>
              Math.round(one.getBoundingClientRect().top),
            )
            return [name, new Set(tops).size]
          }),
        ),
      )
      expect(lines).toEqual({ scope: 1, set: 1, launch: 1 })
    })

const ground = (place: Locator) => place.evaluate((one) => getComputedStyle(one).backgroundColor)

/** A segment not pressed takes a ground under the pointer, a step under the pressed one's. */
test('a segment under the pointer takes the hovered ground', async ({ page }) => {
  await installBackend(page)
  await installParticipation(page)
  await open(page, 1280)
  const set = row(page, 'set')
  const segment = set.locator('[role="radio"][aria-checked="false"]').first()
  const rest = await ground(segment)
  await segment.hover()
  await expect.poll(() => ground(segment)).not.toBe(rest)
  expect(await ground(segment)).not.toBe(await ground(checked(set)))
})
