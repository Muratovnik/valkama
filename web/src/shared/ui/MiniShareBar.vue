<script setup lang="ts">
/**
 * How a whole splits among its first parts, at a glance: one thin bar the width of its host, a
 * part as long as its share, largest first, and what the parts leave out last in the neutral.
 * It reads as one image whose words (`label`) name every part with its share, so no part is told
 * by its hue alone: the parts are apart by a gap of ground and in the order the words say them.
 *
 * A part takes the hue `seriesSlots()` pinned to its name (`slot`), and the rest `other`, the
 * neutral a folded tail is drawn in everywhere. A forced palette draws the parts in its ink and
 * the rest in its quiet ink, with the gaps between them. With no part to draw — nothing spent —
 * the bar is its empty track, the same size, so a host never moves when its figures arrive.
 *
 * Presentational: nothing in it acts, and nothing in it moves under the pointer.
 */
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'

export interface SharePart {
  key: string
  /** The part's share of the whole, from 0 to 1. */
  share: number
  /** The part's hue; `other` for what the named parts leave out. */
  slot: SeriesSlot
}

defineProps<{
  /** The parts and their shares, in words, for a reader who cannot see them. */
  label: string
  parts: readonly SharePart[]
}>()

/** A part's length: its share of the bar, the gaps taken out of every part alike. */
const partStyle = (part: SharePart) => ({ flexGrow: part.share })
</script>

<template>
  <span
    class="mini-share-bar"
    role="img"
    :class="{ 'mini-share-empty': !parts.length }"
    :aria-label="label"
  >
    <span
      v-for="part in parts"
      :key="part.key"
      class="mini-share-part series-fill"
      :data-key="part.key"
      :data-slot="part.slot"
      :style="partStyle(part)"
    />
  </span>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped>
/* As thin as a ranked bar and rounded at both ends. The gap between two parts is the host's
   own ground, so nothing but the parts is painted. */
.mini-share-bar {
  display: flex;
  gap: var(--space-half);
  min-inline-size: 0;
  block-size: var(--space-2);
  overflow: hidden;
  border-radius: 999px;

  /* With nothing to share, the track alone, in the line the scale's steps are drawn in. */
  &.mini-share-empty {
    background: var(--color-rule);

    @media (forced-colors: active) {
      background: GrayText;
      forced-color-adjust: none;
    }
  }
}

.mini-share-part {
  display: block;
  flex: 0 1 0;
  min-inline-size: var(--space-hair);
}
</style>
