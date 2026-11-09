<script setup lang="ts">
/**
 * Once for a whole surface, what keeps its sessions from opening when the reason is this
 * computer's: a program they would open in is not installed. Each of those sessions stands
 * as a mark that says the same in its name (`missingPlaces`). Nothing while none is missing.
 */
import { useI18n } from 'vue-i18n'

import { useMissingPlaces } from '@/features/session-open/missingPlaces.ts'
import { placeKey } from '@/features/session-open/placeWords.ts'

import VIcon from '@/shared/ui/VIcon.vue'

const { t } = useI18n()
const places = useMissingPlaces()
</script>

<template>
  <div
    v-if="places.length"
    class="missing-places"
  >
    <p
      v-for="host in places"
      :key="host"
      class="missing-place"
    >
      <VIcon
        class="missing-place-glyph"
        name="info"
        :size="14"
      />
      <span>{{
        t('open.missing', { place: t(placeKey({ opened_in: '', opened_host: host })) })
      }}</span>
    </p>
  </div>
</template>

<style scoped>
.missing-places {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

/* The mark the sessions carry, before the words that explain it, on their first line. */
.missing-place {
  display: flex;
  gap: var(--space-1);
  align-items: flex-start;
  min-width: 0;
  max-width: 72ch;
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.missing-place-glyph {
  block-size: 1lh;
}
</style>
