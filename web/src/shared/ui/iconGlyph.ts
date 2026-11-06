/**
 * The glyphs of the interface as plain elements, and which glyph each icon key
 * draws.
 *
 * A Lucide icon is a function that draws a function that draws an `svg`, and
 * Vue gives each of those a component instance of its own; a board of a few
 * hundred glyphs paid for two of them under every one, each to arrive at the
 * same few attributes and strokes. So each icon is drawn through its public
 * component once, its finished `svg` is read, and every later glyph of that
 * icon is the one element with those attributes and that shape inside it.
 *
 * Something that prints many glyphs takes `iconGlyph` directly and spends no
 * instance on them; everything else keeps `VIcon`.
 */
import { h, render } from 'vue'
import type { Component, VNode } from 'vue'

import {
  Activity,
  ArrowDown,
  Asterisk,
  Ban,
  BarChart3,
  Bell,
  Bold,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Code,
  CodeXml,
  Copy,
  CornerDownRight,
  createLucideIcon,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Flag,
  Hash,
  Info,
  Italic,
  Languages,
  Layers,
  LibraryBig,
  Link,
  List,
  ListChecks,
  Menu,
  MessageSquare,
  Monitor,
  MousePointer2,
  Network,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Reply,
  RotateCcw,
  Search,
  Settings,
  SquareKanban,
  SquarePen,
  SquareTerminal,
  TableProperties,
  Terminal,
  TrendingUp,
  User,
  Wrench,
  X,
} from '@lucide/vue'

/**
 * A disclosure's chevron, folded and open: the set's own two strokes, moved so that each starts
 * on its square's start edge. The set draws a chevron inside a 24-unit square with bearings that
 * differ by direction, the folded one from 9 units in and the open one from 6, so a toggle that
 * stood the square on its column's edge drew its mark 6px in while folded and 4px in while open,
 * and each disclosure made that up, or did not, on its own. Drawn from the edge, the mark stands
 * where a heading's first letter does in both states, and the square keeps its size, so the
 * words after it do not move. The round caps reach half a stroke past the edge and stay drawn.
 */
function disclosureGlyph(name: string, path: string): Component {
  const drawn = createLucideIcon(name, [['path', { d: path }]])
  return (props: Record<string, unknown>) => h(drawn, { ...props, overflow: 'visible' })
}

/** Manifest-owned icon keys. An unknown key intentionally gets one generic glyph. */
const ICONS: Record<string, Component> = {
  'activity': Activity,
  // What a press could not do, beside what it said; `check` is what it did.
  'alert': CircleAlert,
  'analytics': BarChart3,
  // A way further down the same page, which a chevron would read as opening something.
  'arrow-down': ArrowDown,
  'bell': Bell,
  'board': SquareKanban,
  // An epic's card, opened beside the board, and its chain drawn on the board: a lane
  // heading's two actions.
  'card': PanelRightOpen,
  'chain': Network,
  'check': Check,
  // The two agent clients get their own neutral glyph rather than the unknown
  // circle they were falling back to: a session row that says "codex" beside a
  // question mark reports a client the interface does not recognise.
  'claude': Asterisk,
  'codex': SquareTerminal,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'close': X,
  'client': Monitor,
  'copy': Copy,
  'cursor': MousePointer2,
  'database': Database,
  // What a disclosure draws before its words: shut, and open.
  'disclosure-closed': disclosureGlyph('disclosure-closed', 'm0 18 6-6-6-6'),
  'disclosure-open': disclosureGlyph('disclosure-open', 'm0 9 6 6 6-6'),
  'document': FileText,
  // An editor, as a place a session or a file opens in: VS Code and its kin share it, and
  // an agent's own app takes its client's glyph above.
  'editor': CodeXml,
  // Changing what is written: a document in the owner's editor, an answer in its form.
  'edit': SquarePen,
  // Another window: a document's own page, which the viewer's head opens.
  'external-link': ExternalLink,
  'filters': Filter,
  // The address of an item, to hand to someone; the editor's own link is `format-link`.
  'link': Link,
  'info': Info,
  'improvements': Wrench,
  'layout-dashboard': SquareKanban,
  'chart-no-axes-combined': BarChart3,
  'key-round': LibraryBig,
  'settings-2': Settings,
  'language': Languages,
  'menu': Menu,
  'message-square': MessageSquare,
  // The graph's one switch for live work moving: stop it, or let it run.
  'pause': Pause,
  'play': Play,
  'plus': Plus,
  'refresh': RefreshCw,
  'search': Search,
  'sessions': RadioTower,
  'skills': LibraryBig,
  'settings': Settings,
  'terminal': Terminal,
  'table': TableProperties,
  // A work item's facets. A plain task and a medium priority have no glyph:
  // the norm is not drawn.
  'kind-bug': Bug,
  'kind-epic': Layers,
  'kind-improvement': TrendingUp,
  'priority-urgent': ChevronsUp,
  'priority-high': ChevronUp,
  'priority-low': ChevronDown,
  'state-cancelled': CircleSlash,
  'waiting': Ban,
  'holder': User,
  'parent': CornerDownRight,
  'steps': ListChecks,
  // What a person does to text in the editor's toolbar.
  'format-bold': Bold,
  'format-code': Code,
  'format-italic': Italic,
  'format-link': Link,
  'format-list': List,
  'mention': Hash,
  // What a person does to an entry of a discussion. The mark's own glyph says the talk
  // stopped and how to start it again, and has no colour of success.
  'reply': Reply,
  'resolve': CircleCheck,
  'reopen': RotateCcw,
  'outcome': Flag,
}

interface GlyphShape {
  attributes: Record<string, string>
  strokes: readonly (readonly [string, Record<string, string>])[]
}

const attributesOf = (element: Element) =>
  Object.fromEntries([...element.attributes].map(({ name, value }) => [name, value]))

const shapes = new Map<Component, GlyphShape>()

function shapeOf(icon: Component): GlyphShape {
  const known = shapes.get(icon)
  if (known) return known
  const host = document.createElement('div')
  render(h(icon, { 'aria-hidden': 'true' }), host)
  const drawn = host.firstElementChild
  const shape: GlyphShape = {
    attributes: drawn ? attributesOf(drawn) : {},
    strokes: [...(drawn?.children ?? [])].map(
      (stroke) => [stroke.tagName, attributesOf(stroke)] as const,
    ),
  }
  render(null, host)
  shapes.set(icon, shape)
  return shape
}

export interface GlyphOptions {
  class?: string
  size?: number
  strokeWidth?: number
}

/** One glyph as a plain `svg` element, ready to be placed in a render. */
export function iconGlyph(name: string, options: GlyphOptions = {}): VNode {
  const { size = 20, strokeWidth = 1.8, class: extra } = options
  const { attributes, strokes } = shapeOf(ICONS[name] ?? CircleHelp)
  return h(
    'svg',
    {
      ...attributes,
      'class': extra === undefined ? attributes.class : `${attributes.class} ${extra}`,
      'width': size,
      'height': size,
      'stroke-width': strokeWidth,
    },
    strokes.map(([tag, stroke]) => h(tag, stroke)),
  )
}
