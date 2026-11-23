/**
 * The shell's ownership rules that hold as text.
 *
 * Each check reads a file as code, comments taken out: a door the shell must not
 * have (an endpoint, a storage key, a retired name) is absent, a contract string the
 * server answers on is present, and a rule with one owner is reached through that
 * owner's exported function. How a route, a session or an entry resolves is the
 * behaviour tests' to say, and a comment beside a test here names the test that says it.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { declarationsOf, sourceCode } from './support/source.ts'

const app = sourceCode('app/App.vue')
const navigation = sourceCode('app/composables/usePlatformNavigation.ts')
const contextBar = sourceCode('app/components/AppContextBar.vue')
const planningSurface = sourceCode('pages/planning/PlanningModuleSurface.vue')
const routeSelection = sourceCode('pages/planning/composables/usePlanningRouteSelection.ts')
const moduleStage = sourceCode('app/components/AppModuleStage.vue')
const entryRestore = sourceCode('app/composables/usePlatformEntryRestore.ts')
const readModels = sourceCode('app/composables/usePlatformReadModels.ts')
const liveFeed = sourceCode('app/composables/usePlatformLiveFeed.ts')
const sessionOpening = sourceCode('app/composables/useSessionOpening.ts')
const moduleAuthority = sourceCode('app/composables/useModuleRouteAuthority.ts')
const api = sourceCode('shared/api/platformApi.ts')
const planningApi = sourceCode('shared/api/platformPlanningApi.ts')
const coreApi = sourceCode('shared/api/api.ts')
const nav = sourceCode('widgets/app-nav/components/AppNav.vue')
const inspector = sourceCode('widgets/work-item-inspector/components/WorkItemInspector.vue')
const inspectorTabs = sourceCode('shared/ui/TabStrip.vue')
const overview = sourceCode('widgets/work-item-inspector/components/InspectorOverview.vue')
const identity = sourceCode('widgets/work-item-inspector/components/InspectorIdentity.vue')
const inspectorMemory = sourceCode('widgets/work-item-inspector/components/InspectorMemory.vue')
const workspace = sourceCode('pages/planning/PlanningWorkspace.vue')
const portfolio = sourceCode('pages/planning/PlanningPortfolio.vue')
const itemList = sourceCode('widgets/work-item-views/components/WorkItemList.vue')
const segmented = sourceCode('shared/ui/SegmentedControl.vue')
const settings = sourceCode('pages/settings/SettingsView.vue')

/** A call of `name`, which an import or a type alone does not satisfy. */
const calls = (name: string) => new RegExp(`\\b${name}\\(`)
/** A component tag a template renders, with or without attributes. */
const renders = (tag: string) => new RegExp(`<${tag}(?=[\\s/>])`)

test('platformRoute is the sole route owner for the six-module shell', () => {
  assert.match(navigation, calls('resolvePlatformRoute'))
  assert.match(navigation, calls('serializePlatformRoute'))
  // Normal routing resolves the active manifest only from validated server rows: a
  // route checked against the manifest that answers it is platformModules.test.ts.
  assert.doesNotMatch(app, /builtinManifest|OFFLINE_MODULE_FALLBACK/)
  assert.match(nav, /\bnavigation_group\b/)
  assert.match(nav, /platform\.navigation\.groups/)
  assert.doesNotMatch(app, /moduleRoute|kanban-scope:|improvements_scope/)
  assert.doesNotMatch(nav, /useStorage|localStorage|navigation-collapsed|goal-index-collapsed/)
})

test('one explicit operating-scope grammar owns every space, a space and its project', () => {
  assert.match(contextBar, /platform\.scope\.label/)
  assert.match(contextBar, /platform\.scope\.project/)
  // The shell renders the bar its spaces; which spaces and projects the bar offers
  // and what a pick does is components/appContextBar.spec.ts.
  assert.match(app, renders('AppContextBar'))
  assert.doesNotMatch(
    app,
    /scope_kind:\s*['"]all['"]|\?scope=|\?board=|localStorage\.getItem\([^)]*scope/,
  )
})

test('the frontend consumes only the frozen Platform API endpoints', () => {
  const endpoints = `${api}\n${planningApi}`
  for (const endpoint of [
    '/api/modules',
    '/api/platform/context',
    '/api/platform/planning',
    '/api/modules/planning/work-item',
    '/api/platform/ui-prefs',
  ])
    assert.ok(endpoints.includes(endpoint), endpoint)
  // The extension registry and the commands that wrote through it are not the
  // web client's to call: no Settings screen or inspector panel reads them.
  assert.doesNotMatch(
    endpoints,
    /\/api\/platform\/(?:registry|relations|actions|assignments|grants)/,
  )
  assert.doesNotMatch(endpoints, /\/api\/integrations|platform-modules['"]|compat|fallback route/i)
  assert.doesNotMatch(endpoints, /\/api\/platform\/card|valkama-card/)
  assert.doesNotMatch(coreApi, /\/api\/dashboard|fetchDashboard|subscribeDashboard/)
  // The core surface answered the Board domain on four routes; the cutover moved
  // every one of them under `/api/planning`, so a survivor here is a second door
  // into a store that no longer has that shape.
  assert.doesNotMatch(coreApi, /\/api\/board|\/api\/card|\/api\/move|\/api\/boards/)
  assert.doesNotMatch(app, /fetchDashboard|exactProjectBoardName|primaryProjectBoard/)
})

test('the inspector reads no extension registry', () => {
  // Relations between work items are Planning's own; nothing outside Valkama is
  // attached or opened from the inspector, and attached memory is a pointer
  // shown by label and id rather than a provider the inspector resolves.
  assert.doesNotMatch(inspector, /KernelRelationsPanel|registry|kernel/i)
  assert.doesNotMatch(inspector, /groupReferences|relatedMemories|AgentMemory|agentmemory/i)
  assert.doesNotMatch(inspectorMemory, /registry|referenceProvider|agentmemory/i)
})

test('a plan anchor is asked about under the exact Planning space of its card', () => {
  // The surface names its space through its route selection, which builds it with
  // Planning's ref grammar. The head asking about a path under the card's own space,
  // and what pressing it does, is components/inspectorSource.spec.ts.
  assert.match(planningSurface, calls('usePlanningRouteSelection'))
  assert.match(routeSelection, calls('planningSpaceEntity'))
  assert.doesNotMatch(
    `${planningSurface}\n${inspector}\n${overview}\n${identity}`,
    /sourceRoot|source_root/,
  )
})

test('session navigation opens only a space this workstation lists', () => {
  // Only a space this workstation lists, held exactly, resolves a session's item,
  // and an unlisted one is refused: sessionWorkItemRoute.test.ts. The shell reaches that
  // resolver through its session-opening composable.
  assert.match(sessionOpening, calls('resolveSessionWorkItemRoute'))
  assert.match(app, calls('useSessionOpening'))
  assert.doesNotMatch(liveFeed, /kind: 'work-item'/)
})

test('Settings changes nothing about which modules exist', () => {
  // The module list is the build's: no section, prop or request can switch one.
  assert.doesNotMatch(settings, /SettingsModules|workspace|ToggleSwitch|setModuleState/)
  assert.doesNotMatch(moduleStage, /module-registrations|reload-modules/)
  assert.doesNotMatch(settings, /registry|assignment|grant/i)
  assert.doesNotMatch(settings, /listIntegrations|updateIntegration|\/api\/integrations/)
})

test('planning projects three views from one read of the space', () => {
  // The three views take the same model apart rather than each fetching their
  // own: one `/api/planning` answer carries the workflow, the items and the links.
  assert.match(planningSurface, calls('fetchPlanning'))
  assert.match(workspace, renders('WorkItemBoard'))
  assert.match(workspace, renders('WorkItemList'))
  assert.match(workspace, renders('WorkItemGraph'))
  assert.doesNotMatch(workspace, /fetchPlanning|fetchPlanningGraph|secureFetch/)
  // A board move is written by the surface's moves, as a transition alone: the
  // server computes the order of work, and nothing places an item by hand:
  // planningMoves.test.ts.
  assert.match(planningSurface, calls('usePlanningMoves'))
  // `open-space` is the portfolio's own event; the surface's part is routing it on.
  assert.match(planningSurface, renders('PlanningPortfolioFrame'))
  assert.match(planningSurface, /'open-space'\s*:\s*\[/)
  // An opened item is a route, not module state: that is what makes it survive a
  // reload and what makes Back close it.
  assert.match(planningSurface, calls('planningWorkItemEntity'))
  assert.doesNotMatch(planningSurface, /open\.value = /)
  assert.match(portfolio, /platform\.planning\.openSpace/)
  assert.doesNotMatch(portfolio, /:disabled=/)
  assert.match(itemList, /workItem\.listEmpty/)
  assert.doesNotMatch(planningSurface, /fetchDashboard|fetchBoard/)
})

test('clean entry restores the last server-side route without legacy storage', () => {
  // A clean entry waiting for both reads, and the restored space and project still
  // resolving or falling back: platformEntryRestore.test.ts.
  assert.match(app, calls('usePlatformEntryRestore'))
  assert.match(entryRestore, calls('savePlatformUiPrefs'))
  // The bar offers a project only where there is a choice between two:
  // components/appContextBar.spec.ts.
  for (const shellSource of [app, entryRestore]) {
    assert.doesNotMatch(
      shellSource,
      /localStorage\.(?:get|set)Item\([^)]*(?:route|module|board|scope)/,
    )
  }
})

test('generic shell and contracts contain no Planning storage identity', () => {
  for (const genericSource of [
    app,
    contextBar,
    moduleStage,
    navigation,
    entryRestore,
    readModels,
    liveFeed,
    sourceCode('shared/api/platformEntityRef.ts'),
    sourceCode('shared/api/platformApiTypes.ts'),
    sourceCode('shared/api/platformContextPayload.ts'),
    sourceCode('shared/api/platformRoute.ts'),
  ]) {
    assert.doesNotMatch(genericSource, /BoardRef|CardRef|board_name|board_ref|card_ref/)
  }
  assert.doesNotMatch(sourceCode('shared/api/platformRoute.ts'), /LEGACY_QUERY_KEYS/)
  // Planning's ref grammar has exactly one owner. A scope names its space by the
  // space's own reference, which the shell passes on as it is; decoding an entity
  // into a space or an item is Planning's alone. The live feed is left out of this
  // list on purpose: resolving an activity row to a space *is* reading that grammar,
  // and it reads it through the module above rather than by re-deriving a key.
  for (const genericSource of [
    app,
    contextBar,
    moduleStage,
    navigation,
    entryRestore,
    readModels,
    sourceCode('shared/api/platformEntityRef.ts'),
    sourceCode('shared/api/platformRoute.ts'),
  ]) {
    assert.doesNotMatch(genericSource, /WorkItemRef|planningSpaceRef\(|planningWorkItemRef\(/)
  }
  assert.match(sourceCode('shared/api/platformPlanningRefs.ts'), /PlanningSpaceRef|WorkItemRef/)
  assert.match(moduleAuthority, calls('resolveManifestRouteAuthority'))
  assert.match(entryRestore, calls('resolveManifestRouteAuthority'))
})

test('the shell read models own no generation bookkeeping of their own', () => {
  // Newest-wins is a property of resourceState now, and platformReadModels.test.ts
  // proves it by interleaving two requests rather than by matching source text.
  assert.doesNotMatch(readModels, /Generation\b/)
  assert.match(readModels, /from '@\/shared\/api\/resourceState\.ts'/)
})

test('common responsive controls keep keyboard focus and 44px targets', () => {
  // The context bar measures the space it was given rather than the window: the
  // rail beside it is 260px or 64px, so the same 1024px screen hands the bar
  // 764px or 960px and only one of those was ever the tested one.
  assert.match(contextBar, /@container\s+main\s*\(\s*width\s*<=\s*764px\s*\)/)
  assert.match(contextBar, /@container\s+main\s*\(\s*width\s*<=\s*586px\s*\)/)
  // The inspector's section switch is the shared segmented control rather than a
  // tablist of its own, so the row it stands in is the primitive's answer. It
  // lives in the shared frame now, with the two writes it sits beside, as the
  // card's own strip of sections.
  assert.match(inspector, renders('TabStrip'))
  assert.match(inspectorTabs, renders('SegmentedControl'))
  assert.ok(
    declarationsOf(segmented, '.segmented-option').some((each) =>
      each.startsWith('min-height:calc(var(--size-control-height)'),
    ),
  )
})
