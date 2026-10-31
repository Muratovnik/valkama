<script setup lang="ts">
/**
 * `label` is the accessible name, and it replaces the number for a reader who
 * cannot see what the number is about — a bare "3" overlaying a bell says
 * nothing. It is optional because the opposite case is just as real: a count
 * standing beside its own visible label already reads as "In the catalog 37",
 * and naming it again would override that with a worse sentence.
 *
 * `tone` says what the number is. Most counts describe a list — how many items
 * a lane holds — and stay `quiet`. A count of things waiting for the reader, the
 * questions an agent asked, is work to do: `waiting` gives it a filled ground,
 * so it does not read as the shortcut hint printed beside it in the same grey.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    value: number
    /** The value is a floor: some of what it counts could not be read. */
    incomplete?: boolean
    label?: string
    limit?: number
    placement?: 'overlay' | 'inline'
    tone?: 'quiet' | 'waiting'
  }>(),
  { label: undefined, limit: 99, incomplete: false, placement: 'overlay', tone: 'quiet' },
)

/**
 * Past the limit the badge stops counting and says so, so the glyph stays one
 * shape. A floor gets the same plus, so a reader cannot take it for the whole.
 */
const shownValue = computed(() => {
  if (props.value > props.limit) return `${props.limit}+`
  return props.incomplete ? `${props.value}+` : String(props.value)
})
</script>

<template>
  <span
    class="count-badge"
    :class="[`placement-${placement}`, `tone-${tone}`]"
    :aria-label="label"
    >{{ shownValue }}</span
  >
</template>

<style scoped>
/* A count is metadata, not an alert. Overlaying an icon it needs a ground to
   sit on, so it keeps a surface; standing in its own column it needs nothing
   but the number, and a filled pill there reads as a badge on every row.

   The ring cuts the badge out of whatever it overlaps, so its color is the
   ground under the badge and only the host knows which that is. It used to be
   a two-value `surface` prop — `nav` or `light` — which is the same fact
   spelled as a closed list that every new ground had to be added to; the badge
   in the bell sits on a third one neither name covered. A container states its
   own ground here the way it re-points a ladder role. */
.count-badge {
  position: absolute;
  inset-block-start: -3px;
  inset-inline-end: -3px;
  display: grid;
  place-items: center;

  /* Sized to ride a 20px glyph without becoming the glyph. At 18px with a 4px
     inset it covered two thirds of the bell it was counting, which is a badge
     that has eaten its own subject. */
  min-width: 16px;
  height: 16px;
  padding: 0 var(--space-half);
  border: 1px solid var(--color-count-badge-ring, var(--color-navigation));
  color: var(--color-text);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-flat);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: var(--color-surface-active);
  border-radius: 999px;

  &.placement-inline {
    position: relative;
    inset: auto;
    flex: 0 0 auto;
    min-width: 0;
    height: auto;
    padding: 0;
    border: 0;
    color: var(--color-text-on-dark-muted);
    font-weight: 500;
    background: none;
  }

  /* The overlay's ground and ink, standing in the line: a pill a little wider
     than tall, so one digit and two both read as one shape. */
  &.placement-inline.tone-waiting {
    min-width: 18px;
    height: 18px;
    padding: 0 var(--space-1);
    color: var(--color-text);
    font-weight: 600;
    background: var(--color-surface-active);
    border-radius: 999px;
  }
}
</style>
