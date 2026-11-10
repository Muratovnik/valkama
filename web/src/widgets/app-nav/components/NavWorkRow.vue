<script setup lang="ts">
/**
 * One row of the side panel's list: an item, or a session on no item. It leads with what its
 * session is doing, then says what it is (`NavWorkLink`): the item's number or the session's
 * glyph, its title, and how many agents are on it. A row of the work to follow now has a
 * second line under the title, smaller and muted: the state in a word, how long, and where it
 * belongs (`secondLine`). A row in a fold or among the pinned keeps to one line, an item's
 * epic before its title.
 *
 * An item's row is one link to its card and a session's row is one button that opens the
 * session (`useOpenPress`): its box is stretched over the whole row, so a press anywhere on
 * it acts, and an item's link is an address, so a press with a modifier opens it elsewhere
 * as any link does. The lead is one width on every row, so the signs stand in one column and
 * the numbers in the next (`NavWorkTree`). On a phone a closed item with no sign has no lead
 * at all: its number stands a lead to the left of the open rows' numbers, and its title takes
 * the room.
 *
 * The first line is a row of one line, whatever follows it: the sign, the number, the title
 * and the controls at the end stand where they stand on a row that has no second line. The
 * row's hint and its accessible name say the whole row in a sentence (`rowSentence`).
 *
 * The sign is the session's (`SessionSign`). An item pinned with no work, or gone from the
 * frame, has none. Quiet, pinned idle and gone rows are muted; a pinned item that has closed
 * says its state where the agents' count would stand. A colour is never all that says it. A
 * session that leaves the frame leaves at once; an item stays a while, muted (`liveWorkStore`).
 *
 * An item's row ends with «Open session» where a session stands behind it (`NavWorkOpen`), and
 * with the pin (`NavWorkPin`), each in a column of its own that the rail keeps on every row, so
 * the title's ellipsis and the count stand clear of them and a session's row, which has neither,
 * keeps its count where an item's stands. On a phone only a pinned row has a pin.
 */
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

import NavWorkLink from '@/widgets/app-nav/components/NavWorkLink.vue'
import NavWorkOpen from '@/widgets/app-nav/components/NavWorkOpen.vue'
import NavWorkPin from '@/widgets/app-nav/components/NavWorkPin.vue'
import { useMinuteClock } from '@/widgets/app-nav/composables/useMinuteClock.ts'
import { rowNumber } from '@/widgets/app-nav/utils/liveList.ts'
import type { ItemEntry, LiveEntry } from '@/widgets/app-nav/utils/liveList.ts'
import { rowSentence, secondLine, sessionTitle } from '@/widgets/app-nav/utils/liveWords.ts'

import OpenPanel from '@/features/session-open/OpenPanel.vue'
import { useOpenPress } from '@/features/session-open/openPress.ts'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { liveSign } from '@/shared/lib/liveSign.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import SessionSign from '@/shared/ui/SessionSign.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  current: boolean
  entry: LiveEntry
  /** Two for the work to follow now: the state in words under the title. */
  lines: 1 | 2
  /** Where an item's row leads; null for a session, and for a space no project binds. */
  route: PlatformRoute | null
  size: 'rail' | 'touch'
  /** A number as wide as the list's longest, which sizes the number's column. */
  widest: string
}>()

const emit = defineEmits<{ go: [route: PlatformRoute] }>()

const { d, t } = useI18n()
const stateName = useStateName()
const store = useLiveWorkStore()
const now = useMinuteClock()

const row = computed(() => (props.entry.kind === 'item' ? props.entry.row : null))
const session = computed(() => (props.entry.kind === 'session' ? props.entry.session : null))
/** The item's state as the owner has states named; a row carries its name alone. */
const words = { d, t, stateName: (item: ItemEntry['row']) => stateName({ name: item.state_name }) }

/** How many holds this row has on its item: a row folded away or closed with it lets go. */
let holds = 0
function hold(on: boolean) {
  if (row.value === null) return
  holds += on ? 1 : -1
  store.hold(row.value.reference, on)
}
onBeforeUnmount(() => {
  for (; holds > 0; holds -= 1) if (row.value) store.hold(row.value.reference, false)
})

const muted = computed(() => {
  if (row.value === null) return false
  const { fading, is_terminal, pinned, state } = row.value
  return fading || state === 'quiet' || is_terminal || (state === null && pinned)
})
/** What the session is doing, while the frame still has the row. */
const sign = computed(() => {
  const live = row.value ?? session.value
  return live === null || row.value?.fading ? null : liveSign(live.state, live.asks)
})

const title = computed(() =>
  props.entry.kind === 'item' ? props.entry.row.title : sessionTitle(t, props.entry),
)
const epic = computed(() =>
  props.entry.kind === 'item' && props.lines === 1 ? props.entry.epic : null,
)
const detail = computed(() => (props.lines === 2 ? secondLine(t, props.entry, now.value) : ''))
const sentence = computed(() => rowSentence(words, props.entry, now.value))
/** The whole row in a sentence beside it, on the rail; a phone has no room beside it. */
const rowHint = computed(() => (props.size === 'touch' ? null : sentence.value))

const href = computed(() =>
  props.route === null ? undefined : serializePlatformRoute(props.route),
)
const number = computed(() => (row.value ? rowNumber(row.value.reference) : ''))
/** What stands at the end of the link: a closed item's state, else how many agents are on it. */
const meta = computed(() => {
  if (row.value?.is_terminal) return { agents: false, word: words.stateName(row.value) }
  const agents = (row.value ?? session.value)?.agents ?? 0
  return agents > 0 && !row.value?.fading ? { agents: true, word: String(agents) } : null
})
const touch = computed(() => props.size === 'touch')
const pinShown = computed(() => row.value !== null && (!touch.value || row.value.pinned))
/** The session behind an item, which «Open session» opens, while the frame has the row. */
const opens = computed(() => {
  const executor = row.value?.executor
  return executor?.session && !row.value?.fading ? { ...executor, session: executor.session } : null
})
/** The rail keeps the columns of «Open session» and the pin on every row, filled or not. */
const ends = computed(() =>
  touch.value ? { open: false, pin: false } : { open: !opens.value, pin: !pinShown.value },
)
/** A closed item on a phone has no sign, so its lead has nothing to hold: it goes. */
const leadless = computed(
  () => touch.value && row.value?.is_terminal === true && sign.value === null,
)
const depthStyle = { '--nav-row-depth': 1 }
const rowClass = computed(() => ({
  'current': props.current,
  'muted': muted.value,
  'pinned': row.value?.pinned,
  'nav-row-two': props.lines === 2,
  'nav-row-touch': touch.value,
  'nav-row-leadless': leadless.value,
}))

const {
  busy,
  finished,
  panel,
  press: open,
} = useOpenPress(
  () => ({
    kind: 'session',
    session: session.value?.session ?? '',
    family: session.value?.executor.family || undefined,
  }),
  () => title.value,
)
/** The link's own: an item's address and whether it is on show, a session's glyph and press. */
const link = computed(() =>
  row.value === null
    ? ({
        'tag': 'button',
        'glyph': true,
        'type': 'button',
        'aria-busy': busy.value || undefined,
      } as const)
    : ({
        'tag': 'a',
        'glyph': false,
        'href': href.value,
        'aria-current': props.current ? 'page' : undefined,
      } as const),
)

/** A plain press opens the card in place; with a modifier it is the browser's, as on any link. */
function press(event: MouseEvent) {
  if (session.value !== null) {
    void open()
    return
  }
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
    v-tooltip:right.detail="rowHint"
    class="nav-row reveal-row"
    :class="rowClass"
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
        <SessionSign :sign="sign" />
      </span>
    </span>
    <NavWorkLink
      v-bind="link"
      class="nav-row-link"
      :aria-label="sentence"
      :detail="detail"
      :epic="epic"
      :meta="meta"
      :number="number"
      :title="title"
      :widest="widest"
      @click="press"
    />
    <NavWorkOpen
      v-if="row && opens"
      :executor="opens"
      :reference="row.reference"
      :title="row.title"
      :size="size"
    />
    <span
      v-if="ends.open"
      class="nav-row-end"
    />
    <NavWorkPin
      v-if="row && pinShown"
      class="nav-row-pin"
      :pinned="row.pinned"
      :reference="row.reference"
      :size="size"
    />
    <span
      v-if="ends.pin"
      class="nav-row-end"
    />
    <OpenPanel
      v-if="panel"
      :actions="panel.actions"
      :context="title"
      :notice="panel.notice"
      :offer="panel.offer"
      :opens="panel.opens"
      @close="panel = null"
      @finished="finished"
    />
  </div>
</template>

<style scoped>
/* Lead, then the link holding the number, the words and the second line, then the controls at
   the end, each in a column of its own. The lead is one width on every row and a row indents
   one step from the space's start, so the signs stand in one column and the numbers in the
   next (`NavWorkTree` keeps the space's head and the folds on the same values). The first line
   is as tall as a row of one line (`--nav-row-line`), and the lead, the sign and the controls
   stand on it; the second line tucks under it. */
.nav-row {
  --nav-row-lead: 24px;
  --nav-row-sign: var(--nav-row-lead);
  --nav-row-line: var(--size-control-inline);
  --nav-row-tuck: var(--space-1);
  --nav-row-depth: 0;

  position: relative;
  display: grid;
  grid-template-columns: var(--nav-row-lead) minmax(0, 1fr);
  grid-auto-columns: auto;
  grid-auto-flow: column;
  gap: var(--space-1);
  align-items: start;
  min-height: var(--nav-row-line);
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

  /* The link's words take the row's inks (`NavWorkLink`): a muted row's title is muted too. */
  &.muted {
    --nav-row-title-ink: var(--color-navigation-text-muted);
  }

  /* A closed row on a phone holds no lead: its track and the gap after it go, so its title
     takes the room (`leadless`). */
  &.nav-row-leadless {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* The sign stands in the lead's one cell, as tall as the first line. */
.nav-row-lead {
  display: grid;
  grid-template-areas: 'lead';
  align-items: center;
  inline-size: var(--nav-row-lead);
  block-size: var(--nav-row-line);

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
  pointer-events: none;
}

/* What the rail keeps where a row has no «Open session» or no pin: their column, empty. */
.nav-row-end {
  inline-size: var(--size-control-inline);
}

/* A phone: a finger's row and lead, the reading size, and the pin only where there is one.
   The sign keeps to the lead's end, and the second line tucks further up the taller line. */
.nav-row-touch {
  --nav-row-lead: var(--size-control-target);
  --nav-row-sign: var(--size-control-inline);
  --nav-row-line: var(--size-control-target);
  --nav-row-tuck: var(--space-3);

  .nav-row-link {
    font: var(--font-control);
  }

  .nav-row-end {
    display: none;
  }
}

/* The open row in the system's own pair. Taking the row out of the forced palette takes
   everything in it out too, so every ink in it and the sign are that pair's: a grey number
   or a CanvasText sign on Highlight is a pair no palette promises. The sign takes the ink of
   the lead it stands in, and the link's words take it through the row's inks. */
@media (forced-colors: active) {
  .nav-row.current {
    --nav-row-aside-ink: HighlightText;
    --nav-row-title-ink: HighlightText;

    color: HighlightText;
    background: Highlight;
    forced-color-adjust: none;

    .nav-row-sign,
    .nav-row-pin {
      color: HighlightText;
    }

    .nav-row-pin:focus-visible,
    .nav-row-link:focus-visible::before {
      outline-color: HighlightText;
    }
  }
}
</style>
