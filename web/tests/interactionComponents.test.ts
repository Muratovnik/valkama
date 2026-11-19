/**
 * The interaction rules of the planning surfaces that hold as text.
 *
 * Each check reads a file as code, comments taken out, and asserts a rule over it:
 * something forbidden is absent, a shared component or a library's configuration is
 * what a surface is built from, or a declaration the rule names is there. What a
 * surface does when it is used is the component and browser specs' to say, and a
 * comment beside a test here names the spec that says it.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { uncommented } from '../scripts/ui-system/comments.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { compactCss, declarationsOf, sourceCode } from './support/source.ts'

const graph = sourceCode('widgets/work-item-graph/components/GraphView.vue')
const drawer = sourceCode('widgets/work-item-inspector/components/WorkItemInspector.vue')
const card = sourceCode('widgets/work-item-views/components/WorkItemTile.vue')
const drawerDetails = sourceCode('widgets/work-item-inspector/components/InspectorOverview.vue')
const stepMark = sourceCode('entities/work-item/components/StepMark.vue')
const graphControls = sourceCode('widgets/work-item-graph/components/GraphControls.vue')
const graphField = sourceCode('widgets/work-item-graph/components/GraphField.vue')
const graphNode = sourceCode('widgets/work-item-graph/components/GraphNodeCard.vue')
const infoTip = sourceCode('shared/ui/InfoTip.vue')
const inspector = sourceCode('shared/ui/ResizableInspector.vue')
const inspectorFrame = sourceCode('shared/ui/InspectorFrame.vue')
const overlayHeader = sourceCode('shared/ui/OverlayHeader.vue')
// The host's markup and its stylesheet, which stands beside it as a file of its own.
const overlay = sourceCode('shared/ui/OverlayHost.vue')
const overlayCss = sourceCode('shared/ui/overlayHost.css')
const app = sourceCode('app/App.vue')
const cardDrawer = sourceCode('pages/planning/PlanningCardDrawer.vue')
const planningSurface = sourceCode('pages/planning/PlanningModuleSurface.vue')
const cardPanel = sourceCode('pages/planning/PlanningCardPanel.vue')
const workspace = sourceCode('pages/planning/PlanningWorkspace.vue')
const workspaceBar = sourceCode('pages/planning/PlanningWorkspaceBar.vue')
const lane = sourceCode('widgets/work-item-views/components/WorkItemColumn.vue')
const countBadge = sourceCode('shared/ui/CountBadge.vue')
const semanticState = sourceCode('shared/ui/SemanticState.vue')
const settings = sourceCode('pages/settings/SettingsView.vue')
const appIcon = sourceCode('shared/ui/VIcon.vue')
const navList = sourceCode('widgets/app-nav/components/NavModuleList.vue')

/** A component tag a template renders, with or without attributes. */
const renders = (tag: string) => new RegExp(`<${tag}(?=[\\s/>])`)
/** An attribute a template sets to `value`, bound or plain. */
const sets = (name: string, value: string) => new RegExp(`\\s:?${name}\\s*=\\s*"\\s*${value}\\s*"`)
/** The members a prop declares as a union of string literals. */
const union = (code: string, prop: string) =>
  new RegExp(`\\b${prop}\\?:\\s*([^\\n;]+)`).exec(code)?.[1].match(/'[\w-]+'/g) ?? []

test('GraphView delegates camera behavior to Vue Flow and keeps graph nodes non-editable', () => {
  // A pointer lights nothing: hovering a card dims no other card.
  assert.doesNotMatch(graph, /@node-enter|@node-leave|pointer-enter/)
  assert.doesNotMatch(graphField, /node-mouse-enter|node-mouse-leave/)
  // Vue Flow is configured in one place, the field, and nowhere else in the product.
  assert.deepEqual(
    collectVueSources()
      .filter(({ file, source }) => renders('VueFlow').test(uncommented(file, source)))
      .map(({ file }) => file),
    ['widgets/work-item-graph/components/GraphField.vue'],
  )
  // The camera controls are Vue Flow's, and find the field's camera by the id the field has.
  assert.match(graphControls, renders('ControlButton'))
  const flowId = /useVueFlow\(\s*\{\s*id:\s*([\w.]+),?\s*\}/.exec(graphControls)?.[1]
  assert.ok(flowId, 'the controls name no flow')
  assert.match(graphField, sets('id', flowId))
  assert.match(graphField, renders('Background'))
  assert.match(graphField, sets('pan-on-drag', 'true'))
  assert.match(graphField, sets('zoom-activation-key-code', 'Control'))
  assert.match(graphField, sets('nodes-draggable', 'false'))
  assert.doesNotMatch(graph, /stepGraphZoom|zoom-surface|transform: `scale/)
  assert.doesNotMatch(graphField, /stepGraphZoom|zoom-surface|transform: `scale/)
  // The arrows walking the field: browser/production-graph-keyboard.spec.ts. A pressed
  // card opening its drawer, the controls under the cards rather than on them:
  // browser/production-graph.spec.ts.
})

test('the inspector exposes its emits, related navigation, and shared focus ownership', () => {
  // The emits are the inspector's interface; what it emits when is
  // components/inspectorDrafts.spec.ts and components/inspectorReturn.spec.ts.
  assert.match(drawer, /\b'?close'?\s*:\s*\[\s*\]/)
  assert.match(drawer, /\b'?open'?\s*:\s*\[[^\]]*\bInspectorReturn\b[^\]]*\]/)
  assert.match(drawer, /\b'?changed'?\s*:\s*\[\s*\]/)
  assert.match(planningSurface, renders('PlanningCardPanel'))
  assert.match(cardPanel, renders('PlanningCardDrawer'))
  assert.match(cardDrawer, renders('ResizableInspector'))
  assert.match(drawer, renders('DrawerFrame'))
  assert.match(drawer, renders('TabStrip'))
  assert.match(drawer, renders('InspectorOverview'))
  assert.doesNotMatch(drawer, /<InspectorDrawer|<InspectorHead/)
  // No write while one is in flight: components/inspectorFacts.spec.ts. A refresh of the
  // same card keeping its panel: components/workItemInspectorState.spec.ts.
})

test('the work-item inspector uses the persisted overlay drawer without consuming workspace width', () => {
  // The card's drawer keeps a width of its own; the shared drawer persisting it, its
  // separator, keyboard resizing and teleport: components/resizableInspector.spec.ts.
  assert.match(cardDrawer, /<ResizableInspector\b[^>]*\s:storage-key="/)
  assert.match(inspector, renders('OverlayHost'))
  assert.match(inspector, sets('variant', 'drawer'))
  assert.match(inspector, /\blayer:\s*'drawer'/)
  assert.match(inspector, /<OverlayHost\b[^>]*\sresizable[\s/>=]/)
  assert.doesNotMatch(inspector, /position: relative|flex: none|parentElement/)
  assert.ok(declarationsOf(overlayCss, '.overlay-host').includes('position:fixed'))
})

test('command dialogs layer over the inspector using shared modal focus ownership', () => {
  // The card stays while the composer is open: only an open item and its space decide it.
  assert.doesNotMatch(planningSurface, /open(?:\.value)? && !composerOpen/)
  // The host alone sets what covers a layer, never a binding on a surface.
  assert.doesNotMatch(overlay, /:inert=|:aria-hidden=|:aria-modal=/)
  // The covered drawer going inert and hidden under a command, one dialog at a time:
  // components/overlayOwnership.spec.ts.
})

test('the inspector keeps item facts and work-item relations in one surface', () => {
  // The overview panel is its own component; what the inspector owns is which
  // panel shows and the item all of them read.
  assert.match(drawerDetails, renders('InspectorSummary'))
  // The relations section is the links between work items and nothing that an
  // extension registry would have to authorize.
  assert.match(drawer, renders('InspectorRelations'))
  assert.doesNotMatch(drawer, /<KernelRelationsPanel/)
  assert.doesNotMatch(drawerDetails, /relatedMemories|groupReferences|agentmemory/i)
})

test('one place draws who holds an item, and the shell owns scope presentation', () => {
  // Claim presentation belongs to the tile and graph node, not their column. The
  // holder on a tile and on a node: components/planningPresentation.spec.ts and
  // components/graphNodeCard.spec.ts.
  assert.doesNotMatch(lane, /bundle-active|t\('work\.active'\)/)
  assert.match(sourceCode('app/components/AppModuleStage.vue'), renders('PlanningModuleSurface'))
  assert.doesNotMatch(app, /class="scope-active"/)
})

test('the planning workspace is the one scroll owner and wears shared controls', () => {
  // The view switch is the shared segmented control rather than three buttons of
  // its own, so the row it sits in matches every other module's header.
  assert.match(workspaceBar, renders('SegmentedControl'))
  assert.match(workspaceBar, /\s:aria-busy="/)
  // The header row stays and each view scrolls inside the stage. Two scroll
  // containers is how the board used to take the page sideways with it.
  assert.ok(declarationsOf(workspace, '.workspace').includes('flex-direction:column'))
  const stage = declarationsOf(workspace, '.workspace-stage')
  assert.ok(stage.includes('flex:11auto'), stage.join(';'))
  assert.ok(stage.includes('min-height:0'), stage.join(';'))
})

test('operational statuses reserve invariant geometry instead of stretching their rows', () => {
  assert.deepEqual(union(semanticState, 'variant').toSorted(), ["'badge'", "'dot'", "'inline'"])
  assert.match(graphNode, /\sclass="flow-node-meta"/)
  assert.ok(declarationsOf(graphNode, '.flow-node-line').includes('display:grid'))
  assert.ok(declarationsOf(graphNode, '.flow-node-owner').includes('max-width:100%'))
  // The nine `:deep()` rules that reached from the view into this card are its own
  // now, keyed off classes it puts on itself from the node it was handed.
  assert.doesNotMatch(graph, /flow-node-/)
})

test('count badges own inline and overlay geometry without per-screen overrides', () => {
  assert.deepEqual(union(countBadge, 'placement').toSorted(), ["'inline'", "'overlay'"])
})

test('session filters, module icons, inspector facts, and analytics inspector use explicit action grammar', () => {
  assert.match(navList, /\bmodule\.icon_key\b/)
  assert.doesNotMatch(appIcon, /sessions:\s*Activity/)
  assert.doesNotMatch(appIcon, /improvements:\s*Activity/)
  assert.doesNotMatch(drawer, /context-working[^\n]+work\.active/)
})

test('settings has no registry screen and no legacy integration activation path', () => {
  assert.doesNotMatch(settings, /PlatformSettingsRegistry|settings-registry/)
  assert.doesNotMatch(settings, /toggleIntegration|updateIntegration|settings\.integrations/)
})

test('the session inspector separates identity from controls and detail content through the shared frame', () => {
  // The head is one component both overlays wear, so its rule and padding are
  // asserted where they live rather than once per surface that shows them.
  assert.match(inspectorFrame, renders('OverlayHeader'))
  const head = declarationsOf(overlayHeader, '.overlay-header')
  assert.ok(head.includes('padding:var(--space-6)'), head.join(';'))
  assert.ok(
    head.some((each) => each.startsWith('border-bottom:')),
    head.join(';'),
  )
  const body = declarationsOf(inspectorFrame, '.inspector-frame-body')
  assert.ok(body.includes('padding:var(--space-6)'), body.join(';'))
  assert.ok(body.includes('overflow-y:auto'), body.join(';'))
})

test('info tips escape clipped ancestors and calculate a viewport-fixed position', () => {
  assert.match(infoTip, sets('to', 'body'))
  assert.match(infoTip, renders('Teleport'))
  assert.match(infoTip, /position:\s*fixed/)
  // Where the open tip stands, at its control and clear of every edge of the viewport, also
  // when the window changes size: components/infoTip.spec.ts.
})

test('a work-item tile is one control, not a card with an arrow footer', () => {
  // The tile opens through one button, its title stretched over the sheet. A
  // card that carried its own open affordance reserved a footer row on every
  // tile for one arrow, and a second control in a tile is a second Tab stop for
  // the same destination. The marks that filter are buttons beside the title,
  // and every one of them is kept out of the Tab order. The press opening the
  // card: components/workItemBoard.spec.ts.
  assert.doesNotMatch(card, /source-open|↗/)
  assert.match(card, /<button\b[^>]*\sclass="tile-open"/)
  assert.equal((card.match(/<button\b/g) ?? []).length, 1, 'one open target per tile')
  const filterRuns = (card.match(/\bfilterable:\s*true\b/g) ?? []).length
  assert.ok(filterRuns > 0)
  assert.equal((card.match(/\btabbable:\s*false\b/g) ?? []).length, filterRuns)
})

test('Planning components carry presentation tones instead of remapping operational state', () => {
  assert.doesNotMatch(card, /box-shadow: inset|data-tone/)
  assert.doesNotMatch(card, /data-priority/)
  // Ready and a live claim outranking the workflow marker, and the inspector's state
  // read from its shared presentation: components/planningPresentation.spec.ts.
  assert.doesNotMatch(graphNode, /class="claimed"|'claimed':/)
  assert.match(drawerDetails, /<style\b[^>]*\ssrc="\.\/InspectorOverview\.css"/)
  // The step's box is the one the window that confirms a close draws too.
  assert.match(drawerDetails, /<StepMark\b/)
  const done = [...compactCss(stepMark).matchAll(/\[data-tone='success'\][^{}]*\{([^}]*)\}/g)]
  assert.ok(
    done.some(
      ([, body]) =>
        body.includes('background:var(--color-success)') &&
        body.includes('border-color:var(--color-success)'),
    ),
    'a finished step is not filled with the success colour',
  )
})
