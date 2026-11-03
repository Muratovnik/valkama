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
const card = readFileSync(
  new URL('../src/widgets/work-item-views/components/WorkItemTile.vue', import.meta.url),
  'utf8',
)
const drawerDetails = readFileSync(
  new URL('../src/widgets/work-item-inspector/components/InspectorOverview.vue', import.meta.url),
  'utf8',
)
const drawerFacts = readFileSync(
  new URL('../src/widgets/work-item-inspector/components/InspectorFacts.vue', import.meta.url),
  'utf8',
)
const drawerDetailsCss = readFileSync(
  new URL('../src/widgets/work-item-inspector/components/InspectorOverview.css', import.meta.url),
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
const app = readFileSync(new URL('../src/app/App.vue', import.meta.url), 'utf8')
const planningSurface = readFileSync(
  new URL('../src/pages/planning/PlanningModuleSurface.vue', import.meta.url),
  'utf8',
)
const workspace = readFileSync(
  new URL('../src/pages/planning/PlanningWorkspace.vue', import.meta.url),
  'utf8',
)
const workspaceBar = readFileSync(
  new URL('../src/pages/planning/PlanningWorkspaceBar.vue', import.meta.url),
  'utf8',
)
const lane = readFileSync(
  new URL('../src/widgets/work-item-views/components/WorkItemColumn.vue', import.meta.url),
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

test('GraphView delegates camera behavior to Vue Flow and keeps graph nodes non-editable', () => {
  // The focus reducer moved into the projection composable with the fetch and the
  // derivations it resets; the view's part is handing pointer and keyboard events
  // to it, which `applyFocus` is.
  assert.match(graphProjection, /from '@\/widgets\/work-item-graph\/utils\/graphFocus\.ts'/)
  assert.match(graph, /useGraphProjection/)
  assert.match(graph, /applyFocus\(\{ type: 'pointer-enter'/)
  assert.match(graph, /<VueFlow/)
  // The camera controls are their own component, in the strip under the flow
  // rather than on it, so they find the field's camera by its id.
  assert.match(graph, /<\/VueFlow>\s*<GraphControls/)
  assert.match(graphControls, /<ControlButton/)
  assert.match(graphControls, /useVueFlow\(\{ id: GRAPH_FLOW_ID \}\)/)
  assert.match(graph, /<Background/)
  assert.match(graph, /:pan-on-drag="true"/)
  assert.match(graph, /zoom-activation-key-code="Control"/)
  assert.match(graph, /:nodes-draggable="false"/)
  assert.match(graph, /@node-click="onFlowNodeClick"/)
  assert.doesNotMatch(graph, /stepGraphZoom|zoom-surface|transform: `scale/)
})

test('the inspector exposes its emits, related navigation, and shared focus ownership', () => {
  assert.match(drawer, /'?close'?: \[\]/)
  assert.match(drawer, /'?open'?: \[reference: string, from: InspectorReturn\]/)
  assert.match(drawer, /'?changed'?: \[\]/)
  assert.match(drawer, /emit\('open'/)
  assert.match(planningSurface, /<ResizableInspector/)
  assert.match(drawer, /<DrawerFrame/)
  assert.match(drawer, /<InspectorTabs/)
  assert.doesNotMatch(drawer, /<InspectorDrawer|<InspectorHead/)
  // Writability is a prop the shell decides, and every write is gated on it
  // together with the in-flight guard rather than each button deciding again.
  assert.match(drawer, /:writable="writable && !busy"/)
  assert.match(drawer, /<InspectorOverview/)
  // A route-owned entity gets a fresh inspector subtree. A refresh of that same
  // keyed entity keeps the current panel and only reloads its data.
  assert.match(planningSurface, /:key="openIdentity"/)
  assert.match(drawer, /:key="reference"/)
  assert.match(
    drawer,
    /`\$\{props\.projectId\}:\$\{props\.resourceRef\.resource_id\}:\$\{props\.reference\}:\$\{props\.refreshToken\}`/,
  )
})

test('the work-item inspector uses the persisted overlay drawer without consuming workspace width', () => {
  assert.match(planningSurface, /INSPECTOR_DRAWER_STORAGE_KEY/)
  assert.match(inspector, /<OverlayHost/)
  assert.match(inspector, /variant="drawer"/)
  assert.match(inspector, /layer: 'drawer'/)
  assert.match(inspector, /resizable/)
  assert.match(inspector, /:width-storage-key="storageKey"/)
  assert.doesNotMatch(inspector, /position: relative|flex: none|parentElement/)
  assert.match(overlay, /<Teleport to="body">/)
  assert.match(overlay, /position: fixed/)
  assert.match(overlay, /role="separator"/)
  assert.match(overlay, /@keydown="resizeFromKeyboard"/)
})

test('command dialogs layer over the inspector using shared modal focus ownership', () => {
  assert.match(planningSurface, /v-if="open && boundSpaceResourceRef"/)
  assert.doesNotMatch(planningSurface, /open && !composerOpen/)
  assert.match(planningSurface, /<ResizableInspector/)
  assert.match(inspector, /<OverlayHost/)
  assert.match(overlay, /interactive\?: boolean/)
  assert.match(overlay, /'aria-hidden': true, 'inert': true/)
  assert.match(overlay, /'role': 'dialog'/)
  assert.doesNotMatch(overlay, /:inert=|:aria-hidden=|:aria-modal=/)
  assert.match(overlay, /overlay-layer-command/)
  assert.match(overlay, /overlay-layer-drawer/)
})

test('the inspector keeps item facts and work-item relations in one surface', () => {
  // The overview panel is its own component; what the inspector owns is which
  // panel shows and the item all of them read.
  assert.match(drawerDetails, /props\.item\.checklist|item\.checklist/)
  assert.match(drawerDetails, /summary/)
  // The relations section is the links between work items and nothing that an
  // extension registry would have to authorize.
  assert.match(drawer, /<InspectorRelations/)
  assert.doesNotMatch(drawer, /<KernelRelationsPanel/)
  assert.doesNotMatch(drawerDetails, /relatedMemories|groupReferences|agentmemory/i)
})

test('one place draws who holds an item, and the shell owns scope presentation', () => {
  // Claim presentation belongs to the tile and graph node, not their column;
  // the tile prints its holder through the facet registry's tile rule.
  // Rendered owner labels are covered in planningPresentation.spec.ts.
  assert.match(card, /const FACTS: readonly FacetId\[\] = \['holder', 'steps'\]/)
  assert.match(card, /surfaceMarks\('tile', props\.item, context\.value, FACTS\)/)
  assert.doesNotMatch(lane, /bundle-active|t\('work\.active'\)/)
  assert.match(graphNode, /class="flow-node-owner-state"/)
  assert.match(
    readFileSync(new URL('../src/app/components/AppModuleStage.vue', import.meta.url), 'utf8'),
    /<PlanningModuleSurface/,
  )
  assert.doesNotMatch(app, /class="scope-active"/)
})

test('the planning workspace is the one scroll owner and wears shared controls', () => {
  // The view switch is the shared segmented control rather than three buttons of
  // its own, so the row it sits in matches every other module's header.
  assert.match(workspaceBar, /<SegmentedControl/)
  assert.match(workspaceBar, /:aria-busy="countsBusy"/)
  // The header row stays and each view scrolls inside the stage. Two scroll
  // containers is how the board used to take the page sideways with it.
  assert.match(compactCss(workspace), /\.workspace\{[^}]*flex-direction:column/)
  assert.match(compactCss(workspace), /\.workspace-stage\{[^}]*flex:11auto/)
  assert.match(compactCss(workspace), /\.workspace-stage\{[^}]*min-height:0/)
})

test('operational statuses reserve invariant geometry instead of stretching their rows', () => {
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
})

test('session filters, module icons, inspector facts, and analytics inspector use explicit action grammar', () => {
  assert.match(navList, /module\.icon_key/)
  assert.doesNotMatch(appIcon, /sessions:\s*Activity/)
  assert.doesNotMatch(appIcon, /improvements:\s*Activity/)
  assert.doesNotMatch(drawer, /context-working[^\n]+work\.active/)
  assert.match(drawer, /<InspectorRelations/)
})

test('settings has no registry screen and no legacy integration activation path', () => {
  assert.doesNotMatch(settings, /PlatformSettingsRegistry|settings-registry/)
  assert.doesNotMatch(settings, /toggleIntegration|updateIntegration|settings\.integrations/)
})

test('the session inspector separates identity from controls and detail content through the shared frame', () => {
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

test('info tips escape clipped ancestors and calculate a viewport-fixed position', () => {
  assert.match(infoTip, /<Teleport to="body">/)
  assert.match(infoTip, /getBoundingClientRect\(\)/)
  assert.match(infoTip, /position:\s*fixed/)
  assert.match(infoTip, /window\.innerWidth/)
})

test('a work-item tile is one control, not a card with an arrow footer', () => {
  // The tile opens through one button, its title stretched over the sheet. A
  // card that carried its own open affordance reserved a footer row on every
  // tile for one arrow, and a second control in a tile is a second Tab stop for
  // the same destination. The marks that filter are buttons beside the title,
  // and every one of them is kept out of the Tab order.
  assert.doesNotMatch(card, /source-open|↗/)
  assert.match(card, /<button\s+class="tile-open"/)
  assert.match(card, /const open = \(\) => emit\('open', props\.item\.reference\)/)
  assert.equal((card.match(/<button/g) ?? []).length, 1, 'one open target per tile')
  const filterRuns = (card.match(/filterable: true/g) ?? []).length
  assert.ok(filterRuns > 0)
  assert.equal((card.match(/tabbable: false/g) ?? []).length, filterRuns)
})

test('Planning components carry presentation tones instead of remapping operational state', () => {
  assert.doesNotMatch(card, /box-shadow: inset|data-tone/)
  assert.doesNotMatch(card, /data-priority/)

  assert.match(graphNode, /if \(ready\) return 'ready'/)
  assert.match(graphNode, /node\.claim_ref && !node\.state\.is_terminal/)
  assert.match(graphNode, /statePresentation\('work-item-node-marker', markerState\)\.tone/)
  assert.doesNotMatch(graphNode, /class="claimed"|'claimed':/)

  assert.match(drawerFacts, /dimension="work-item-state"[\s\S]*:state="item\.state\.category"/)
  assert.match(drawerDetails, /<style scoped src="\.\/InspectorOverview\.css">/)
  assert.match(
    drawerDetailsCss,
    /\.step\[data-tone='success'\] & \{\s*background: var\(--color-success\);\s*border-color: var\(--color-success\);/,
  )
})
