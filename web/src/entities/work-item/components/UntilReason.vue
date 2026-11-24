<script setup lang="ts">
/**
 * Why work cannot be put off yet, under the choice of when it comes back (`UntilChoice`), in a
 * room held for every reason it can come to say (`heldRoom.css`): each `untilProblem` gives and
 * each of the place's own (`also`). A value becoming valid takes the reason away and moves
 * nothing, and neither does one reason taking another's place. Given its room only while it
 * stood, it took the room away with it: the press beside the reason moved, and so did what stood
 * under it, or the whole window it was centred in.
 *
 * The reason shown is `id`, which the press it keeps unavailable names as its description; the
 * copies that hold its room are neither seen nor heard.
 *
 * Why the last write was refused (`refusal`) stands in the same room, after the reason when both
 * stand, in the danger's ink and announced. Under the room, at the end of the form, it stood
 * across the room's empty height from the field it followed.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { UNTIL_PROBLEMS } from '@/entities/work-item/components/UntilChoice.vue'

const props = withDefaults(
  defineProps<{
    /** The id of the reason shown, for the press it keeps unavailable to name. */
    id: string
    /** Why it cannot be put off yet; empty once it can. */
    reason: string
    /** The reasons of the place's own it can come to say, besides the choice's. */
    also?: readonly string[]
    /** Why the last write was refused; empty while none was. */
    refusal?: string
  }>(),
  { also: () => [], refusal: '' },
)
const { t } = useI18n()
const room = computed(() => [
  ...new Set([...props.also, ...Object.values(UNTIL_PROBLEMS).map((key) => t(key))]),
])
</script>

<template>
  <div class="held-room">
    <div class="until-said">
      <p
        v-if="reason"
        :id="id"
        class="until-reason"
      >
        {{ reason }}
      </p>
      <p
        v-if="refusal"
        class="until-refusal"
        role="alert"
      >
        {{ refusal }}
      </p>
    </div>
    <p
      v-for="word in room"
      :key="word"
      class="held-room-unseen until-reason-room"
      aria-hidden="true"
    >
      {{ word }}
    </p>
  </div>
</template>

<style scoped src="@/shared/ui/heldRoom.css"></style>

<style scoped>
.until-said {
  display: grid;
  gap: var(--space-1);
  align-content: start;
  min-width: 0;
}

.until-reason,
.until-reason-room,
.until-refusal {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.until-refusal {
  color: var(--color-danger);
}
</style>
