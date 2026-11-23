<script setup lang="ts" generic="P extends string">
/**
 * The bar over a page read by a period: the periods, with the ends of the reader's own beside them,
 * its two days or the name of a span between two moments (`PeriodOwnDays`); the page's filters
 * (the default slot); and what the page says at the line's end (`end`), such as how fresh its
 * figures are and a read of them again. It stays where it is while what is under it scrolls,
 * since it says what everything under it is of. It holds no words of its own: the periods' names,
 * the fields' names and the filters are the page's.
 *
 * The bar is one line wherever it has room for the periods, their days and the line's end, so what
 * stands under it never moves with what the bar holds: the filters take the room the rest leaves,
 * and what they open lies over what is under the bar. A bar with no room for that one line is two
 * rows of one height whatever period is chosen: the periods and the filters, then the ends of the
 * reader's own period at the start of the second and the line's end at its end.
 *
 * A line with no room for all of that gives up what matters least first, in the order the page
 * names (`order`), and never runs past its end (`useBarRoom`): the words of the buttons (`words`,
 * which the slots hear as `short`), the room between its parts (`gaps`), a span's name, cut at its
 * end with its hint saying it whole (`span`), and between them what the page names of its own
 * (`gave`, which the bar exposes). A line that runs past its end with all of that given up gives up the one line last,
 * and is the two rows of a narrower bar, which take their words back. A bar narrower than `lineRoom`
 * ems and wider than a phone is two rows from the start. News the line may come to say is held
 * while it is fitted (`held`): the page draws its room unseen, so news said moves nothing.
 *
 * On a phone the bar is two rows: the periods across the whole of the first, on as many lines as
 * they need, in columns of one width (`SegmentedControl`'s `wrap`), so every period stands whole
 * and the lines break at the same edges; under it the
 * filters and the line's end. The reader's own days take a third row once they are chosen. The
 * line's end lends its parts to the second row, where the page places them on the bar's grid of
 * four columns. A page whose second row has no room for its news on the narrowest phone stands a
 * part of it at the end of the periods' row there instead (`beside`), on the third and fourth
 * columns the periods leave it.
 *
 * What the page stands under the line (`under`), such as the chips of the filters set, is a row of
 * its own under it; on a phone it stands right under the filters' row, and the reader's own days
 * under it, so what was set stands next to where it was set.
 *
 * A filter the page could not set says why under the bar (`refused`).
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useElementSize } from '@vueuse/core'

import PeriodOwnDays from '@/widgets/period-bar/components/PeriodOwnDays.vue'
import { useBarRoom } from '@/widgets/period-bar/composables/useBarRoom.ts'

import FieldError from '@/shared/ui/FieldError.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const props = withDefaults(
  defineProps<{
    /** The ends of the reader's own period, its days or the moments of a span. */
    from: string
    /** Below this many ems, wider than a phone, the one line has no room whatever is chosen. */
    lineRoom: number
    /** The parts the line gives up, in turn: `words`, `gaps` and `span`, and the page's own. */
    order: readonly string[]
    /** The period chosen; `custom` is the reader's own, whose ends stand beside the periods. */
    period: P
    /** The periods, in the bar's order, by their names. */
    periods: readonly { label: string; value: P }[]
    to: string
    /** The day the read was asked on, the last a custom period can name. */
    today: string
    /** The periods' name, the own days' fields' names and what a reversed period says. */
    words: { from: string; label: string; reversed: string; to: string }
    /**
     * Whether the page stands a part of the line's end beside the periods on the narrowest phone,
     * where the row under them has no room for all of it.
     */
    beside?: boolean
    /** What else changes what the line holds, which it is fitted again for. */
    holds?: readonly unknown[]
    /** Why the last filter asked for was not set; empty otherwise. */
    refused?: string
    /** The name of the reader's own span between two moments; null for a span of days. */
    spanName?: string | null
    /** Whether what the page stands under the line (`under`) holds anything now. */
    under?: boolean
    /** Whether words on the line that may wrap short of room took a second line to stand in. */
    wrapped?: (line: HTMLElement) => boolean
  }>(),
  {
    beside: false,
    holds: () => [],
    refused: '',
    spanName: null,
    under: false,
    wrapped: undefined,
  },
)
/** A period chosen, or a day of the reader's own set anew. */
const emit = defineEmits<{
  days: [next: { from: string } | { to: string }]
  period: [period: P]
}>()

/** What the slots are told: whether the bar is short of room for words, and being fitted. */
type BarState = { held: boolean; short: boolean }
defineSlots<{
  /** The page's filters, which take the room the rest of the line leaves. */
  default?: (state: BarState) => unknown
  /** What stands at the line's end; its last element is what the line must not run past. */
  end?: (state: BarState) => unknown
  /** What stands under the line: a row of its own, on a phone right under the filters. */
  under?: (state: BarState) => unknown
}>()

const { locale } = useI18n()

const line = useTemplateRef<HTMLElement>('line')
const end = useTemplateRef<HTMLElement>('end')

/** A width in the root's ems, as the bar's container queries count it. */
function ems(width: number) {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return width / rem
}

const room = useBarRoom({
  line,
  last: () => end.value?.lastElementChild as HTMLElement | null | undefined,
  wrapped: () => (line.value && props.wrapped ? props.wrapped(line.value) : false),
  order: () => props.order,
  observed: [line],
  narrow: () => {
    const wide = ems(line.value?.getBoundingClientRect().width ?? 0)
    return wide > 30 && wide < props.lineRoom
  },
  holds: [() => [props.period, props.from, props.to], () => props.holds, locale],
})

/**
 * Whether the bar says its buttons by their icons: on a phone, or on a line that had to give their
 * words up.
 */
const bar = useTemplateRef<HTMLElement>('bar')
const { width: barWidth } = useElementSize(bar)
/** Whether the bar has a phone's rows, as its container query says (`width <= 30rem`). */
const phone = computed(() => {
  const wide = ems(barWidth.value)
  return wide > 0 && wide <= 30
})
const short = computed(() => phone.value || room.gave('words'))
/** Whether the room between the parts narrowed, and a span's name is cut. */
const tight = computed(() => room.gave('gaps'))
const spanCut = computed(() => room.gave('span'))
/** Whether the bar is two rows: too narrow for one line, or with no room for it after all. */
const twoRows = room.rows
/** Whether the line is being fitted, news holding its room unseen. */
const held = room.holding

const state = computed<BarState>(() => ({ held: held.value, short: short.value }))

/** Whether the line has given up a part, by its name in `order`. */
defineExpose({ gave: room.gave })
</script>

<template>
  <div
    ref="bar"
    class="period-bar"
    :class="{
      'period-bar-tight': tight,
      'period-bar-rows': twoRows,
      'period-bar-beside': beside,
      'period-bar-under': under,
    }"
  >
    <div
      ref="line"
      class="period-bar-line"
    >
      <SegmentedControl
        class="period-bar-periods"
        size="compact"
        :label="words.label"
        :model-value="period"
        :options="periods"
        wrap
        @update:model-value="(chosen) => emit('period', chosen)"
      />
      <PeriodOwnDays
        v-if="period === 'custom'"
        class="period-bar-own"
        :cut="spanCut"
        :from="from"
        :span-name="spanName"
        :to="to"
        :today="today"
        :words="words"
        @days="(next) => emit('days', next)"
      />
      <slot v-bind="state" />
      <div
        ref="end"
        class="period-bar-end"
      >
        <slot
          name="end"
          v-bind="state"
        />
      </div>
      <slot
        v-if="phone"
        name="under"
        v-bind="state"
      />
    </div>
    <slot
      v-if="!phone"
      name="under"
      v-bind="state"
    />
    <FieldError
      v-if="refused"
      role="alert"
    >
      {{ refused }}
    </FieldError>
  </div>
</template>

<style scoped>
/* Over what is under it, so what the filters open stands over that too. */
.period-bar {
  position: relative;
  z-index: 1;
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  container-type: inline-size;
}

/* What stands under the line, and a refusal under that, stand as far apart from it as the Work
   bar's row from its line: a row away, the chips of a filter set read as the page's, not the
   bar's. */
.period-bar-under {
  gap: var(--space-2);
}

/* The periods, their days, the filters and the line's end on one line: the filters take the room
   the rest leaves and give it up first, and then the line gives up its words and the room between
   its parts (`useBarRoom`). A bar with no room for it is two rows (below). */
.period-bar-line {
  position: relative;
  display: flex;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  min-width: 0;
}

.period-bar-periods {
  flex: none;
}

.period-bar-end {
  display: flex;
  flex: 0 1 auto;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  min-width: 0;
  margin-inline-start: auto;
}

/* Two rows (`period-bar-rows`, `useBarRoom`): the periods and the filters, then the ends of the
   reader's own period at the second row's start and the line's end at its end. A bar too narrow
   for the one line is two rows from the start, whatever period is chosen. Otherwise a row wrapped
   when a part came and moved everything under the bar down: in Analytics, beside the periods, an
   own period's ends pushed the filters and then the freshness onto a third row, and the panel
   moved down 44px. A wider bar is two rows only when its one line, with every other part given
   up, still runs past its end. A bar that has room for the one line stays one line.

   The second row never wraps again, news said on it included: it gives way as the one line does,
   so nothing under the bar moves. Pressed past its room it runs past its end, where the room it
   gives way by is measured, and not past its start. Wider than a phone (below), the two rows are
   the line wrapped at a break of no height (`::before`) before the second row's parts, which
   carry the room between the rows themselves, so the break does not add that room twice. */
@container (width > 30rem) {
  .period-bar-rows .period-bar-line {
    flex-wrap: wrap;
    row-gap: 0;

    &::before {
      content: '';
      flex-basis: 100%;
      order: 1;
    }

    & > :is(.period-bar-own, .period-bar-end) {
      order: 1;
      margin-block-start: var(--space-2);
    }
  }

  .period-bar-rows .period-bar-end {
    flex: 1 1 0;
    justify-content: safe flex-end;
  }
}

/* A phone: two rows. The periods across the whole first row, shared among them on its one line
   and wrapping onto more lines of the track where it has no room for them, in columns of one
   width (`wrap`); the filters and the line's end the row under it. Each wrapped line sharing its
   own room, the breaks of two lines missed each other: at 390px Analytics' five stood three over
   two, the four of Agent decisions three over one. The periods' row scrolled sideways instead,
   beside the line's end: at 390px it opened on «Сегодня» cut by 14px and hid «Свой» past its
   edge. The reader's own days take a row of their own only once they are chosen: a row held for
   them under every other period stood as a band of 72px between the filters and the figures. The
   line's end lends the second row its parts, which the page places on the four columns: the first
   as wide as its row leaves it, the three after it as wide as what stands in them. */
@container (width <= 30rem) {
  .period-bar-line {
    display: grid;
    grid-template-rows: auto auto;
    grid-template-columns: minmax(min-content, 1fr) auto auto auto;
    gap: var(--space-2);
  }

  .period-bar-end {
    display: contents;
  }

  .period-bar-periods {
    grid-area: 1 / 1 / 2 / -1;
  }

  .period-bar-own {
    grid-area: 3 / 1 / 4 / -1;
  }

  /* What stands under the line takes the row right under the filters' (the page places it on the
     third), and the reader's own days move under it: under their room the chips of a filter set
     stood a row away from the field whatever period was chosen. */
  .period-bar-under .period-bar-own {
    grid-area: 4 / 1 / 5 / -1;
  }
}

/* The narrowest phone, a window of about 375px or less, where the page asks for it (`beside`):
   the periods leave the third and fourth columns of their row to a part of the line's end, and
   wrap in what they keep. At 360px a failed refresh in Russian, beside the filter, the freshness
   and the read again, had room only for three lines and ran 2px past the row's end. */
@container (width < 18rem) {
  .period-bar-beside .period-bar-periods {
    grid-area: 1 / 1 / 2 / 3;
  }
}

/* A line that gave up everything else narrows the room between its parts. */
.period-bar-tight :is(.period-bar-line, .period-bar-end) {
  column-gap: var(--space-2);
}

/* A phone's rows already part their parts by that narrow gap; giving it up, they narrow it again,
   which news said beside the filter and the line's end needs. */
@container (width <= 30rem) {
  .period-bar-tight .period-bar-line {
    column-gap: var(--space-1);
  }
}
</style>
