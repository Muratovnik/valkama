<script setup lang="ts">
/**
 * A quiet note of what a part of the page could not read, said in room the part keeps for it while
 * its answer stands: every form it can say stands unseen in its place (`heldRoom.css`), and the one
 * said, or nothing, over them. A read that fails after the answer is drawn, or the next answer that
 * takes the note away, then moves nothing under it. Said in room of its own, the note that the
 * period before was not read took a line under a value's days and moved the panel's lists 25px
 * down.
 *
 * What a reader of the page selects it by: `data-held` — `said` the words said now, `room` each
 * form kept unseen.
 */
withDefaults(
  defineProps<{
    /** Every form the note can take, whose room it keeps. */
    room: readonly string[]
    /** What it says now; empty while nothing failed. */
    said?: string
  }>(),
  { said: '' },
)
</script>

<template>
  <div class="held-room">
    <p
      v-for="form in room"
      :key="form"
      class="held-note-words held-room-unseen"
      data-held="room"
      aria-hidden="true"
    >
      {{ form }}
    </p>
    <p
      class="held-note-words"
      data-held="said"
    >
      {{ said }}
    </p>
  </div>
</template>

<style scoped src="@/shared/ui/heldRoom.css"></style>

<style scoped>
.held-note-words {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
