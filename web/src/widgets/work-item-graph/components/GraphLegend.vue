<script setup lang="ts">
/**
 * The key to the field: which place in the chain each marker colour is, and
 * which line is a block and which only context.
 *
 * It stands in the field's strip above the flow rather than in the bar. In the
 * bar it shared one row with the chip, the switch and the frontier count, and at
 * any width under a wide monitor it wrapped — and wrapped again when the closed
 * members brought «Done» into it, pushing the whole field down under the
 * operator's pointer. Off the flow, no node is ever drawn under it.
 *
 * It names only what the field draws. «Done» is the one entry the closed switch
 * adds, so while the chain has closed members its place is kept, unseen, before
 * the others: the switch never moves a word of the key.
 *
 * A line live work runs along is named only while some work on the field moves,
 * and a session's sign (`SessionSign`) only while a card on the field draws it:
 * the same glyph at the same size, held still, with what it means — at work, asking
 * a person in the middle of a turn, waiting with the turn over, holding the item
 * while at work on others, silent for over a day. The card's own word is short, and
 * «спрашивает» and «ждёт» are two waits a reader has to tell apart.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import type { LiveSign } from '@/shared/lib/liveSign.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import SessionSign from '@/shared/ui/SessionSign.vue'

const props = defineProps<{
  /** The chain groups the field draws. */
  groups: readonly ChainGroup[]
  hasEdges: boolean
  /** The chain has closed members, so «Done» may come and go: its place is kept. */
  keepDone: boolean
  /**
   * The one state a group's members share, said in the group's place as the
   * card's chain section and the board's column say it; null keeps the group's word.
   */
  names: Readonly<Record<ChainGroup, string | null>>
  /** Some live work on the field moves, so its line is drawn. */
  moving?: boolean
  /** The sessions' signs the cards on the field draw, in the order the key names them. */
  signs?: readonly LiveSign[]
}>()
const { t } = useI18n()

/** Done leads, as on the card's map: what is finished, then what is under way, then ahead. */
const entries = computed(() => {
  const shown = new Set(props.groups)
  const open = props.groups.filter((group) => group !== 'done')
  const done =
    shown.has('done') || props.keepDone
      ? [{ group: 'done' as const, shown: shown.has('done') }]
      : []
  return [...done, ...open.map((group) => ({ group, shown: true }))]
})
</script>

<template>
  <div
    v-if="entries.length || hasEdges || moving || signs?.length"
    class="graph-legend"
    aria-hidden="true"
  >
    <SemanticState
      v-for="entry in entries"
      :key="entry.group"
      class="graph-legend-state"
      dimension="work-item-chain-group"
      :class="{ held: !entry.shown }"
      :state="entry.group"
      :label="names[entry.group] ?? t(`workItem.chain.group.${entry.group}`)"
    />
    <template v-if="hasEdges">
      <span class="graph-legend-item"><i class="stroke solid" />{{ t('graph.edgeBlocks') }}</span>
      <span class="graph-legend-item"
        ><i class="stroke dashed" />{{ t('graph.edgeDiscovered') }}</span
      >
    </template>
    <span
      v-if="moving"
      class="graph-legend-item"
      ><i class="stroke live" />{{ t('graph.edgeLive') }}</span
    >
    <span
      v-for="sign in signs"
      :key="sign"
      class="graph-legend-item graph-legend-sign"
      :data-sign="sign"
      ><SessionSign
        :sign="sign"
        still
      />{{ t(`graph.legendSign.${sign}`) }}</span
    >
  </div>
</template>

<style scoped>
.graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-4);
  justify-content: flex-end;
  align-items: center;
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  font: var(--font-count);
  background: var(--color-surface-recess);
  border-radius: var(--radius-status);
}

/* Kept, not drawn: the place «Done» takes when the closed members are shown. */
.graph-legend-state.held {
  visibility: hidden;
}

.graph-legend-item {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: 24px;
  white-space: nowrap;
}

.stroke {
  width: 18px;
  border-top: 2px solid var(--color-graph-line);

  &.dashed {
    border-top-style: dashed;
  }

  /* A live line as it stands still: wider, in the hue of work under way. */
  &.live {
    border-top-width: 3px;
    border-top-color: var(--color-info);
  }
}
</style>
