/**
 * «Project» in the list, drawn by the rule of a tile's project mark: the space has
 * several projects and «All projects» is chosen. It names the one project of the space a
 * row changes, «Several projects» for work naming more than one, as the board's lane by
 * project does, and a dash for work naming none; another space's card is named by this
 * space's projects alone. The list by project names a row's project by its group and draws
 * no such column. It folds with «Goal and stage» and follows the path on the line under
 * the title.
 */
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'

import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import { boardId, boardItem, boardWorkflow } from '../fixtures/board.ts'

const named = (id: string, name: string) => ({
  project_id: id,
  display_name: name,
  source: 'named' as const,
})
const PROJECTS = [
  { project_id: 'alpha', display_name: 'Alpha app' },
  { project_id: 'beta', display_name: 'Beta lib' },
]

const goal = boardItem(1, 'backlog', { kind: 'goal', title: 'Launch' })
const space = [
  goal,
  boardItem(2, 'backlog', { parent_id: boardId(1), projects: [named('alpha', 'Alpha app')] }),
  boardItem(3, 'backlog', {
    projects: [named('alpha', 'Alpha app'), named('beta', 'Beta lib')],
  }),
  boardItem(4, 'backlog'),
  {
    // Another space's card names a project of its own space beside this one's.
    ...boardItem(5, 'backlog', {
      other_space: { key: 'OTHER', name: 'Other' },
      projects: [named('beta', 'Beta lib'), named('gamma', 'Their own')],
    }),
    reference: 'OTHER-5',
  },
]
const BY_REFERENCE = { key: 'reference', descending: false } as const

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

const i18n = () => createI18n({ legacy: false, locale: 'en', messages })
const heads = () => [...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim())
const rows = () => [...document.querySelectorAll<HTMLElement>('tbody tr')]
const referenceOf = (row: HTMLElement) =>
  row.dataset.reference ?? row.querySelector<HTMLElement>('[data-reference]')?.dataset.reference
const rowOf = (reference: string) => rows().find((row) => referenceOf(row) === reference)
const projectCells = () =>
  Object.fromEntries(
    rows().map((row) => [
      referenceOf(row),
      row.querySelector('.list-project')?.textContent?.trim(),
    ]),
  )

async function list(props: Partial<InstanceType<typeof WorkItemList>['$props']>) {
  const wrapper = mount(WorkItemList, {
    attachTo: document.body,
    global: { plugins: [i18n()] },
    props: { items: space, links: [], sort: BY_REFERENCE, ...props },
  })
  await flushPromises()
  return wrapper
}

/** The list at `width` pixels of its own, as the list reads its box. */
async function at(width: number, run: () => Promise<void>) {
  const held = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  })
  try {
    await run()
  } finally {
    if (held) Object.defineProperty(HTMLElement.prototype, 'clientWidth', held)
  }
}

describe('the project column', () => {
  it('stands after «Goal and stage» and names what each row changes', async () => {
    await list({ projects: PROJECTS })
    expect(heads().slice(0, 4)).toEqual(['Ref', 'Title', 'Goal and stage', 'Project'])
    expect(projectCells()).toEqual({
      'MAIN-1': '—',
      'MAIN-2': 'Alpha app',
      'MAIN-3': 'Several projects',
      'MAIN-4': '—',
      'OTHER-5': 'Beta lib',
    })
  })

  it('is not drawn where the host gives no projects', async () => {
    await list({})
    expect(heads()).not.toContain('Project')
    expect(document.querySelector('.list-project')).toBeNull()
  })

  it('is not drawn in the list by project, whose groups name it', async () => {
    await list({
      projects: PROJECTS,
      tree: { filtered: false, grouping: 'project', projects: PROJECTS, scope: space, space: 'm' },
    })
    expect(heads()).not.toContain('Project')
    expect(rowOf('group:projects:several')).toBeDefined()
  })

  it('stands in the tree by goal, which draws no «Goal and stage»', async () => {
    await list({ projects: PROJECTS, tree: { filtered: false, scope: space, space: 'm' } })
    expect(heads().slice(0, 3)).toEqual(['Ref', 'Title', 'Project'])
  })

  // A list of 1000px folds both columns alone; one of 700px folds the state, the
  // priority and the holder with them into a line of facts.
  for (const [width, fit] of [
    [1000, 'wide'],
    [700, 'medium'],
  ] as const) {
    it(`folds with «Goal and stage» and follows the path under the title of a ${fit} list`, () =>
      at(width, async () => {
        const wrapper = await list({ projects: PROJECTS })
        expect(document.querySelector<HTMLElement>('.work-item-list')?.dataset.fit).toBe(fit)
        expect(heads()).not.toContain('Project')
        expect(document.querySelector('.list-project')).toBeNull()
        const facts = rowOf('MAIN-2')?.querySelector('.list-title > .list-facts')
        const [path, project] = [...(facts?.querySelectorAll('.list-fact') ?? [])]
        expect(path?.textContent?.trim()).toBe('Launch')
        expect(project?.textContent?.trim()).toBe('Alpha app')
        // Work naming none says nothing there: the dash is the column's word.
        expect(rowOf('MAIN-4')?.querySelector('.list-title')?.textContent).not.toContain('—')
        // Its sort rides the title's heading, after the goal's: a button where the two fold
        // alone, an option of the one choice where the state, the priority and the holder fold too.
        const sorts =
          fit === 'wide'
            ? [...document.querySelectorAll('thead .list-sort.folded')].map((sort) =>
                sort.textContent?.trim(),
              )
            : (
                wrapper.getComponent(ChoiceSelect).props() as { options: { label: string }[] }
              ).options.map((option) => option.label)
        expect(sorts.slice(0, 2)).toEqual(['Goal and stage', 'Project'])
      }))
  }
})

const model = (projects: number): PlanningReadModel => ({
  interface_version: 'valkama-planning-read-model',
  planning_spaces: [],
  planning_space: {
    planning_space_id: boardId(800),
    name: 'Main',
    key: 'MAIN',
    provider_kind: 'local',
    launch_place: 'space',
    projects: PROJECTS.slice(0, projects).map((project, index) => ({
      ...project,
      root: `C:/${project.project_id}`,
      default: index === 0,
    })),
    default_project: 'alpha',
  },
  workflow: boardWorkflow,
  work_items: space,
  links: [],
  stale_claims: [],
})

/** The workspace's list over a space of `projects` projects, narrowed to `project` if named. */
async function workspace(projects: number, project?: string) {
  mount(PlanningWorkspace, {
    attachTo: document.body,
    props: {
      model: model(projects),
      project,
      routeState: undefined,
      stale: false,
      stateBytes: 2048,
      version: 1,
      viewPlace: 'scope:MAIN',
      view: 'list',
      writable: true,
    },
    global: { plugins: [i18n()] },
  })
  await flushPromises()
}

describe('when the workspace names the projects', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('draws «Project» in a space of several projects with «All projects» chosen', async () => {
    await workspace(2)
    expect(heads()).toContain('Project')
  })

  it('draws none once a project is chosen', async () => {
    await workspace(2, 'alpha')
    expect(heads()).not.toContain('Project')
  })

  it('draws none in a space of one project', async () => {
    await workspace(1)
    expect(heads()).not.toContain('Project')
  })
})
