<script lang="ts">
/**
 * How far a space's name stands in from the list's start in the phone's panel: the head's
 * padding, the fold's finger-wide lead and the gap after it, as the style below lays out.
 */
export const NAME_INDENT_TOUCH = 'calc(var(--size-control-target) + var(--space-1) * 2)'
</script>

<script setup lang="ts">
/**
 * The side panel's list: each space the frame names, folded or open, with its work
 * under it, and what is at work in no row.
 *
 * Every row's number stands in a column as wide as the list's longest number, so the
 * titles of a level start at one x whatever their numbers' length.
 *
 * A space's head is its key and name, which lead to its board, and a fold before them as
 * a group's head has, in the same column. Under its rows the space says how many agents
 * are at work in it on no row, «no task · N agents», as a caption and not a place to go;
 * the agents whose folder is under no space are said once, after every space. With
 * nothing to show the list says that nobody is working, quietly, in the room a row takes,
 * as a caption of what holds it: under the rail entry's label, which the rail's group
 * hands down as `--nav-label-start` (`NavModuleList`), and in the phone's panel where the
 * spaces' names would start, which is where its heading starts (`NAME_INDENT_TOUCH`).
 *
 * On the rail Escape folds the innermost open group or space around focus and gives focus
 * to its fold; folded, the next Escape goes on to the one around it, and past the spaces
 * to the list itself (`NavWorkGroup`). In the phone's panel Escape closes the panel.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import NavWorkBranch from '@/widgets/app-nav/components/NavWorkBranch.vue'
import type { NavNode, NavOpen } from '@/widgets/app-nav/composables/useNavOpen.ts'
import { liveTree, rowNumber } from '@/widgets/app-nav/utils/liveTree.ts'

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
  elsewhere: number
  open: NavOpen
  prefix: string
  shown: NavShown | null
  size: 'rail' | 'touch'
  spaces: readonly ShownSpace[]
  target: NavTarget
}>()

const emit = defineEmits<{ go: [route: PlatformRoute] }>()

const { t } = useI18n()

interface SpaceTree {
  branch: string
  fold: string
  folded: boolean
  href: string | undefined
  label: string
  node: NavNode
  route: PlatformRoute | null
  space: ShownSpace
  tree: ReturnType<typeof liveTree>
  rowRoute: (reference: string) => PlatformRoute | null
}

const trees = computed<SpaceTree[]>(() =>
  props.spaces.map((space) => {
    const node: NavNode = `space:${space.key}`
    const route = props.target({ key: space.key, project_id: space.project_id, reference: null })
    return {
      branch: `${props.prefix}-space-${space.key}`,
      fold: `${props.prefix}-space-${space.key}-fold`,
      folded: !props.open.isOpen(node),
      href: route === null ? undefined : serializePlatformRoute(route),
      label: t('liveWork.space', { key: space.key, name: space.name }),
      node,
      route,
      rowRoute: (reference: string) =>
        props.target({ key: space.key, project_id: space.project_id, reference }),
      space,
      tree: liveTree(space.rows),
    }
  }),
)
const touch = computed(() => props.size === 'touch')
const empty = computed(() => props.spaces.length === 0 && props.elsewhere === 0)
/** A number as wide as the list's longest, which sizes every row's number column. */
const widest = computed(() => {
  const lengths = props.spaces.flatMap((space) =>
    space.rows.map((row) => rowNumber(row.reference).length),
  )
  return '0'.repeat(Math.max(1, ...lengths))
})
const elsewhereWords = computed(() =>
  t('liveWork.elsewhere', { count: props.elsewhere }, props.elsewhere),
)

/** A name cut short says itself beside the rail; the phone's panel has no room beside it. */
const nameHint = (entry: SpaceTree) => (touch.value ? null : entry.label)
const foldLabel = (entry: SpaceTree) => t('liveWork.group', { name: entry.label })
const unplacedWords = (entry: SpaceTree) =>
  t('liveWork.unplaced', { count: entry.space.unplaced }, entry.space.unplaced)
const currentIn = (entry: SpaceTree) =>
  props.shown?.key === entry.space.key ? props.shown.reference : null
const spaceCurrent = (entry: SpaceTree) =>
  props.shown?.key === entry.space.key && props.shown.reference === null ? 'page' : undefined

function toggle(entry: SpaceTree) {
  props.open.set(entry.node, entry.folded)
}

function pressSpace(event: MouseEvent, entry: SpaceTree) {
  if (entry.route === null || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('go', entry.route)
}

/** Fold the innermost open group or space around focus, and give focus to its fold. */
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
        :key="entry.space.key"
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
            v-else
            v-tooltip:right.detail="t('liveWork.noProject')"
            class="nav-tree-space-name one-line"
            >{{ entry.label }}</span
          >
        </div>
        <div
          v-show="!entry.folded"
          :id="entry.branch"
          class="nav-tree-body"
        >
          <NavWorkBranch
            v-if="entry.tree.length > 0"
            :current="currentIn(entry)"
            :depth="1"
            :nodes="entry.tree"
            :open="open"
            :prefix="prefix"
            :route="entry.rowRoute"
            :size="size"
            :widest="widest"
            @go="(next) => emit('go', next)"
          />
          <p
            v-if="entry.space.unplaced > 0"
            class="nav-tree-note nav-tree-note-nested"
          >
            <span
              v-tooltip.clipped="unplacedWords(entry)"
              class="nav-tree-note-words one-line"
              >{{ unplacedWords(entry) }}</span
            >
          </p>
        </div>
      </li>
    </ul>
    <p
      v-if="elsewhere > 0"
      class="nav-tree-note"
    >
      <span
        v-tooltip.clipped="elsewhereWords"
        class="nav-tree-note-words one-line"
        >{{ elsewhereWords }}</span
      >
    </p>
  </div>
</template>

<style scoped>
/* The column every level counts from: the start padding of a row at depth 0 and the
   width of the lead its fold stands in. A row of the levels below indents by one step of
   12px a level from the same start (`NavWorkRow`, with the same values), so the folds of
   all levels stand on one grid and the numbers of one level in one column. On a phone the
   lead is a finger wide and the arrow keeps to the room before a row's sign. */
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
.nav-tree-body {
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
