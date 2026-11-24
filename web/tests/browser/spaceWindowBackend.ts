/**
 * A double of the space window's server: its four endpoints, the shell's context and the
 * directory of every space, answered from one held state of spaces and registered projects
 * that a save changes as the real one does (`docs/connection-contract.md`, «The owner's space
 * window»). Everything else is `installBackend`'s.
 */
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { dataScopeId, globalScope } from './planningFixtures.ts'

interface DoubleSpace {
  /** It has issued a number, so its key is locked. */
  issued: boolean
  items: number
  key: string
  name: string
}

interface DoubleProject {
  default: boolean
  display_name: string
  project_id: string
  root: string
  space: string | null
}

type Body = Record<string, unknown>
type Answer = { json: unknown; status: number }

const project = (id: string, space: string | null, isDefault = false): DoubleProject => ({
  project_id: id,
  display_name: id,
  root: `D:/code/${id}`,
  space,
  default: isDefault,
})

/** The spaces and the registry as the double holds them, and every save it was sent. */
export function spaceWindowWorld() {
  return {
    spaces: [
      { key: 'ATL', name: 'Atlas', issued: true, items: 214 },
      { key: 'NW', name: 'Northwind', issued: true, items: 58 },
      { key: 'DRF', name: 'Drafts', issued: false, items: 0 },
    ] as DoubleSpace[],
    projects: [
      project('atlas-web', 'ATL', true),
      project('atlas-api', 'ATL'),
      project('lighthouse', null),
      project('nw-app', 'NW', true),
      project('nw-tools', 'NW'),
    ],
    saves: [] as Body[],
    /** The registry's reason for refusing the next save's binding, once: `busy` for a held lock. */
    registryRefuses: null as string | null,
    /** The code the next save is refused with as a whole, once, before anything is written. */
    saveRefuses: null as string | null,
  }
}
type World = ReturnType<typeof spaceWindowWorld>

/**
 * The names of the long space's projects, in the order a reader sorts them: three wrap onto
 * more lines than one at every width the spec opens, and every one sits deep in folders that
 * start alike, its last folder its own.
 */
export const LONG_SPACE_NAMES = [
  'Archive of signed agreements and their scanned appendices',
  'Billing',
  'Customer onboarding portal with partner integrations and single sign-on',
  'Design tokens',
  'Field service scheduling',
  'Internal tools',
  'Mobile companion',
  'Nightly reconciliation of ledgers across every regional branch office',
  'Release notes',
  'Search indexer',
  'Telemetry',
  'Warehouse',
] as const

/** Where every project of the long space sits, one folder of its own deeper. */
const LONG_ROOT = 'D:/work/clients/northern-region/shared-services/archived-and-active-projects'

/** The folder a long space's project sits in: short, and different from every other's. */
export const longFolderOf = (name: string) => name.split(' ')[0]?.toLowerCase() ?? name

/**
 * `spaceWindowWorld` with one more space, LNG: an empty one whose key can still change, so its
 * window offers Remove beside the way out and the save, holding twelve projects of long names
 * and deep folders. Two more projects stand in no space, one whose folder's path names the
 * other and runs on with no space or hyphen a line could break at.
 */
export function longSpaceWorld() {
  const state = spaceWindowWorld()
  state.spaces.push({ key: 'LNG', name: 'Long-running client programme', issued: false, items: 0 })
  // Registered in the reverse of their names' order, as projects join a space in any order.
  const members = LONG_SPACE_NAMES.map((name, index) => ({
    project_id: `long-${String(index + 1)}`,
    display_name: name,
    root: `${LONG_ROOT}/${longFolderOf(name)}`,
    space: 'LNG',
    default: index === 0,
  }))
  state.projects.push(
    ...members.reverse(),
    {
      ...project('harbor', null),
      display_name: 'Harbor docs',
      root: 'D:/work/clients/NorthernRegion/LighthouseArchivedDocumentationAndHandbooks/HarborDocs',
    },
    { ...project('lighthouse-app', null), display_name: 'Lighthouse app' },
  )
  return state
}

/** Projects in no space, each name of several words and none wider than the narrowest line. */
export const UNPLACED_NAMES = [
  'Customer onboarding portal',
  'Archive of old prototypes',
  'Command line companion',
  'Nightly ledger reconciliation',
] as const

/**
 * `spaceWindowWorld` with four more projects in no space; with `empty`, its spaces gone and
 * every project in none, as on a store that has no space yet.
 */
export function unplacedWorld(empty = false) {
  const state = spaceWindowWorld()
  if (empty) {
    state.spaces = []
    for (const one of state.projects) Object.assign(one, { space: null, default: false })
  }
  const loose = UNPLACED_NAMES.map((name, index) => ({
    ...project(`loose-${String(index + 1)}`, null),
    display_name: name,
  }))
  state.projects.push(...loose)
  return state
}

export const spaceRefOf = (key: string) => ({ data_scope_id: dataScopeId, space_key: key })
const membersOf = (state: World, key: string) => state.projects.filter((one) => one.space === key)
const named = ({ project_id, display_name }: DoubleProject) => ({ project_id, display_name })
const ok = (json: unknown): Answer => ({ status: 200, json })
const refusal = (code: string, status = 409): Answer => ({
  status,
  json: { error: { code, message: code } },
})
const saved = (operation: string, key: string | null, registry: object): Answer =>
  ok({ operation, space: null, space_ref: key === null ? null : spaceRefOf(key), registry })

function readyState(payload: object) {
  return { interface_version: 'valkama-ui-state', status: 'ready', payload }
}

function context(state: World) {
  return {
    interface_version: 'valkama-context',
    scope: globalScope,
    state: readyState({
      primary: { data_scope_id: dataScopeId, is_writable: true },
      spaces: state.spaces.map((space) => {
        const own = membersOf(state, space.key)
        return {
          data_scope_id: dataScopeId,
          space_key: space.key,
          name: space.name,
          default_project: own.find((one) => one.default)?.project_id ?? null,
          projects: own.map((one) => named(one)),
          other_space_projects: [],
        }
      }),
      ui_prefs: null,
    }),
  }
}

/** The directory of every space; with none, empty, as the server answers a store with none. */
function directory(state: World) {
  if (!state.spaces.length)
    return {
      interface_version: 'valkama-planning',
      scope: globalScope,
      state: {
        interface_version: 'valkama-ui-state',
        status: 'empty',
        reason: 'platform.planning.noSpaces',
      },
    }
  return {
    interface_version: 'valkama-planning',
    scope: globalScope,
    state: readyState({
      planning_spaces: [],
      spaces: state.spaces.map((space) => ({
        space_ref: spaceRefOf(space.key),
        title: space.name,
        work_item_count: space.items,
        numbers: { triage: 0, ready: 0, active: 0, waiting_owner: 0 },
        numbers_absent: null,
        default_project: null,
        projects: membersOf(state, space.key).map((one) => named(one)),
      })),
    }),
  }
}

function registered(state: World) {
  return {
    registry: { status: 'available', reason: '' },
    projects: state.projects.map((one) => ({
      project_id: one.project_id,
      display_name: one.display_name,
      root: one.root,
      space: one.space === null ? null : spaceRefOf(one.space),
      default: one.default,
    })),
  }
}

/** The double's own key rule: the name's first three Latin letters, or none from other letters. */
function derivedKey(name: string) {
  const letters = name.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '')
  return /^[A-Z]/u.test(letters)
    ? { key: letters.slice(0, 3), refusal: null }
    : { key: null, refusal: { code: 'key_underivable', message: 'no key' } }
}

function form(state: World, key: string | null) {
  const space = state.spaces.find((one) => one.key === key)
  return {
    space:
      space === undefined
        ? null
        : { name: space.name, key: space.key, key_locked: space.issued, work_items: space.items },
    workflow: { name: 'Delivery', states: 9 },
  }
}

function removeSpace(state: World, space: DoubleSpace): Answer {
  if (space.items) return refusal('space_not_empty')
  state.spaces = state.spaces.filter((one) => one !== space)
  for (const one of membersOf(state, space.key)) Object.assign(one, { space: null, default: false })
  return saved('removed', null, { status: 'written' })
}

/** The registry's part of a creation or an edit: register the new projects, bind the listed. */
function bind(state: World, key: string, body: Body) {
  for (const fresh of (body.new_projects ?? []) as Record<string, string>[])
    state.projects.push({
      project_id: fresh.project_id ?? '',
      display_name: fresh.display_name ?? '',
      root: fresh.canonical_root ?? '',
      space: null,
      default: false,
    })
  for (const one of membersOf(state, key)) Object.assign(one, { space: null, default: false })
  for (const member of body.projects as { default: boolean; project_id: string }[]) {
    const one = state.projects.find((project) => project.project_id === member.project_id)
    if (one) Object.assign(one, { space: key, default: member.default })
  }
}

/** The save as the server makes it: the store's part, then the registry's, which may refuse. */
function save(state: World, body: Body): Answer {
  const whole = state.saveRefuses
  state.saveRefuses = null
  if (whole) return refusal(whole)
  const edited = body.space as { space_key: string } | undefined
  const space = edited && state.spaces.find((one) => one.key === edited.space_key)
  if (edited && !space) return refusal('space_missing', 404)
  if (body.remove === true && space) return removeSpace(state, space)
  const key = String(body.key)
  if (state.spaces.some((one) => one.key === key && one !== space)) return refusal('key_taken')
  const operation = space ? 'edited' : 'created'
  const target = space || { key, name: '', issued: false, items: 0 }
  if (!space) state.spaces.push(target)
  target.name = String(body.name)
  for (const one of membersOf(state, target.key)) one.space = key
  target.key = key
  const refused = state.registryRefuses
  state.registryRefuses = null
  if (refused)
    return saved(operation, key, { status: 'refused', reason: refused, message: 'another writer' })
  bind(state, key, body)
  return saved(operation, key, { status: 'written' })
}

const query = (url: string, name: string) => new URL(url).searchParams.get(name)

/** Answer the window's reads and its save, the context and the directory, from `state`. */
export async function installSpaceWindowBackend(page: Page, state: World) {
  await installBackend(page)
  await page.route('**/api/platform/context*', (route) => route.fulfill(ok(context(state))))
  await page.route('**/api/platform/planning?*', (route) =>
    query(route.request().url(), 'directory_only') === 'true'
      ? route.fulfill(ok(directory(state)))
      : route.fallback(),
  )
  await page.route('**/api/planning/projects', (route) => route.fulfill(ok(registered(state))))
  await page.route('**/api/planning/space/key?*', (route) =>
    route.fulfill(ok(derivedKey(query(route.request().url(), 'name') ?? ''))),
  )
  await page.route('**/api/planning/space/form*', (route) =>
    route.fulfill(ok(form(state, query(route.request().url(), 'space')))),
  )
  await page.route('**/api/planning/space/save', (route) => {
    const body = route.request().postDataJSON() as Body
    state.saves.push(body)
    return route.fulfill(save(state, body))
  })
}
