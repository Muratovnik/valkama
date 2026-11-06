<script setup lang="ts">
/**
 * One item of the side panel's list: what its session is doing, its number, its title,
 * and how many agents are on it, as one link to its card.
 *
 * The link is the row: its box is stretched over the whole row, so a press anywhere on
 * it opens the card, and it is an address, so a press with a modifier opens it elsewhere
 * as any link does. A group's head has the fold at its start, a button of its own above
 * the link; an item has its sign there instead, in the same width, so the numbers of a
 * group's items stand in one column under the head's. The number's column is as wide
 * as the list's longest number (`NavWorkTree`), so a level's titles start at one x.
 *
 * The sign: three dots that run while the session works on the item, held still while it
 * holds the item and works on others, a ring while it waits for a person, and nothing for
 * an item silent over a day, pinned with no work, or gone from the frame. Those three are
 * muted, and say why in the row's name and hover text; a pinned item that has closed says
 * its state where the agents' count would stand. A colour is never all that says it.
 *
 * The pin is the row's last part, in a column of its own that the rail keeps on every
 * row, so the title's ellipsis and the count stand clear of it, and it comes up under the
 * pointer and focus in the row where a pinned row shows it always (`NavWorkPin`). On a
 * phone there is no pointer to bring it out, so only a pinned row has one, a finger's
 * width wide.
 */
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

import NavWorkPin from '@/widgets/app-nav/components/NavWorkPin.vue'
import { rowNumber } from '@/widgets/app-nav/utils/liveTree.ts'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { ShownRow } from '@/shared/lib/liveWorkRows.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  current: boolean
  depth: number
  /** Where the row leads; null for a space no project binds. */
  route: PlatformRoute | null
  row: ShownRow
  size: 'rail' | 'touch'
  /** A number as wide as the list's longest, which sizes the number's column. */
  widest: string
  /** The fold of a group's head, which an item has not. */
  fold?: { controls: string; id: string; label: string; open: boolean } | null
}>()

const emit = defineEmits<{ fold: []; go: [route: PlatformRoute] }>()

const { d, t } = useI18n()
const store = useLiveWorkStore()

const QUIET_DAY = { month: 'short', day: '2-digit' } as const

/** How many holds this row has on its item: a row folded away or closed with it lets go. */
let holds = 0
function hold(on: boolean) {
  holds += on ? 1 : -1
  store.hold(props.row.reference, on)
}
onBeforeUnmount(() => {
  for (; holds > 0; holds -= 1) store.hold(props.row.reference, false)
})

const muted = computed(
  () =>
    props.row.fading ||
    props.row.state === 'quiet' ||
    props.row.is_terminal ||
    (props.row.state === null && props.row.pinned),
)
/** The dots, the ring or nothing: what the session is doing, while it does something. */
const sign = computed(() => {
  const state = props.row.state
  return props.row.fading || state === null || state === 'quiet' ? null : state
})
const still = computed(() => sign.value === 'held')

/** What the row's state is, in words: the row's name says it, and its hover text. */
const stateWords = computed(() => {
  const { row } = props
  if (row.fading) return t('liveWork.ended')
  if (row.is_terminal) return t('liveWork.closed', { state: row.state_name })
  if (row.state === 'quiet' && row.quiet_since)
    return t('liveWork.quiet', { since: d(new Date(row.quiet_since), QUIET_DAY) })
  if (row.state === null) return row.pinned ? t('liveWork.idle', { state: row.state_name }) : ''
  const doing = t(`liveWork.${row.state}`)
  return row.agents > 0
    ? `${doing}, ${t('liveWork.agents', { count: row.agents }, row.agents)}`
    : doing
})
const said = computed(() => [`${props.row.reference} ${props.row.title}`, stateWords.value])
const name = computed(() => said.value.filter(Boolean).join(' — '))
const hint = computed(() => said.value.filter(Boolean).join('\n'))
const href = computed(() =>
  props.route === null ? undefined : serializePlatformRoute(props.route),
)
const number = computed(() => rowNumber(props.row.reference))
const currentMark = computed(() => (props.current ? ('page' as const) : undefined))
const pinShown = computed(() => props.size === 'rail' || props.row.pinned)
/** What stands at the end of the link: a closed item's state, else how many agents are on it. */
const meta = computed(() => {
  if (props.row.is_terminal) return { agents: false, word: props.row.state_name }
  if (props.row.agents > 0 && !props.row.fading)
    return { agents: true, word: String(props.row.agents) }
  return null
})
const pinned = computed(() => props.row.pinned)
const head = computed(() => Boolean(props.fold))
const touch = computed(() => props.size === 'touch')
const depthStyle = computed(() => ({ '--nav-row-depth': props.depth }))

/** A plain press opens the card in place; with a modifier it is the browser's, as on any link. */
function press(event: MouseEvent) {
  if (props.route === null) return
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('go', props.route)
}
</script>

<template>
  <!-- The pointer and focus on a row hold it while it fades; they are no input of its own. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    class="nav-row"
    :class="{
      current,
      muted,
      pinned,
      'nav-row-head': head,
      'nav-row-touch': touch,
      'nav-row-has-pin': pinShown,
    }"
    :style="depthStyle"
    @pointerenter="hold(true)"
    @pointerleave="hold(false)"
    @focusin="hold(true)"
    @focusout="hold(false)"
  >
    <button
      v-if="fold"
      :id="fold.id"
      class="nav-row-fold"
      type="button"
      :aria-expanded="fold.open"
      :aria-controls="fold.controls"
      :aria-label="fold.label"
      :title="fold.label"
      @click="emit('fold')"
    >
      <VIcon
        class="nav-row-chevron"
        name="chevron-right"
        :size="14"
      />
    </button>
    <span
      v-else
      class="nav-row-lead"
      aria-hidden="true"
    >
      <span
        v-if="sign !== null && sign !== 'waiting'"
        class="work-dots"
        :class="{ still }"
        ><i /><i /><i
      /></span>
      <VIcon
        v-else-if="sign !== null"
        name="live-waiting"
        :size="10"
        :stroke-width="2.4"
      />
    </span>
    <a
      class="nav-row-link"
      :href="href"
      :aria-current="currentMark"
      :aria-label="name"
      :title="hint"
      @click="press"
    >
      <span class="nav-row-numeral">
        <span class="nav-row-number">{{ number }}</span>
        <span
          class="nav-row-widest"
          aria-hidden="true"
          >{{ widest }}</span
        >
      </span>
      <span class="nav-row-title">{{ row.title }}</span>
      <span
        v-if="fold && sign"
        class="nav-row-own"
        aria-hidden="true"
      >
        <span
          v-if="sign !== 'waiting'"
          class="work-dots"
          :class="{ still }"
          ><i /><i /><i
        /></span>
        <VIcon
          v-else
          name="live-waiting"
          :size="10"
          :stroke-width="2.4"
        />
      </span>
      <span
        v-if="meta"
        class="nav-row-meta"
        aria-hidden="true"
      >
        <VIcon
          v-if="meta.agents"
          name="agent"
          :size="12"
        />{{ meta.word }}
      </span>
    </a>
    <NavWorkPin
      v-if="pinShown"
      :pinned="row.pinned"
      :reference="row.reference"
      :size="size"
    />
  </div>
</template>

<style scoped>
/* Lead, then the link holding the number, the title and what stands at the end, then the
   pin on a pinned row, in a column of its own so its room is kept. The lead and the fold
   are one width at every level and a level indents one step from the same start, so the
   folds stand on one grid and a level's numbers in one column (`NavWorkTree` keeps the
   space's head on the same values). */
.nav-row {
  --nav-row-lead: 24px;
  --nav-row-depth: 0;

  position: relative;
  display: grid;
  grid-template-columns: var(--nav-row-lead) minmax(0, 1fr);
  gap: var(--space-1);
  align-items: center;
  min-height: var(--size-control-inline);
  padding-inline: calc(var(--nav-row-depth) * var(--space-3) + var(--space-1)) var(--space-1);
  color: var(--color-text-on-dark-muted);
  border-radius: var(--radius-control);

  &:hover {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-raised);
  }

  &.current {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-active);
  }

  &.muted .nav-row-title {
    color: var(--color-navigation-text-muted);
  }

  /* The pin's column, kept on every row of the rail so nothing under it is ever covered
     and its pin comes up where a pinned row's stands (`NavWorkPin`). */
  &.nav-row-has-pin {
    --nav-work-pin-sight: hidden;

    grid-template-columns: var(--nav-row-lead) minmax(0, 1fr) auto;
  }

  /* Focus anywhere in the row, not only the keyboard's: a pin that hid while focus was
     on its way to it would drop that focus. */
  &:is(:hover, :focus-within) {
    --nav-work-pin-sight: visible;
  }
}

/* A group's head leads its items, as an epic's row does on the board. Only its title is
   strong: its number keeps the weight, and so the width, of every number in its column. */
.nav-row-head .nav-row-title {
  font-weight: 600;
}

.nav-row-lead,
.nav-row-fold {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  inline-size: var(--nav-row-lead);
  color: var(--color-info);
}

.nav-row-fold {
  position: relative;
  z-index: 1;
  min-block-size: var(--size-control-inline);
  padding: 0;
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

  &[aria-expanded='true'] .nav-row-chevron {
    rotate: 90deg;
  }
}

.nav-row-chevron {
  transition: rotate var(--duration-quick) var(--ease-out);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}

/* The link's box is the whole row, so the row opens wherever it is pressed; the fold and
   the pin stand over it. Its ring is the row's, inside it, and only from the keyboard. */
.nav-row-link {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  color: inherit;
  font: var(--font-detail);
  text-decoration: none;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-control);
  }

  &:focus-visible {
    outline: none;

    &::before {
      outline: 2px solid var(--color-focus-ring);
      outline-offset: -2px;
    }
  }
}

/* The number over an unseen one as long as the list's longest, in figures of one width,
   so the column is that wide on every row and a title starts at the same x whatever the
   length of the number before it. */
.nav-row-numeral {
  display: inline-grid;
  flex: none;
  color: var(--color-navigation-text-muted);
  font-variant-numeric: tabular-nums;

  > * {
    grid-area: 1/1;
  }
}

.nav-row-widest {
  visibility: hidden;
}

.nav-row-title {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-row-own {
  display: inline-flex;
  flex: none;
  color: var(--color-info);
}

.nav-row-meta {
  display: inline-flex;
  flex: none;
  gap: var(--space-half);
  align-items: center;
  color: var(--color-navigation-text-muted);
  white-space: nowrap;
}

/* A phone: a finger's row, the reading size, and the pin only where there is one. */
.nav-row-touch {
  --nav-row-lead: 28px;

  min-height: var(--size-control-target);

  .nav-row-link {
    font: var(--font-control);
  }

  .nav-row-fold {
    min-block-size: var(--size-control-target);
  }
}

/* The open row in the system's own pair. Taking the row out of the forced palette takes
   everything in it out too, so every ink in it, the dots and the rings are that pair's:
   a grey number or a CanvasText dot on Highlight is a pair no palette promises. */
@media (forced-colors: active) {
  .nav-row.current {
    color: HighlightText;
    background: Highlight;
    forced-color-adjust: none;

    :is(.nav-row-lead, .nav-row-fold, .nav-row-number, .nav-row-title, .nav-row-own),
    :is(.nav-row-meta, .nav-row-pin) {
      color: HighlightText;
    }

    .work-dots > * {
      background: HighlightText;
    }

    :is(.nav-row-fold, .nav-row-pin):focus-visible,
    .nav-row-link:focus-visible::before {
      outline-color: HighlightText;
    }
  }
}
</style>
