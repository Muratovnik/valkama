import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { test } from 'vitest'

import { compactCss } from './support/source.ts'

const graph = readFileSync(
  new URL('../src/widgets/work-item-graph/components/GraphView.vue', import.meta.url),
  'utf8',
)
const drawer = readFileSync(
  new URL('../src/widgets/work-item-inspector/components/WorkItemInspector.vue', import.meta.url),
  'utf8',
)
const drawerCss = readFileSync(
  new URL('../src/widgets/work-item-inspector/components/WorkItemInspector.css', import.meta.url),
  'utf8',
)
const monitor = readFileSync(
  new URL('../src/pages/sessions/SessionsView.vue', import.meta.url),
  'utf8',
)
const sessionDrawer = readFileSync(
  new URL('../src/widgets/session-detail/SessionDetailDrawer.vue', import.meta.url),
  'utf8',
)
const card = readFileSync(
  new URL('../src/widgets/work-item-views/components/WorkItemTile.vue', import.meta.url),
  'utf8',
)
const drawerDetails = readFileSync(
  new URL('../src/widgets/work-item-inspector/components/InspectorOverview.vue', import.meta.url),
  'utf8',
)
const graphControls = readFileSync(
  new URL('../src/widgets/work-item-graph/components/GraphControls.vue', import.meta.url),
  'utf8',
)
const graphNode = readFileSync(
  new URL('../src/widgets/work-item-graph/components/GraphNodeCard.vue', import.meta.url),
  'utf8',
)
const graphProjection = readFileSync(
  new URL('../src/widgets/work-item-graph/composables/useGraphProjection.ts', import.meta.url),
  'utf8',
)
const sessionTable = readFileSync(
  new URL('../src/pages/sessions/SessionTable.vue', import.meta.url),
  'utf8',
)
const sessionFeed = readFileSync(
  new URL('../src/widgets/session-detail/SessionFeed.vue', import.meta.url),
  'utf8',
)
const kernelRelations = readFileSync(
  new URL(
    '../src/widgets/work-item-inspector/components/KernelRelationsPanel.vue',
    import.meta.url,
  ),
  'utf8',
)
const infoTip = readFileSync(new URL('../src/shared/ui/InfoTip.vue', import.meta.url), 'utf8')
const inspector = readFileSync(
  new URL('../src/shared/ui/ResizableInspector.vue', import.meta.url),
  'utf8',
)
const inspectorFrame = readFileSync(
  new URL('../src/shared/ui/InspectorFrame.vue', import.meta.url),
  'utf8',
)
const overlayHeader = readFileSync(
  new URL('../src/shared/ui/OverlayHeader.vue', import.meta.url),
  'utf8',
)
const overlay = readFileSync(new URL('../src/shared/ui/OverlayHost.vue', import.meta.url), 'utf8')
const shellLayout = readFileSync(
  new URL('../src/shared/lib/shellLayout.ts', import.meta.url),
  'utf8',
)
const app = readFileSync(new URL('../src/app/App.vue', import.meta.url), 'utf8')
const planningSurface = readFileSync(
  new URL('../src/pages/planning/PlanningModuleSurface.vue', import.meta.url),
  'utf8',
)
const workspace = readFileSync(
  new URL('../src/pages/planning/PlanningWorkspace.vue', import.meta.url),
  'utf8',
)
const lane = readFileSync(
  new URL('../src/widgets/work-item-views/components/WorkItemColumn.vue', import.meta.url),
  'utf8',
)
const improvementStatus = readFileSync(
  new URL('../src/entities/improvement/components/ImprovementStatusBadge.vue', import.meta.url),
  'utf8',
)
const countBadge = readFileSync(new URL('../src/shared/ui/CountBadge.vue', import.meta.url), 'utf8')
const semanticState = readFileSync(
  new URL('../src/shared/ui/SemanticState.vue', import.meta.url),
  'utf8',
)
const settings = readFileSync(
  new URL('../src/pages/settings/SettingsView.vue', import.meta.url),
  'utf8',
)
const appIcon = readFileSync(new URL('../src/shared/ui/VIcon.vue', import.meta.url), 'utf8')
const navList = readFileSync(
  new URL('../src/widgets/app-nav/components/NavModuleList.vue', import.meta.url),
  'utf8',
)
const dataTableTrigger = readFileSync(
  new URL('../src/widgets/analytics-dashboard/components/DataTableTrigger.vue', import.meta.url),
  'utf8',
)
const analyticsInspector = readFileSync(
  new URL(
    '../src/widgets/analytics-dashboard/components/AnalyticsTableInspector.vue',
    import.meta.url,
  ),
  'utf8',
)

test('GraphView delegates camera behavior to Vue Flow and keeps graph nodes non-editable', () => {
  // The focus reducer moved into the projection composable with the fetch and the
  // derivations it resets; the view's part is handing pointer and keyboard events
  // to it, which `applyFocus` is.
  assert.match(graphProjection, /from '@\/widgets\/work-item-graph\/utils\/graphFocus\.ts'/)
  assert.match(graph, /useGraphProjection/)
  assert.match(graph, /applyFocus\(\{ type: 'pointer-enter'/)
  assert.match(graph, /<VueFlow/)
  // The camera controls are their own component, because the chrome they wear is
  // eight rules into Vue Flow's own DOM and none of it is about the field.
  assert.match(graph, /<GraphControls/)
  assert.match(graphControls, /<Controls/)
  assert.match(graph, /<Background/)
  assert.match(graph, /:pan-on-drag="true"/)
  assert.match(graph, /zoom-activation-key-code="Control"/)
  assert.match(graph, /:nodes-draggable="false"/)
  assert.match(graph, /@node-click="onFlowNodeClick"/)
  assert.doesNotMatch(graph, /stepGraphZoom|zoom-surface|transform: `scale/)
})

test('the inspector exposes its emits, related navigation, and shared focus ownership', () => {
  assert.match(drawer, /'?close'?: \[\]/)
  assert.match(drawer, /'?open'?: \[reference: string\]/)
  assert.match(drawer, /'?changed'?: \[\]/)
  assert.match(drawer, /emit\('open'/)
  assert.match(drawer, /<ResizableInspector/)
  assert.match(drawer, /<DrawerFrame/)
  assert.match(drawer, /<SegmentedControl/)
  assert.doesNotMatch(drawer, /<InspectorDrawer|<InspectorHead/)
  // The header's controls and the tabs name `--size-control-target` rather than
  // writing 44, which is the token for exactly that number.
  assert.match(compactCss(drawerCss), /min-height:var\(--size-control-target\)/)
  // Writability is a prop the shell decides, and every write is gated on it
  // together with the in-flight guard rather than each button deciding again.
  assert.match(drawer, /:writable="writable && !busy"/)
  assert.match(drawer, /<KernelRelationsPanel/)
  assert.match(drawer, /<InspectorOverview/)
  // A route-owned entity gets a fresh inspector subtree. A refresh of that same
  // keyed entity keeps the current panel and only reloads its data.
  assert.match(planningSurface, /:key="openIdentity"/)
  assert.match(drawer, /:key="reference"/)
  assert.match(drawer, /`\$\{props\.reference\}:\$\{props\.refreshToken\}`/)
})

test('the work-item inspector is persisted and bounded by its actual workspace', () => {
  assert.match(drawer, /INSPECTOR_DRAWER_STORAGE_KEY/)
  assert.match(inspector, /inspectorLayoutForWorkspace/)
  assert.match(inspector, /surface\.value\?\.parentElement/)
  assert.match(inspector, /role="separator"/)
  assert.match(inspector, /aria-orientation="vertical"/)
  assert.match(inspector, /@pointerdown="beginResize"/)
  assert.match(inspector, /@keydown="resizeFromKeyboard"/)
  assert.match(planningSurface, /class="planning-workspace-shell"/)
})

test('command dialogs are the sole modal focus owner over the inline inspector', () => {
  // The inspector is a workspace split, not a second dialog. The composer and
  // launch form therefore remain the only surfaces claiming modal focus.
  assert.match(planningSurface, /v-if="open && boundSpaceResourceRef"/)
  assert.doesNotMatch(planningSurface, /open && !composerOpen/)
  assert.match(drawer, /<ResizableInspector/)
  assert.doesNotMatch(drawer, /<InspectorDrawer|OverlayHost/)
  assert.match(overlay, /interactive\?: boolean/)
  // The five attributes that say whether the surface takes input are one object,
  // because they describe one fact and cannot disagree. A passive surface is inert
  // and hidden; each attribute is absent rather than false in the case it does not
  // apply, which is the whole reason this is derived and not written inline.
  assert.match(overlay, /'aria-hidden': true, 'inert': true/)
  assert.match(overlay, /'role': 'dialog'/)
  assert.doesNotMatch(overlay, /:inert=|:aria-hidden=|:aria-modal=/)
  assert.match(overlay, /overlay-layer-command/)
  assert.match(overlay, /overlay-layer-drawer/)
})

test('the inspector keeps item facts and generic relation actions in one surface', () => {
  // The overview panel is its own component; what the inspector owns is which
  // panel shows and the item all of them read.
  assert.match(drawerDetails, /props\.item\.checklist|item\.checklist/)
  assert.match(drawerDetails, /summary/)
  // Kernel relations sit beside the work-item links rather than in a second
  // surface, and neither of them knows about AgentMemory by name.
  assert.match(drawer, /<KernelRelationsPanel/)
  assert.doesNotMatch(drawerDetails, /relatedMemories|groupReferences|agentmemory/i)
})

test('one place draws who holds an item, and the shell owns scope presentation', () => {
  // The tile names the holder and the graph node names the holder plus whether
  // the work is active. Nothing else may invent its own mark, which is the half
  // of this assertion the column carries.
  assert.match(card, /class="tile-holder"/)
  assert.match(card, /claim_ref/)
  assert.doesNotMatch(lane, /bundle-active|t\('work\.active'\)/)
  assert.match(graphNode, /class="flow-node-owner-state">\{\{ t\('work\.active'\) \}\}/)
  assert.match(
    readFileSync(new URL('../src/app/components/AppModuleStage.vue', import.meta.url), 'utf8'),
    /<PlanningModuleSurface/,
  )
  assert.doesNotMatch(app, /class="scope-active"/)
})

test('the planning workspace is the one scroll owner and wears shared controls', () => {
  // The view switch is the shared segmented control rather than three buttons of
  // its own, so the row it sits in matches every other module's header.
  assert.match(workspace, /<SegmentedControl/)
  assert.match(workspace, /:aria-busy="countsBusy"/)
  // The header row stays and each view scrolls inside the stage. Two scroll
  // containers is how the board used to take the page sideways with it.
  assert.match(compactCss(workspace), /\.workspace\{[^}]*grid-template-rows:autominmax\(0,1fr\)/)
  assert.match(compactCss(workspace), /\.workspace-stage\{[^}]*min-height:0/)
})

test('every Kernel relation action is confirmed through one dialog component', () => {
  // Attach, open and remove are three decisions with one confirmation grammar.
  // Three dialogs written separately is how one of them ended up without the
  // target line, which is the only part that says what is about to happen.
  assert.equal(
    (kernelRelations.match(/<RelationConfirm/g) ?? []).length,
    3,
    'attach, open and remove share one confirmation component',
  )
  assert.match(kernelRelations, /:target="pendingTarget\(pendingOpen\)"/)
  assert.match(kernelRelations, /:target="pendingTarget\(pendingRemoval\)"/)
  assert.doesNotMatch(kernelRelations, /window\.confirm/)
})

test('operational statuses reserve invariant geometry instead of stretching their rows', () => {
  assert.doesNotMatch(improvementStatus, /class="improvement-status"/)
  // The badge is the default and the list opts out of it: one state beside a
  // heading keeps its ground, a state repeated down every row does not.
  assert.match(improvementStatus, /variant: 'badge'/)
  assert.match(improvementStatus, /:variant="variant"/)
  assert.match(semanticState, /variant\?: 'inline' \| 'badge' \| 'dot'/)
  assert.match(graphNode, /class="flow-node-meta"/)
  assert.match(graphNode, /\.flow-node-line\s*\{[^}]*display:\s*grid/s)
  assert.match(graphNode, /\.flow-node-owner\s*\{[^}]*max-width:\s*100%/s)
  // The nine `:deep()` rules that reached from the view into this card are its own
  // now, keyed off classes it puts on itself from the node it was handed.
  assert.doesNotMatch(graph, /flow-node-/)
})

test('count badges own inline and overlay geometry without per-screen overrides', () => {
  assert.match(countBadge, /placement\?: 'overlay' \| 'inline'/)
  assert.match(monitor, /placement="inline"/)
  assert.doesNotMatch(monitor, /group-count-wrap/)
})

test('the session row is the disclosure control and acknowledgement stays separate', () => {
  // The static class list holds more than one name since prefer-separate-static-class
  // moved the literal out of the :class array, so this asks for the class itself.
  assert.match(sessionTable, /class="[^"]*\bsession-open\b/)
  // The row asks and the page decides: `select` carries the session, so the table
  // holds no selection state of its own.
  assert.match(sessionTable, /@click="emit\('select', session\)"/)
  assert.doesNotMatch(sessionTable, /selectedId\.value/)
  // aria-current, not aria-expanded: the row opens a drawer rather than
  // revealing nested content, and aria-expanded on a table row is only defined
  // inside a treegrid, which axe reports as a conditional-attribute violation.
  // Named, because the mark has to be absent rather than false on every other row
  // and the template is not where that gets decided.
  assert.match(sessionTable, /:aria-current="currentMark\(session\)"/)
  // One name for "this row is the one the drawer is showing", spent by the mark
  // and by the selected class, which were two copies of the same comparison.
  assert.match(sessionTable, /isSelected\(session\) \? 'true' : undefined/)
  assert.match(sessionTable, /\{ selected: isSelected\(session\) \}/)
  assert.match(sessionTable, /class="ack-inline"/)
  assert.match(sessionTable, /monitor\.markRead/)
  assert.doesNotMatch(sessionTable, /expand-action|monitor\.openReason|monitor\.showDetails/)
  assert.doesNotMatch(sessionTable, /row-chevron/)
  // Counted across both, because "one acknowledgement path" stops meaning
  // anything if splitting the file is enough to satisfy it.
  assert.equal(
    (`${monitor}${sessionTable}`.match(/markSessionSeen\(/g) ?? []).length,
    1,
    'one explicit acknowledgement path',
  )
  assert.doesNotMatch(`${monitor}${sessionTable}`, /class="session-detail"|fetchSessionFeed\(/)
  assert.match(monitor, /<SessionDetailDrawer/)
})

test('session ledger is a compact semantic table with interactive stat filters', () => {
  assert.match(sessionTable, /<table[^>]*class="session-table"/)
  assert.match(sessionTable, /<th scope="col"/)
  // The filter row is the shared segmented control, and it carries each count
  // in its own label rather than restyling four buttons locally.
  assert.match(monitor, /<SegmentedControl\s+v-model="activeGroup"/)
  assert.match(monitor, /label: `\$\{stat\.label\} · \$\{stat\.value\}`/)
  assert.doesNotMatch(monitor, /class="head-stat"/)
  assert.match(sessionTable, /t\('monitor\.client'\)/)
  // The ledger centres itself inside a frame it deliberately fills edge to
  // edge, and it centres on the one column every module shares. It used to
  // spell 1180 while the frame said 1360 and the settings page said 1440, so a
  // reader moving between modules found the text starting in a new place.
  assert.match(
    sessionTable,
    /\.session-table-wrap\s*\{[^}]*max-width:\s*var\(--size-module-column\)[^}]*margin:\s*0 auto/s,
  )
  assert.match(sessionTable, /overflow-wrap:\s*anywhere/)
})

test('session filters, module icons, inspector facts, and analytics inspector use explicit action grammar', () => {
  assert.match(monitor, /monitor\.groups\.all/)
  assert.match(monitor, /filteredSessionGroups/)
  assert.match(sessionTable, /monitor\.filterEmpty/)
  assert.match(sessionTable, /class="state-cell"/)
  assert.equal(
    (`${monitor}${sessionTable}`.match(/<SemanticState/g) ?? []).length,
    1,
    'session state belongs to one dedicated column',
  )
  assert.doesNotMatch(sessionTable, /class="client-cell"><span class="tone-mark"/)
  assert.match(navList, /module\.icon_key/)
  assert.doesNotMatch(appIcon, /sessions:\s*Activity/)
  assert.doesNotMatch(appIcon, /improvements:\s*Activity/)
  assert.doesNotMatch(drawer, /context-working[^\n]+work\.active/)
  assert.match(drawer, /<InspectorRelations/)
  // Every chart card reaches the numbers behind it through one trigger, so the
  // dialog grammar is asserted on that component rather than per chart.
  // The trigger belongs to the card shell all five charts wear, so it is asserted
  // once rather than per chart.
  assert.match(
    readFileSync(
      new URL(
        '../src/widgets/analytics-dashboard/components/AnalyticsChartCard.vue',
        import.meta.url,
      ),
      'utf8',
    ),
    /<DataTableTrigger/,
  )
  assert.match(dataTableTrigger, /aria-haspopup="dialog"/)
  assert.match(dataTableTrigger, /dashboard\.openDataTable/)
  assert.match(analyticsInspector, /ANALYTICS_INSPECTOR_STORAGE_KEY/)
  assert.match(analyticsInspector, /min-width:/)
  assert.doesNotMatch(analyticsInspector, /th,td\{[^}]*overflow-wrap:anywhere/)
})

test('settings registry is read-only and has no legacy integration activation path', () => {
  assert.match(settings, /PlatformSettingsRegistry/)
  assert.doesNotMatch(settings, /toggleIntegration|updateIntegration|settings\.integrations/)
})

test('session details retain their keyed feed request lifecycle', () => {
  // The feed fetches for itself, and the keyed shared resource generation rejects
  // late callbacks; the drawer only hands over the session id and refresh revision.
  assert.match(sessionFeed, /fetchSessionFeed\(id\)/)
  assert.match(sessionFeed, /resource\.value\.generation/)
  assert.match(sessionFeed, /resourceUiState/)
  assert.match(sessionDrawer, /<SessionFeed/)
  assert.doesNotMatch(sessionDrawer, /fetchSessionFeed/)
})

test('session details use a persistent resizable inspector rather than a modal overlay', () => {
  assert.match(sessionDrawer, /<ResizableInspector/)
  assert.match(inspector, /role="separator"/)
  assert.match(inspector, /aria-orientation="vertical"/)
  assert.match(inspector, /SESSION_INSPECTOR_STORAGE_KEY/)
  assert.match(shellLayout, /valkama-session-inspector-width/)
  assert.match(inspector, /@pointerdown="beginResize"/)
  assert.match(inspector, /@keydown="resizeFromKeyboard"/)
  assert.match(inspector, /ResizeObserver/)
  assert.match(inspector, /surface\.value\?\.parentElement/)
  assert.doesNotMatch(inspector, /@media\s*\(max-width:\s*860px\)/)
  assert.doesNotMatch(sessionDrawer, /<InspectorDrawer/)
})

test('the session inspector separates identity from controls and detail content through the shared frame', () => {
  assert.match(sessionDrawer, /<InspectorFrame/)
  // The head is one component both overlays wear, so its rule and padding are
  // asserted where they live rather than once per surface that shows them.
  assert.match(inspectorFrame, /<OverlayHeader/)
  assert.match(
    compactCss(overlayHeader),
    /\.overlay-header\{[^}]*padding:var\(--space-6\)[^}]*border-bottom:/s,
  )
  assert.match(
    compactCss(inspectorFrame),
    /\.inspector-frame-body\{[^}]*padding:var\(--space-6\)[^}]*overflow-y:auto/s,
  )
})

test('the session monitor is a one-column ledger and keeps the selected inspector beside it', () => {
  assert.match(monitor, /class="session-ledger[^"]*"/)
  assert.match(monitor, /class="monitor-workspace[^"]*"/)
  assert.match(monitor, /<SessionDetailDrawer/)
  assert.match(monitor, /container-type:\s*inline-size/)
  assert.match(monitor, /@container\s+session-ledger/)
  assert.doesNotMatch(monitor, /grid-template-columns:\s*repeat\(2/)
})

test('info tips escape clipped ancestors and calculate a viewport-fixed position', () => {
  assert.match(infoTip, /<Teleport to="body">/)
  assert.match(infoTip, /getBoundingClientRect\(\)/)
  assert.match(infoTip, /position:\s*fixed/)
  assert.match(infoTip, /window\.innerWidth/)
})

test('a work-item tile is one control, not a card with an arrow footer', () => {
  // The tile is the button. A card that carried its own open affordance reserved
  // a footer row on every tile for one arrow, and a nested control inside a
  // clickable card is two tab stops for one destination.
  assert.doesNotMatch(card, /source-open|openSource|↗/)
  assert.match(card, /<button\s+class="work-item-tile"/)
  assert.match(card, /@click="emit\('open', props\.item\.reference\)"/)
  assert.equal((card.match(/<button/g) ?? []).length, 1, 'one control per tile')
})

test('Planning components carry presentation tones instead of remapping operational state', () => {
  assert.match(card, /statePresentation\('work-item-priority', props\.item\.priority\)\.tone/)
  assert.doesNotMatch(card, /data-priority/)

  assert.match(graphNode, /if \(ready\) return 'ready'/)
  assert.match(graphNode, /node\.claim_ref && !node\.state\.is_terminal/)
  assert.match(graphNode, /statePresentation\('work-item-node-marker', markerState\)\.tone/)
  assert.doesNotMatch(graphNode, /class="claimed"|'claimed':/)

  assert.match(
    drawerDetails,
    /statePresentation\('work-item-state', props\.item\.state\.category\)\.tone/,
  )
  assert.match(
    drawerDetails,
    /\.step\.done & \{\s*background: var\(--color-accent\);\s*border-color: var\(--color-accent\);/,
  )
})
