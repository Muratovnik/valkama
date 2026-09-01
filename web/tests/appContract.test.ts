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
const activityBell = source('../src/widgets/activity-bell/ActivityBell.vue')
const moduleAuthority = source('../src/app/composables/useModuleRouteAuthority.ts')
const api = source('../src/shared/api/platformApi.ts')
const planningApi = source('../src/shared/api/platformPlanningApi.ts')
const coreApi = source('../src/shared/api/api.ts')
const nav = source('../src/widgets/app-nav/components/AppNav.vue')
const inspector = source('../src/widgets/work-item-inspector/components/WorkItemInspector.vue')
const relations = source('../src/widgets/work-item-inspector/components/KernelRelationsPanel.vue')
const overview = source('../src/widgets/work-item-inspector/components/InspectorOverview.vue')
const sourceReference = source('../src/shared/lib/sourceReference.ts')
const relationList = source('../src/widgets/work-item-inspector/components/RelationList.vue')
const relationConfirm = source('../src/widgets/work-item-inspector/components/RelationConfirm.vue')
const attachRoutes = source('../src/widgets/work-item-inspector/utils/attachRoutes.ts')
const workspace = source('../src/pages/planning/PlanningWorkspace.vue')
const portfolio = source('../src/pages/planning/PlanningPortfolio.vue')
const itemList = source('../src/widgets/work-item-views/components/WorkItemList.vue')
const segmented = source('../src/shared/ui/SegmentedControl.vue')
const settings = source('../src/pages/settings/SettingsView.vue')
// Five assertions below are about what the registry does rather than which of
// its files does it, and the slice is read as one text for the same reason the
// skills slice is: a row that writes owns its own model now, so the switch and
// the call it drives sit one file down from the section that arranges them.
const registry = [
  'PlatformSettingsRegistry',
  'ProjectAssignmentsSection',
  'RegistryAssignmentToggle',
  'RegistryRow',
]
  .map((name) => source(`../src/widgets/settings-registry/components/${name}.vue`))
  .join('\n')
// How a connection reads is derived in the slice's composable and spent in its
// component, so the naming half of the registry contract is asserted there.
const registryLabels = source('../src/widgets/settings-registry/composables/useRegistryLabels.ts')
// The skills module is seven files, and what is asserted about it below is that
// it does not contain something. Reading one file would be satisfied by moving
// that thing to a sibling, so the whole slice is read as one text.
const skills = [
  'SkillsView',
  'SkillsToolbar',
  'SkillCatalogue',
  'SkillDetailDrawer',
  'SkillActivation',
  'SkillClientRow',
  'SkillPreview',
]
  .map((name) => source(`../src/pages/skills/components/${name}.vue`))
  .join('\n')

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
    '/api/platform/registry',
    '/api/platform/planning',
    '/api/modules/planning/work-item',
    '/api/platform/relations',
    '/api/platform/actions/invoke',
    '/api/platform/ui-prefs',
    '/api/platform/assignments/activation',
    '/api/platform/assignments/selection',
  ])
    assert.match(endpoints, new RegExp(endpoint.replaceAll('/', '\\/')))
  assert.doesNotMatch(endpoints, /\/api\/integrations|platform-modules['"]|compat|fallback route/i)
  assert.doesNotMatch(endpoints, /\/api\/platform\/card|valkama-card/)
  assert.doesNotMatch(coreApi, /\/api\/dashboard|fetchDashboard|subscribeDashboard/)
  // The core surface answered the Board domain on four routes; the cutover moved
  // every one of them under `/api/planning`, so a survivor here is a second door
  // into a store that no longer has that shape.
  assert.doesNotMatch(coreApi, /\/api\/board|\/api\/card|\/api\/move|\/api\/boards/)
  assert.doesNotMatch(app, /fetchDashboard|exactProjectBoardName|primaryProjectBoard/)
})

test('work-item relations are generic, descriptor-driven, and explicitly confirmed', () => {
  // The Kernel half of the section is the inspector's, not Overview's: what an
  // item points at outside Valkama sits beside what it points at inside.
  assert.match(inspector, /KernelRelationsPanel/)
  assert.doesNotMatch(overview, /KernelRelationsPanel|attachCandidates/)
  assert.match(attachRoutes, /descriptor\.operation !== 'attach'/)
  assert.match(relations, /stableId/)
  assert.match(relations, /confirmed/)
  assert.match(relations, /confirmation:\s*true/)
  assert.match(relations, /workItemRef\.space_ref\.data_scope_id/)
  assert.match(relations, /projectId/)
  assert.match(relations, /expected_revision/)
  assert.match(relations, /window\.open\(result\.target\.uri/)
  assert.doesNotMatch(inspector, /groupReferences|relatedMemories|AgentMemory|agentmemory/i)
  assert.doesNotMatch(relations, /agentmemory|notes\.invalid|provider\.adapter_id/)
})

test('attach eligibility mirrors exact connection and permission-grant authorization', () => {
  assert.match(attachRoutes, /registry\.connections\.find/)
  assert.match(attachRoutes, /connectionApplies\(candidate\.applicability, scope\)/)
  assert.match(
    attachRoutes,
    /applicability\.kind === 'global' \|\| scopeEquals\(applicability, invocationScope\)/,
  )
  assert.match(attachRoutes, /candidate\.state === 'registered'/)
  assert.match(attachRoutes, /candidate\.trust === 'trusted'/)
  assert.match(attachRoutes, /candidate\.health === 'ready'/)
  assert.match(attachRoutes, /connectionApplies\(candidate\.applicability, scope\)/)
  assert.match(attachRoutes, /grant\.permission_id === 'relation\.attach'/)
  assert.match(attachRoutes, /grant\.active/)
  assert.match(attachRoutes, /grant\.state === 'active'/)
  assert.match(attachRoutes, /grant\.entity_kinds\.includes\('adapter-resource'\)/)
  assert.match(attachRoutes, /grant\.data_scope_ids\.includes\(dataScopeId\)/)
  assert.match(relations, /props\.workItemRef\.space_ref\.data_scope_id/)
  assert.match(attachRoutes, /connectionEquals\(grant\.connection_ref, connectionRef\)/)
  assert.match(attachRoutes, /scopeEquals\(grant\.applicability, scope\)/)
})

test('planning writes fail closed outside the exact writable primary store', () => {
  assert.match(app, /primaryWriteScopeId/)
  // One derivation, spent in three places: the create action, the drag, and every
  // write the inspector makes. A view that decided for itself is how the Board
  // era ended up with three answers to one question.
  assert.match(planningSurface, /props\.primaryWriteScopeId === boundSpace\.value\.data_scope_id/)
  assert.match(planningSurface, /boundSpace\.value !== undefined/)
  assert.match(planningSurface, /platform\.coreWrites\.primaryOwnerRequired/)
  assert.match(workspace, /v-if="writable"/)
  assert.match(workspace, /platform\.coreWrites\.primaryOwnerRequired/)
  assert.match(inspector, /!props\.writable \|\| busy\.value/)
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

test('activity and session navigation each refuse ambiguous project ownership', () => {
  assert.match(liveFeed, /binding_state === 'mapped'/)
  assert.match(liveFeed, /candidates\.length !== 1/)
  assert.match(liveFeed, /resolveManifestRouteAuthority/)
  assert.match(liveFeed, /planningWorkItemEntity\(\{ space_ref: space, reference \}/)
  // Minting the entity through the refs module rather than writing the literal is
  // what keeps one spelling of a work-item identity in the app.
  // Activity is old reference-only evidence, so it can only fail closed on a
  // unique space key. A session carries more authority: its separate resolver
  // must match the complete canonical resource id and never drop back to key.
  assert.match(liveFeed, /export function resolveWorkItemRoute/)
  assert.match(sessionWorkItemRoute, /resource_ref\.resource_id === resourceRef\.resource_id/)
  assert.match(sessionWorkItemRoute, /candidates\.length !== 1/)
  assert.match(app, /resolveSessionWorkItemRoute\(/)
  assert.match(moduleStage, /open-session-work-item/)
  assert.doesNotMatch(liveFeed, /kind: 'work-item'/)
  for (const genericActivitySource of [contextBar, liveFeed, activityBell]) {
    assert.doesNotMatch(
      genericActivitySource,
      /AgentActivity|item\.(?:board|card_id|card_title|column)/,
    )
    assert.doesNotMatch(genericActivitySource, /BoardRef|CardRef|board_name|board_ref|card_ref/)
  }
})

test('Settings renders modules, grouped integrations, and project assignments', () => {
  assert.match(settings, /PlatformSettingsRegistry/)
  assert.match(registry, /platform\.registry\.modules/)
  assert.match(registry, /integrationGroups/)
  assert.match(registry, /platform\.registry\.projectAssignments/)
  assert.match(registry, /scope\.kind === 'project'/)
  assert.doesNotMatch(settings, /listIntegrations|updateIntegration|\/api\/integrations/)
})

test('registry presents neutral connections and owns lifecycle and selection', () => {
  assert.match(registryLabels, /connectionDetails/)
  assert.match(registry, /connection\.transport/)
  assert.match(registry, /connection\.capabilities/)
  assert.match(registry, /ToggleSwitch/)
  assert.match(registry, /setAssignmentState/)
  assert.match(registry, /setPlatformAssignment/)
  assert.match(registry, /resetProjectAssignment/)
  assert.doesNotMatch(registry, /strong>\{\{ connection\.connection_ref\.connection_id \}\}/)
})

test('Skills uses canonical shell scope and route entity instead of an internal all-scope selector', () => {
  assert.match(app, /updateSkillRoute/)
  assert.match(navigation, /kind: 'skill'/)
  assert.match(moduleStage, /:view="stateValue\('view', 'catalog'\)"/)
  assert.doesNotMatch(
    skills,
    /scopeOptions|chooseProject|value: ['"]['"], label: t\('skills\.all'\)/,
  )
  assert.doesNotMatch(skills, /localStorage|improvements_scope/)
})

test('analytics serves live projections for both operating levels', () => {
  assert.match(moduleStage, /AnalyticsView/)
  assert.doesNotMatch(app, /globalPending|exactProjectionUnavailable/)
  const analytics = source('../src/pages/analytics/AnalyticsView.vue')
  assert.match(analytics, /AnalyticsDashboard/)
  assert.match(analytics, /fetchSpaceAnalytics/)
  // The global level is its own component now, and it is one read rather than
  // one dashboard request per project: the combining rule is coverage, and a
  // second implementation of coverage is a second answer.
  assert.match(analytics, /AnalyticsPortfolio/)
  const portfolio = source('../src/pages/analytics/components/AnalyticsPortfolio.vue')
  assert.match(portfolio, /fetchAnalyticsPortfolio/)
  assert.match(portfolio, /openProject/)
  assert.doesNotMatch(portfolio, /fetchSpaceAnalytics/)
})

test('planning projects three views from one read of the space', () => {
  // The three views take the same model apart rather than each fetching their
  // own: one `/api/planning` answer carries the workflow, the items and the links.
  assert.match(planningSurface, /fetchPlanning\(\{ project \}\)/)
  assert.match(workspace, /<WorkItemBoard/)
  assert.match(workspace, /<WorkItemList/)
  assert.match(workspace, /<WorkItemGraph/)
  assert.match(workspace, /:items="model\.work_items"/)
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
  assert.match(moduleStage, /:retryable="false"/)
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
  // The dialog footers are `VButton` now, so the row a control occupies is
  // asserted in the primitive that owns it; what this says is that the panel uses
  // it rather than drawing its own. A relation action is the compact row.
  assert.match(relationConfirm, /<VButton/)
  assert.match(
    compactCss(relationList),
    /\.relation-action\{[^}]*min-height:var\(--size-control-height-compact\)/,
  )
  // The inspector's section switch is the shared segmented control rather than a
  // tablist of its own, so the row it stands in is the primitive's answer. It
  // lives in the shared frame now, with the two writes it sits beside.
  assert.match(inspector, /<SegmentedControl/)
  assert.match(
    compactCss(segmented),
    /\.segmented-option\{[^}]*min-height:calc\(var\(--size-control-height\)/,
  )
})
