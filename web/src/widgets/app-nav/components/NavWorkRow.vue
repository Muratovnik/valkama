<script setup lang="ts">
/**
 * One item of the side panel's list: what its session is doing, its number, the title of
 * the item it belongs to, muted, then its own title, and how many agents are on it, as one
 * link to its card.
 *
 * The link is the row: its box is stretched over the whole row, so a press anywhere on
 * it opens the card, and it is an address, so a press with a modifier opens it elsewhere
 * as any link does. The row starts with its lead, which holds the item's sign. The lead is
 * one width on every row, so the signs stand in one column and the numbers in the next;
 * the number's column is as wide as the list's longest number (`NavWorkTree`), so what
 * follows starts at one x. On a phone a closed item with no sign has no lead at all: its
 * number stands a lead to the left of the open rows' numbers, and its title takes the room.
 *
 * The parent's title is the row's context, not its name: it gives way first, never taking
 * more than two fifths of the room, and the row's own title keeps the rest. Both stay on
 * one line, cut by an ellipsis, and the row's hint then says both whole.
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
import { rowNumber } from '@/widgets/app-nav/utils/liveList.ts'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { ShownRow } from '@/shared/lib/liveWorkRows.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
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
  /** The title of the item this one belongs to, said before its own; null for none. */
  epic?: string | null
}>()

const emit = defineEmits<{ go: [route: PlatformRoute] }>()

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
const epicWords = computed(() => (props.epic ? t('liveWork.partOf', { title: props.epic }) : ''))
const said = computed(() => [
  `${props.row.reference} ${props.row.title}`,
  epicWords.value,
  stateWords.value,
])
const name = computed(() => said.value.filter(Boolean).join(' — '))
const hint = computed(() => said.value.filter(Boolean).join('\n'))
/**
 * The row's hint stands beside the whole row, clear of its ring: while its title is cut, or
 * always on a muted row, whose reason no mark on it shows. The phone's panel is as wide as the
 * window and has no room beside a row, and a finger shows no hint.
 */
const rowHint = computed(() =>
  props.size === 'touch' ? null : { text: hint.value, clipped: !muted.value },
)
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
const touch = computed(() => props.size === 'touch')
/** A closed item on a phone has no sign, so its lead has nothing to hold: it goes. */
const leadless = computed(() => touch.value && props.row.is_terminal && sign.value === null)
const depthStyle = computed(() => ({ '--nav-row-depth': props.depth }))
/** How many letters the epic's title has: a short one keeps no more room than its letters. */
const epicStyle = computed(() => ({ '--nav-row-epic-letters': `${props.epic?.length ?? 0}ch` }))

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
    v-tooltip:right="rowHint"
    class="nav-row reveal-row"
    :class="{
      current,
      muted,
      pinned,
      'nav-row-touch': touch,
      'nav-row-has-pin': pinShown,
      'nav-row-leadless': leadless,
    }"
    :style="depthStyle"
    @pointerenter="hold(true)"
    @pointerleave="hold(false)"
    @focusin="hold(true)"
    @focusout="hold(false)"
  >
    <span
      v-if="!leadless"
      class="nav-row-lead"
    >
      <span
        v-if="sign !== null"
        class="nav-row-sign"
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
    </span>
    <a
      class="nav-row-link"
      :href="href"
      :aria-current="currentMark"
      :aria-label="name"
      @click="press"
    >
      <span class="nav-row-numeral">
        <span class="nav-row-number trimmed-word">{{ number }}</span>
        <span
          class="nav-row-widest trimmed-word"
          aria-hidden="true"
          >{{ widest }}</span
        >
      </span>
      <template v-if="epic">
        <span
          class="nav-row-epic trimmed-word"
          :style="epicStyle"
          >{{ epic }}</span
        >
        <span
          class="nav-row-epic-mark trimmed-word"
          aria-hidden="true"
          >›</span
        >
      </template>
      <span class="nav-row-title trimmed-word">{{ row.title }}</span>
      <span
        v-if="meta"
        class="nav-row-meta"
        aria-hidden="true"
      >
        <VIcon
          v-if="meta.agents"
          name="agent"
          :size="12"
        /><span class="trimmed-word">{{ meta.word }}</span>
      </span>
    </a>
    <NavWorkPin
      v-if="pinShown"
      class="nav-row-pin"
      :pinned="row.pinned"
      :reference="row.reference"
      :size="size"
    />
  </div>
</template>

<style scoped>
/* Lead, then the link holding the number, the titles and what stands at the end, then the
   pin in a column of its own where the row has one. The lead is one width on every row and
   a row indents one step from the space's start, so the signs stand in one column and the
   numbers in the next (`NavWorkTree` keeps the space's head and the folded row on the same
   values). The sign takes the lead's end. */
.nav-row {
  --nav-row-lead: 24px;
  --nav-row-sign: var(--nav-row-lead);
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
    grid-template-columns: var(--nav-row-lead) minmax(0, 1fr) auto;
  }

  /* A closed row on a phone holds no lead: its track and the gap after it go, so its title
     takes the room (`leadless`). Nested so it outranks the pin's column above. */
  &.nav-row-leadless {
    grid-template-columns: minmax(0, 1fr);

    &.nav-row-has-pin {
      grid-template-columns: minmax(0, 1fr) auto;
    }
  }
}

/* The sign stands in the lead's one cell, as tall as the row. */
.nav-row-lead {
  display: grid;
  grid-template-areas: 'lead';
  align-items: center;
  align-self: stretch;
  inline-size: var(--nav-row-lead);

  > * {
    grid-area: lead;
  }
}

.nav-row-sign {
  display: inline-flex;
  justify-content: center;
  justify-self: end;
  align-items: center;
  inline-size: var(--nav-row-sign);
  color: var(--color-info);
  pointer-events: none;
}

/* The link's box is the whole row, so the row opens wherever it is pressed; the pin
   stands over it. Its ring is the row's, inside it, and only from the keyboard. Its
   words are trimmed to their capitals (`.trimmed-word`), so the capitals' middle is the row's,
   where the lead's sign stands: centred as lines, they stood up to a pixel over the sign. */
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
      outline: var(--size-focus-ring) solid var(--color-focus-ring);
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

/* The parent's title, the row's context: muted, and the first to give way. It shrinks six
   times as fast as the row's own title, down to a few letters of it that the hint completes
   (or all of a shorter one), and never takes more than two fifths of the link. Cut sideways
   only, like every word of the row (`.trimmed-word`). */
.nav-row-epic {
  --nav-row-epic-letters: 3ch;

  flex: 0 6 auto;
  min-width: min(3ch, var(--nav-row-epic-letters));
  max-width: 40%;
  color: var(--color-navigation-text-muted);
  white-space: nowrap;
}

.nav-row-epic-mark {
  flex: none;
  color: var(--color-navigation-text-muted);
}

/* Short of room it ends in an ellipsis, cut sideways only (`.trimmed-word`). */
.nav-row-title {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
}

.nav-row-meta {
  display: inline-flex;
  flex: none;
  gap: var(--space-half);
  align-items: center;
  color: var(--color-navigation-text-muted);
  white-space: nowrap;
}

/* A phone: a finger's row and lead, the reading size, and the pin only where there is
   one. The sign keeps to the lead's end. */
.nav-row-touch {
  --nav-row-lead: var(--size-control-target);
  --nav-row-sign: var(--size-control-inline);

  min-height: var(--size-control-target);

  .nav-row-link {
    font: var(--font-control);
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

    :is(.nav-row-sign, .nav-row-number, .nav-row-epic, .nav-row-epic-mark, .nav-row-title),
    :is(.nav-row-meta, .nav-row-pin) {
      color: HighlightText;
    }

    .work-dots > * {
      background: HighlightText;
    }

    .nav-row-pin:focus-visible,
    .nav-row-link:focus-visible::before {
      outline-color: HighlightText;
    }
  }
}
</style>
