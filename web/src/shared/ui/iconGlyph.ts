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
  ArrowUp,
  Asterisk,
  Ban,
  BarChart3,
  Bell,
  Bold,
  Bot,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleQuestionMark,
  CircleSlash,
  Code,
  CodeXml,
  Copy,
  CornerDownRight,
  createLucideIcon,
  Database,
  Ellipsis,
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
  Network,
  PanelRightOpen,
  Pause,
  Pin,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Reply,
  RotateCcw,
  Search,
  Settings,
  Shapes,
  SquareKanban,
  SquarePen,
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

/**
 * A client's own mark, as a place to open in: its vendor's shapes, unchanged, filled in the
 * glyph's colour and never the vendor's colours. A mark drawn edge to edge on its square is placed
 * in the 20-unit field a Lucide glyph keeps clear of its 24-unit square's edges, so it stands as
 * large as the outlines beside it; `fit` is that placement. Only a mark whose vendor allows it, or
 * that the owner chose under the vendor's own rule, is drawn (DESIGN.md, the brand exception).
 */
function clientMark(
  name: string,
  fit: string,
  paths: readonly (readonly [d: string, evenOdd: boolean])[],
): Component {
  return createLucideIcon(
    name,
    paths.map(([d, evenOdd]) => [
      'path',
      {
        d,
        fill: 'currentColor',
        stroke: 'none',
        transform: fit,
        ...(evenOdd ? { 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' } : {}),
      },
    ]),
  )
}

/**
 * The sign of a session at work: an open arc that turns. Lucide's `LoaderCircle` draws its arc
 * at radius 9, a unit inside the ring of radius 10 the other four signs share, so at 14px the
 * working ring stood about a pixel narrower than the rest. This is the same arc, its gap where
 * Lucide leaves it, on their ring.
 */
const WORKING_RING = createLucideIcon('session-working', [
  ['path', { d: 'M22 12a10 10 0 1 1-6.91-9.511' }],
])

/**
 * Manifest-owned icon keys. An unknown key intentionally gets one generic glyph (`GENERIC`).
 */
const ICONS: Record<string, Component> = {
  'activity': Activity,
  // What a press could not do, beside what it said; `check` is what it did.
  'alert': CircleAlert,
  'analytics': BarChart3,
  // A way further down or up the same page, which a chevron would read as opening something.
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'bell': Bell,
  'board': SquareKanban,
  // An epic's card, opened beside the board, and its chain drawn on the board: a lane
  // heading's two actions.
  'card': PanelRightOpen,
  'chain': Network,
  'check': Check,
  // Claude keeps a neutral glyph of its own rather than the unknown circle: a session row that
  // says "claude" beside a question mark reports a client the interface does not recognise.
  // Not its mark: Anthropic allows its marks only in materials it approves, and never recoloured.
  'claude': Asterisk,
  // Codex's own icon as OpenAI draws it in one colour: the cloud with a prompt in it, served
  // by chatgpt.com/codex (retrieved 2026-11-08) and the same in the Codex app 26.1103. It is
  // drawn on a 20-unit square, which takes the place of Lucide's 24.
  'codex': clientMark('codex', 'scale(1.2)', [
    [
      'M13.334 11.417C13.701 11.4172 13.9989 11.715 13.9991 12.082C13.9991 12.4491 13.7011 12.7468 13.334 12.7471H10.834C10.4667 12.7471 10.169 12.4493 10.169 12.082C10.1691 11.7149 10.4668 11.417 10.834 11.417H13.334Z',
      false,
    ],
    [
      'M6.74222 7.34569C7.05709 7.15708 7.46546 7.25942 7.65433 7.57421L8.77542 9.44237C8.98061 9.78481 8.98081 10.2133 8.77542 10.5557L7.65433 12.4248C7.46553 12.7393 7.05697 12.8414 6.74222 12.6533C6.42734 12.4644 6.32486 12.0551 6.5137 11.7402L7.55765 9.99901L6.5137 8.2578C6.32498 7.94291 6.42739 7.53459 6.74222 7.34569Z',
      false,
    ],
    [
      'M7.79788 1.78026C9.31113 1.37492 10.8493 1.79464 11.9385 2.75878C13.365 2.46738 14.9091 2.87391 16.0176 3.98241C17.1255 5.09072 17.5303 6.63371 17.2393 8.05956C18.2041 9.14893 18.6251 10.6875 18.2198 12.2012C17.8139 13.715 16.6793 14.837 15.2989 15.2978C14.8382 16.6783 13.7171 17.8128 12.2032 18.2187C10.6893 18.6244 9.15004 18.2033 8.06058 17.2383C6.63475 17.5294 5.09176 17.1246 3.98343 16.0166C2.87526 14.9084 2.46879 13.3647 2.7598 11.9385C1.79537 10.8489 1.37594 9.31012 1.78128 7.79686C2.18691 6.28323 3.31979 5.16038 4.70023 4.69921C5.1613 3.31879 6.28422 2.18595 7.79788 1.78026ZM11.1094 3.79979C10.3375 3.08594 9.23002 2.77333 8.14261 3.06444C7.05488 3.3559 6.25114 4.18036 5.93949 5.18456C5.82791 5.54387 5.54587 5.82695 5.18656 5.93846C4.18211 6.24995 3.35702 7.05347 3.06546 8.14159C2.77429 9.22936 3.08701 10.3376 3.80081 11.1094C4.05589 11.3856 4.15916 11.771 4.0762 12.1377C3.844 13.1631 4.1275 14.2798 4.92386 15.0762C5.72013 15.8721 6.83591 16.1552 7.86136 15.9228L8.00003 15.9004C8.32338 15.868 8.64895 15.9747 8.89066 16.1982C9.66269 16.9123 10.7707 17.225 11.8584 16.9336C12.9458 16.6421 13.749 15.8179 14.0606 14.8135L14.1094 14.6826C14.243 14.3859 14.4987 14.1571 14.8135 14.0596C15.8182 13.7481 16.644 12.9452 16.9356 11.8574C17.2269 10.7698 16.9131 9.66163 16.1993 8.88964C15.9438 8.61338 15.8408 8.22731 15.9239 7.86034C16.1562 6.83493 15.873 5.71912 15.0772 4.92284C14.2807 4.12638 13.1643 3.8428 12.1387 4.07518C11.7718 4.1584 11.3858 4.05506 11.1094 3.79979Z',
      true,
    ],
  ]),
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'close': X,
  'client': Monitor,
  'copy': Copy,
  // Cursor's cube, from Simple Icons 16.37.0 (path data CC0-1.0), which traces the 2D cube
  // of cursor.com/brand; that page gives the cube in one light and one dark colour.
  'cursor': clientMark('cursor', 'translate(2 2) scale(0.8333)', [
    [
      'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
      false,
    ],
  ]),
  'database': Database,
  // What a disclosure draws before its words: shut, and open.
  'disclosure-closed': disclosureGlyph('disclosure-closed', 'm0 18 6-6-6-6'),
  'disclosure-open': disclosureGlyph('disclosure-open', 'm0 9 6 6 6-6'),
  'document': FileText,
  // An editor with no mark of its own, as a place a session or a file opens in.
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
  // A menu of what else can be done to what it stands beside: a card's «…».
  'more': Ellipsis,
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
  // VS Code's icon is Microsoft's white variant (visual-studio-code-icons.zip, version
  // 2021-06-21, from code.visualstudio.com/brand): its outline, unchanged, in the glyph's colour.
  // Microsoft asks for the blue icon and the white one "only when there isn't enough contrast
  // otherwise". Its darkest band, #0065A9, has 2.51:1 on a list or a card (#252525), 1.78:1 on a
  // control (#3d3d3d) and 1.54:1 on a highlighted row (#464646), under the 3:1 a graphic needs
  // (WCAG 1.4.11); #007ACC falls short on the last two as well.
  'vscode': clientMark('vscode', 'translate(2 2) scale(0.2)', [
    [
      'M70.9119 99.5723C72.4869 100.189 74.2828 100.15 75.8725 99.3807L96.4604 89.4231C98.624 88.3771 100 86.1762 100 83.7616V16.2392C100 13.8247 98.624 11.6238 96.4604 10.5774L75.8725 0.619067C73.7862 -0.389991 71.3446 -0.142885 69.5135 1.19527C69.252 1.38636 69.0028 1.59985 68.769 1.83502L29.3551 37.9795L12.1872 24.88C10.5891 23.6607 8.35365 23.7606 6.86938 25.1178L1.36302 30.1525C-0.452603 31.8127 -0.454583 34.6837 1.35854 36.3466L16.2471 50.0001L1.35854 63.6536C-0.454583 65.3164 -0.452603 68.1876 1.36302 69.8477L6.86938 74.8824C8.35365 76.2395 10.5891 76.34 12.1872 75.1201L29.3551 62.0207L68.769 98.1651C69.3925 98.7923 70.1246 99.2645 70.9119 99.5723ZM75.0152 27.1813L45.1092 50.0001L75.0152 72.8189V27.1813Z',
      true,
    ],
  ]),
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
  // The side panel's list of work going on now: its button on a phone's rail, the agents a
  // row counts, and the pin that keeps an item there.
  'live-work': List,
  'agent': Bot,
  'pin': Pin,
  // What a session is doing, as one ring of one size whose inside says it (`SessionSign`):
  // at work, asking a person in the middle of a turn, waiting with its turn over, at work on
  // other items, silent for over a day.
  'session-working': WORKING_RING,
  'session-asks': CircleQuestionMark,
  'session-waiting': CircleCheck,
  'session-held': CirclePause,
  'session-quiet': CircleDashed,
}

/**
 * What an unknown key draws: a generic shape that is none of a session's signs. A question in a
 * ring, the glyph it used to be, is the sign of a session that asks a person (`session-asks`),
 * and an icon a manifest misnamed would have read as one.
 */
const GENERIC: Component = Shapes

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
  const { attributes, strokes } = shapeOf(ICONS[name] ?? GENERIC)
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
