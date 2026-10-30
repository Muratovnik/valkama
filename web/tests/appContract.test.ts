import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { test } from 'vitest'

import { compactCss } from './support/source.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = source('../src/app/App.vue')
const navigation = source('../src/app/composables/usePlatformNavigation.ts')
const contextBar = source('../src/app/components/AppContextBar.vue')
const planningSurface = source('../src/pages/planning/PlanningModuleSurface.vue')
const moduleStage = source('../src/app/components/AppModuleStage.vue')
const entryRestore = source('../src/app/composables/usePlatformEntryRestore.ts')
const readModels = source('../src/app/composables/usePlatformReadModels.ts')
const liveFeed = source('../src/app/composables/usePlatformLiveFeed.ts')
const sessionWorkItemRoute = source('../src/features/session-open/sessionWorkItemRoute.ts')
const moduleAuthority = source('../src/app/composables/useModuleRouteAuthority.ts')
const api = source('../src/shared/api/platformApi.ts')
const planningApi = source('../src/shared/api/platformPlanningApi.ts')
const coreApi = source('../src/shared/api/api.ts')
const nav = source('../src/widgets/app-nav/components/AppNav.vue')
const inspector = source('../src/widgets/work-item-inspector/components/WorkItemInspector.vue')
const overview = source('../src/widgets/work-item-inspector/components/InspectorOverview.vue')
const sourceReference = source('../src/shared/lib/sourceReference.ts')
const inspectorMemory = source('../src/widgets/work-item-inspector/components/InspectorMemory.vue')
const workspace = source('../src/pages/planning/PlanningWorkspace.vue')
const portfolio = source('../src/pages/planning/PlanningPortfolio.vue')
const itemList = source('../src/widgets/work-item-views/components/WorkItemList.vue')
const segmented = source('../src/shared/ui/SegmentedControl.vue')
const settings = source('../src/pages/settings/SettingsView.vue')
const settingsModules = source('../src/pages/settings/components/SettingsModules.vue')

test('platformRoute is the sole route owner for the six-module shell', () => {
  assert.match(navigation, /resolvePlatformRoute/)
  assert.match(navigation, /serializePlatformRoute/)
  // Normal routing resolves the active manifest only from validated server rows.
  assert.doesNotMatch(app, /builtinManifest|OFFLINE_MODULE_FALLBACK/)
  assert.match(moduleAuthority, /registrations\.value\.find/)
  assert.match(nav, /navigation_group/)
  assert.match(nav, /platform\.navigation\.groups/)
  assert.doesNotMatch(app, /moduleRoute|kanban-scope:|improvements_scope/)
  assert.doesNotMatch(nav, /useStorage|localStorage|navigation-collapsed|epic-index-collapsed/)
})

test('one explicit operating-scope grammar owns Global, Project, and neutral resources', () => {
  assert.match(contextBar, /platform\.scope\.label/)
  assert.match(app, /switchScope/)
  assert.match(app, /availableProjectResources/)
  assert.match(app, /selectResource/)
  assert.match(
    app,
    /selectableProjectResources\(activeManifest\.value, mappedProjectResources\.value\)/,
  )
  assert.match(app, /resolveResourceSelection\(activeManifest\.value, route\.value, selected\)/)
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
    assert.match(endpoints, new RegExp(endpoint.replaceAll('/', '\\/')))
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

test('source opening carries only canonical Planning-space authority', () => {
  assert.match(planningSurface, /boundSpaceResourceRef/)
  assert.match(planningSurface, /planningSpaceEntity\(space\)/)
  assert.match(planningSurface, /:resource-ref="boundSpaceResourceRef"/)
  assert.match(inspector, /:resource-ref="resourceRef"/)
  assert.match(
    overview,
    /openSourceReference\(\{\s*source: props\.item\.source,\s*resource_ref: props\.resourceRef,?\s*\}\)/,
  )
  assert.match(sourceReference, /openSource\(request\)/)
  assert.match(sourceReference, /clipboard\.writeText\(request\.source\)/)
  assert.doesNotMatch(`${planningSurface}\n${inspector}\n${overview}`, /sourceRoot|source_root/)
})

test('session navigation refuses ambiguous project ownership', () => {
  assert.match(sessionWorkItemRoute, /binding_state === 'mapped'/)
  assert.match(sessionWorkItemRoute, /resolveManifestRouteAuthority/)
  assert.match(sessionWorkItemRoute, /planningWorkItemEntity\(\{ space_ref: space, reference \}/)
  assert.match(sessionWorkItemRoute, /resource_ref\.resource_id === resourceRef\.resource_id/)
  assert.match(sessionWorkItemRoute, /candidates\.length !== 1/)
  assert.match(app, /resolveSessionWorkItemRoute\(/)
  assert.doesNotMatch(liveFeed, /kind: 'work-item'/)
})

test('Settings switches modules from the module registrations alone', () => {
  assert.match(settings, /<SettingsModules/)
  assert.match(moduleStage, /:module-registrations="moduleRegistrations"/)
  assert.match(settingsModules, /setModuleState\(/)
  assert.match(settingsModules, /<ToggleSwitch/)
  assert.match(settingsModules, /registration\.mutable/)
  assert.doesNotMatch(`${settings}\n${settingsModules}`, /registry|assignment|grant/i)
  assert.doesNotMatch(settings, /listIntegrations|updateIntegration|\/api\/integrations/)
})

test('planning projects three views from one read of the space', () => {
  // The three views take the same model apart rather than each fetching their
  // own: one `/api/planning` answer carries the workflow, the items and the links.
  assert.match(planningSurface, /fetchPlanning\(\{ project, \.\.\.space \}\)/)
  assert.match(workspace, /<WorkItemBoard/)
  assert.match(workspace, /<WorkItemList/)
  assert.match(workspace, /<WorkItemGraph/)
  assert.match(workspace, /:items="visibleItems"/)
  assert.doesNotMatch(workspace, /fetchPlanning|fetchPlanningGraph|secureFetch/)
  assert.match(planningSurface, /transitionWorkItem/)
  // `openProject` is the portfolio's own event; the surface's part is routing it on.
  assert.match(planningSurface, /<PlanningPortfolio/)
  assert.match(planningSurface, /'open-project': \[projectId: string\]/)
  // An opened item is a route, not module state: that is what makes it survive a
  // reload and what makes Back close it.
  assert.match(planningSurface, /planningWorkItemEntity\(\{ space_ref: space, reference \}\)/)
  assert.doesNotMatch(planningSurface, /open\.value = /)
  assert.match(portfolio, /platform\.planning\.openProject/)
  assert.match(portfolio, /serializePlatformRoute/)
  assert.match(portfolio, /platform\.planning\.reviewBinding/)
  assert.doesNotMatch(portfolio, /:disabled=/)
  assert.match(itemList, /workItem\.listEmpty/)
  assert.doesNotMatch(planningSurface, /fetchDashboard|fetchBoard/)
})

test('clean entry restores the last server-side route without legacy storage', () => {
  assert.match(navigation, /isCleanEntry/)
  assert.match(app, /entryRestorePending/)
  assert.match(app, /usePlatformEntryRestore/)
  assert.match(entryRestore, /restoredEntryRoute/)
  assert.match(entryRestore, /savePlatformUiPrefs/)
  // The restored destination must still resolve, or the app lands on a dead one.
  assert.match(entryRestore, /binding_state === 'mapped'/)
  assert.match(entryRestore, /modulesSettled/)
  assert.match(contextBar, /resourceOptions\.length > 1/)
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
    source('../src/shared/api/platformEntityRef.ts'),
    source('../src/shared/api/platformApiTypes.ts'),
    source('../src/shared/api/platformContextPayload.ts'),
    source('../src/shared/api/platformRoute.ts'),
  ]) {
    assert.doesNotMatch(genericSource, /BoardRef|CardRef|board_name|board_ref|card_ref/)
  }
  assert.doesNotMatch(source('../src/shared/api/platformRoute.ts'), /LEGACY_QUERY_KEYS/)
  // Planning's ref grammar has exactly one owner. The live feed is left out of
  // this list on purpose: resolving an activity row to a project *is* reading
  // that grammar, and it reads it through the module above rather than by
  // re-deriving a key from a string.
  for (const genericSource of [
    app,
    contextBar,
    moduleStage,
    navigation,
    entryRestore,
    readModels,
    source('../src/shared/api/platformEntityRef.ts'),
    source('../src/shared/api/platformRoute.ts'),
  ]) {
    assert.doesNotMatch(genericSource, /PlanningSpaceRef|WorkItemRef|space_key/)
  }
  assert.match(source('../src/shared/api/platformPlanningRefs.ts'), /PlanningSpaceRef|WorkItemRef/)
  assert.match(moduleAuthority, /resolveManifestRouteAuthority/)
  assert.match(entryRestore, /resolveManifestRouteAuthority/)
})

test('the shell read models own no generation bookkeeping of their own', () => {
  // Newest-wins is a property of resourceState now, and platformReadModels.test.ts
  // proves it by interleaving two requests rather than by matching source text.
  assert.doesNotMatch(readModels, /Generation\b/)
  assert.match(readModels, /resourceState\.ts/)
})

test('common responsive controls keep keyboard focus and 44px targets', () => {
  // The context bar measures the space it was given rather than the window: the
  // rail beside it is 260px or 64px, so the same 1024px screen hands the bar
  // 764px or 960px and only one of those was ever the tested one.
  assert.match(compactCss(contextBar), /@containermain\(width<=764px\)/)
  assert.match(compactCss(contextBar), /@containermain\(width<=586px\)/)
  // The inspector's section switch is the shared segmented control rather than a
  // tablist of its own, so the row it stands in is the primitive's answer. It
  // lives in the shared frame now, with the two writes it sits beside.
  assert.match(inspector, /<SegmentedControl/)
  assert.match(
    compactCss(segmented),
    /\.segmented-option\{[^}]*min-height:calc\(var\(--size-control-height\)/,
  )
})
