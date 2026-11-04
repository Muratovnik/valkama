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
  CircleHelp,
  CircleSlash,
  Code,
  Copy,
  CornerDownRight,
  Database,
  ExternalLink,
  FileText,
  Filter,
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
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  Settings,
  SquareKanban,
  SquareTerminal,
  TableProperties,
  Terminal,
  TrendingUp,
  User,
  Wrench,
  X,
} from '@lucide/vue'

/** Manifest-owned icon keys. An unknown key intentionally gets one generic glyph. */
const ICONS: Record<string, Component> = {
  'activity': Activity,
  // What a press could not do, beside what it said; `check` is what it did.
  'alert': CircleAlert,
  'analytics': BarChart3,
  'bell': Bell,
  'board': SquareKanban,
  'check': Check,
  // The two agent clients get their own neutral glyph rather than the unknown
  // circle they were falling back to: a session row that says "codex" beside a
  // question mark reports a client the interface does not recognise.
  'claude': Asterisk,
  'codex': SquareTerminal,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'close': X,
  'client': Monitor,
  'copy': Copy,
  'cursor': MousePointer2,
  'database': Database,
  'document': FileText,
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
