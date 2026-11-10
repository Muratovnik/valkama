<script lang="ts">
/**
 * How far a space's name stands in from the list's start in the phone's panel: the head's
 * padding, the fold's finger-wide lead and the gap after it, as the style below lays out.
 */
export const NAME_INDENT_TOUCH = 'calc(var(--size-control-target) + var(--space-1) * 2)'
</script>

<script setup lang="ts">
/**
 * The side panel's list: each space the frame names, folded or open, with its work under it,
 * and after them the sessions that are under no space.
 *
 * Under a space's head stands the work to follow now, items and the sessions on no item in
 * one run, a row that asks first and then the freshest, each on two lines (`liveList`). Then
 * up to three rows fold the rest, each drawn only when it holds something and named by what
 * it holds: the items held by a session at work on others, what has waited for over four
 * hours, and the items silent for over a day. Each starts folded, opens in place and keeps
 * its place when it does, so nothing above it moves. Last, under a caption of their own, the
 * pinned items not on view. The sessions under no space stand under a head of their own,
 * with their own fold of long waits.
 *
 * Every row's number stands in a column as wide as the list's longest number, folded rows
 * included, so the titles start at one x and opening a fold widens nothing.
 *
 * A space's head is its key and name, which lead to its board, and a fold before them in
 * the lead's column. With nothing to show the list says that nobody is working, quietly,
 * in the room a row takes, as a caption of what holds it: under the rail entry's label,
 * which the rail's group hands down as `--nav-label-start` (`NavModuleList`), and in the
 * phone's panel where the spaces' names would start, which is where its heading starts
 * (`NAME_INDENT_TOUCH`).
 *
 * On the rail Escape folds the fold or the space around focus and gives focus to its fold;
 * folded, the next Escape goes on to the one around it, and past the spaces to the list
 * itself (`NavWorkGroup`). In the phone's panel Escape closes the panel.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import NavWorkFold from '@/widgets/app-nav/components/NavWorkFold.vue'
import NavWorkRows from '@/widgets/app-nav/components/NavWorkRows.vue'
import type { NavNode, NavOpen } from '@/widgets/app-nav/composables/useNavOpen.ts'
import { liveList, rowNumber } from '@/widgets/app-nav/utils/liveList.ts'
import type { LiveEntry, LiveList } from '@/widgets/app-nav/utils/liveList.ts'

import type { LiveSession } from '@/shared/api/liveFrameModel.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { ShownSpace } from '@/shared/lib/liveWorkRows.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

/** Which space and card are on show, so their rows can say so. */
export interface NavShown {
  key: string
  reference: string | null
}

/** Where a space or one of its rows leads, as the shell routes it. */
export type NavTarget = (place: {
  key: string
  project_id: string | null
  reference: string | null
}) => PlatformRoute | null

const props = defineProps<{
  /** The sessions whose folder lies under no space. */
  elsewhere: readonly LiveSession[]
  open: NavOpen
  prefix: string
  shown: NavShown | null
  size: 'rail' | 'touch'
  spaces: readonly ShownSpace[]
  target: NavTarget
}>()

const emit = defineEmits<{ go: [route: PlatformRoute] }>()

const { t } = useI18n()

/** A row that folds some of a space's work away, and the rows it folds. */
interface Fold {
  entries: readonly LiveEntry[]
  fold: string
  id: string
  node: NavNode
  open: boolean
  words: string
}

/** A space, or the sessions under none (`space` null): its head, its rows and its folds. */
interface SpaceTree {
  branch: string
  fold: string
  folded: boolean
  folds: Fold[]
  href: string | undefined
  key: string
  label: string
  list: LiveList
  node: NavNode
  pinnedHeading: string
  route: PlatformRoute | null
  space: ShownSpace | null
  rowRoute: (reference: string) => PlatformRoute | null
}

/** The folds in the order they stand, and the words each is named by. */
const FOLDS = [
  ['held', 'liveWork.heldMore'],
  ['long', 'liveWork.longMore'],
  ['quiet', 'liveWork.quietMore'],
] as const

/** The folds of a list, each drawn only when it holds something; `at` makes their ids. */
function foldsOf(list: LiveList, key: string, at: string): Fold[] {
  return FOLDS.filter(([kind]) => list[kind].length > 0).map(([kind, words]) => {
    const node: NavNode = `${kind}:${key}`
    const id = `${props.prefix}-${kind}-${at}`
    const count = list[kind].length
    const [open, said] = [props.open.isOpen(node), t(words, { count }, count)]
    return { entries: list[kind], fold: `${id}-fold`, id, node, open, words: said }
  })
}

function spaceTree(space: ShownSpace): SpaceTree {
  const node: NavNode = `space:${space.key}`
  const route = props.target({ key: space.key, project_id: space.project_id, reference: null })
  const list = liveList(space.rows, space.sessions)
  return {
    branch: `${props.prefix}-space-${space.key}`,
    fold: `${props.prefix}-space-${space.key}-fold`,
    folded: !props.open.isOpen(node),
    folds: foldsOf(list, space.key, space.key),
    href: route === null ? undefined : serializePlatformRoute(route),
    key: space.key,
    label: t('liveWork.space', { key: space.key, name: space.name }),
    list,
    node,
    pinnedHeading: `${props.prefix}-pinned-${space.key}`,
    route,
    rowRoute: (reference: string) =>
      props.target({ key: space.key, project_id: space.project_id, reference }),
    space,
  }
}

/** The sessions under no space, as a space of their own with no board and no items. */
function elsewhereTree(): SpaceTree {
  const list = liveList([], props.elsewhere)
  return {
    branch: `${props.prefix}-elsewhere`,
    fold: `${props.prefix}-elsewhere-fold`,
    folded: !props.open.isOpen('elsewhere'),
    folds: foldsOf(list, '', 'elsewhere'),
    href: undefined,
    key: '',
    label: t('liveWork.elsewhere'),
    list,
    node: 'elsewhere',
    pinnedHeading: '',
    route: null,
    rowRoute: () => null,
    space: null,
  }
}

const trees = computed<SpaceTree[]>(() => [
  ...props.spaces.map((space) => spaceTree(space)),
  ...(props.elsewhere.length > 0 ? [elsewhereTree()] : []),
])
const touch = computed(() => props.size === 'touch')
const empty = computed(() => trees.value.length === 0)
/** A number as wide as the list's longest drawn, folded or not, which sizes every number column. */
const widest = computed(() => {
  const entries = trees.value.flatMap(({ list }) => Object.values(list).flat())
  const numbers = entries.map((entry) => (entry.kind === 'item' ? entry.row.reference : '0'))
  return '0'.repeat(Math.max(1, ...numbers.map((reference) => rowNumber(reference).length)))
})

/** A name cut short says itself beside the rail; the phone's panel has no room beside it. */
const nameHint = (entry: SpaceTree) => (touch.value ? null : entry.label)
const foldLabel = (entry: SpaceTree) => t('liveWork.group', { name: entry.label })
const currentIn = (entry: SpaceTree) =>
  entry.space !== null && props.shown?.key === entry.key ? props.shown.reference : null
const spaceCurrent = (entry: SpaceTree) =>
  entry.space !== null && props.shown?.key === entry.key && props.shown.reference === null
    ? 'page'
    : undefined

function toggle(entry: SpaceTree) {
  props.open.set(entry.node, entry.folded)
}

function toggleFold(fold: Fold) {
  props.open.set(fold.node, !fold.open)
}

function pressSpace(event: MouseEvent, entry: SpaceTree) {
  if (entry.route === null || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('go', entry.route)
}

/** Fold the innermost open node around focus, and give focus to its fold. */
function escape(event: KeyboardEvent) {
  if (props.size !== 'rail' || !(event.target instanceof Element)) return
  let group = event.target.closest<HTMLElement>('[data-nav-node]')
  while (group) {
    const node = group.dataset.navNode as NavNode
    if (props.open.isOpen(node)) {
      event.preventDefault()
      event.stopPropagation()
      props.open.set(node, false)
      group.querySelector<HTMLElement>(`#${CSS.escape(group.dataset.navFold ?? '')}`)?.focus()
      return
    }
    group = group.parentElement?.closest<HTMLElement>('[data-nav-node]') ?? null
  }
}
</script>

<template>
  <!-- The keys land here on their way up from the controls inside the list. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    class="nav-tree"
    :class="{ 'nav-tree-touch': touch }"
    @keydown.esc="escape"
  >
    <p
      v-if="empty"
      class="nav-tree-note nav-tree-empty"
    >
      <span
        v-tooltip.clipped="t('liveWork.empty')"
        class="nav-tree-note-words one-line"
        >{{ t('liveWork.empty') }}</span
      >
    </p>
    <ul
      v-else
      class="nav-tree-spaces"
    >
      <li
        v-for="entry in trees"
        :key="entry.node"
        class="nav-tree-space"
        :data-nav-node="entry.node"
        :data-nav-fold="entry.fold"
      >
        <div class="nav-tree-head">
          <button
            :id="entry.fold"
            v-tooltip.name="foldLabel(entry)"
            class="nav-tree-fold"
            type="button"
            :aria-expanded="!entry.folded"
            :aria-controls="entry.branch"
            :aria-label="foldLabel(entry)"
            @click="toggle(entry)"
          >
            <VIcon
              class="nav-tree-chevron"
              name="chevron-right"
              :size="14"
            />
          </button>
          <a
            v-if="entry.href"
            v-tooltip:right.clipped="nameHint(entry)"
            class="nav-tree-space-name nav-tree-space-link one-line"
            :href="entry.href"
            :aria-current="spaceCurrent(entry)"
            @click="pressSpace($event, entry)"
            >{{ entry.label }}</a
          >
          <span
            v-else-if="entry.space"
            v-tooltip:right.detail="{ text: t('liveWork.noProject'), words: entry.label }"
            class="nav-tree-space-name one-line"
            >{{ entry.label }}</span
          >
          <span
            v-else
            v-tooltip:right.clipped="nameHint(entry)"
            class="nav-tree-space-name one-line"
            >{{ entry.label }}</span
          >
        </div>
        <div
          v-show="!entry.folded"
          :id="entry.branch"
          class="nav-tree-body"
        >
          <NavWorkRows
            v-if="entry.list.live.length > 0"
            :entries="entry.list.live"
            :current="currentIn(entry)"
            :lines="2"
            :route="entry.rowRoute"
            :size="size"
            :widest="widest"
            @go="(next) => emit('go', next)"
          />
          <NavWorkFold
            v-for="fold in entry.folds"
            :key="fold.node"
            :entries="fold.entries"
            :fold-id="fold.fold"
            :list-id="fold.id"
            :node="fold.node"
            :open="fold.open"
            :words="fold.words"
            :current="currentIn(entry)"
            :route="entry.rowRoute"
            :size="size"
            :widest="widest"
            @toggle="toggleFold(fold)"
            @go="(next) => emit('go', next)"
          />
          <div
            v-if="entry.list.pinned.length > 0"
            class="nav-tree-pinned"
            role="group"
            :aria-labelledby="entry.pinnedHeading"
          >
            <p
              :id="entry.pinnedHeading"
              class="nav-tree-note nav-tree-note-nested"
            >
              <span class="nav-tree-note-words">{{ t('liveWork.pinnedGroup') }}</span>
            </p>
            <NavWorkRows
              :entries="entry.list.pinned"
              :current="currentIn(entry)"
              :lines="1"
              :route="entry.rowRoute"
              :size="size"
              :widest="widest"
              @go="(next) => emit('go', next)"
            />
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* The column the list counts from: the start padding of a space's head and the width of
   the lead its fold stands in. A row indents by one step of 12px from the same start
   (`NavWorkRow`, with the same values), and so does each row that folds work away, so
   their folds and signs stand in one column and their numbers and words in the next. On a
   phone the lead is a finger wide and the arrow keeps to the room before a row's sign. */
.nav-tree {
  --nav-tree-lead: 24px;
  --nav-tree-arrow-end: 0;

  display: grid;
  gap: var(--space-half);
  min-width: 0;
}

.nav-tree-spaces {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.nav-tree-space,
.nav-tree-body,
.nav-tree-pinned {
  display: grid;
  gap: var(--space-half);
}

.nav-tree-head {
  display: grid;
  grid-template-columns: var(--nav-tree-lead) minmax(0, 1fr);
  gap: var(--space-1);
  align-items: center;
  min-height: var(--size-control-inline);
  padding-inline: var(--space-1);
}

.nav-tree-fold {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  inline-size: var(--nav-tree-lead);
  min-block-size: var(--size-control-inline);
  padding-block: 0;
  padding-inline: 0 calc(var(--nav-tree-arrow-end));
  border: 0;
  color: var(--color-navigation-text-muted);
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    color: var(--color-text-on-dark);
  }

  &:focus-visible {
    outline-offset: -2px;
  }

  &[aria-expanded='true'] .nav-tree-chevron {
    rotate: 90deg;
  }
}

.nav-tree-chevron {
  transition: rotate var(--duration-quick) var(--ease-out);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}

.nav-tree-space-name {
  justify-self: start;
  max-width: 100%;
  color: var(--color-navigation-text-muted);
  font: var(--font-group-heading);
  text-decoration: none;
  border-radius: var(--radius-status);
}

.nav-tree-space-link {
  &:hover,
  &[aria-current='page'] {
    color: var(--color-text-on-dark);
  }

  &:focus-visible {
    outline-offset: 0;
  }
}

/* A caption, not a place: its words start where the names of its level do. */
.nav-tree-note {
  display: flex;
  align-items: center;
  min-height: var(--size-control-inline);
  padding-inline: calc(var(--nav-tree-lead) + var(--space-1) * 2) var(--space-1);
  margin: 0;
  color: var(--color-navigation-text-muted);
  font: var(--font-detail);
}

.nav-tree-note-nested {
  padding-inline-start: calc(var(--space-3) + var(--nav-tree-lead) + var(--space-1) * 2);
}

/* With no space to name, the line is a caption of what holds the list: under the rail
   entry's label, and in the phone's panel where a name would start. */
.nav-tree-empty {
  --nav-tree-empty-start: var(--nav-label-start, calc(var(--nav-tree-lead) + var(--space-1) * 2));

  padding-inline-start: calc(var(--nav-tree-empty-start));
}

.nav-tree-touch {
  --nav-tree-lead: var(--size-control-target);
  --nav-tree-arrow-end: var(--size-control-inline);

  .nav-tree-head,
  .nav-tree-note {
    min-height: var(--size-control-target);
  }

  .nav-tree-fold {
    min-block-size: var(--size-control-target);
  }
}
</style>
