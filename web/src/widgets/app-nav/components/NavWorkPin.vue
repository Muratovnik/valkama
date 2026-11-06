<script setup lang="ts">
/**
 * The pin at the end of a row of the side panel's list: it pins the item to the list, and
 * on a pinned row it is the one mark of the pin and the way to take it off.
 *
 * It stands in a column of its own as tall as the row, with no ground of its own: the
 * row's is under it, and a ground would cover the row's keyboard ring. Whether it is in
 * sight is the row's to say, through `--nav-work-pin-sight`, since only the row knows
 * when the pointer or the keyboard is on it; where nothing can hover it stands.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenNotice } from '@/features/session-open/openNotice.ts'

import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  pinned: boolean
  reference: string
  size: 'rail' | 'touch'
}>()

const { t } = useI18n()
const store = useLiveWorkStore()
const say = useOpenNotice()

const words = computed(() => (props.pinned ? t('liveWork.unpin') : t('liveWork.pin')))
const marks = computed(() => ({
  'pinned': props.pinned,
  'nav-row-pin-touch': props.size === 'touch',
}))

async function toggle() {
  try {
    await store.pin(props.reference, !props.pinned)
  } catch {
    say(t('liveWork.pinFailed'), 'refused')
  }
}
</script>

<template>
  <button
    class="nav-row-pin"
    type="button"
    :class="marks"
    :aria-label="words"
    :title="words"
    @click="toggle"
  >
    <VIcon
      class="nav-row-pin-glyph"
      name="pin"
      :size="14"
    />
  </button>
</template>

<style scoped>
/* Above the row's link, whose box is stretched over the whole row. */
.nav-row-pin {
  position: relative;
  z-index: 1;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  align-self: stretch;
  inline-size: var(--size-control-inline);
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: var(--color-navigation-text-muted);
  background: none;
  border-radius: var(--radius-control);
  cursor: pointer;
  visibility: var(--nav-work-pin-sight, visible);

  &:hover {
    color: var(--color-text-on-dark);
  }

  &:focus-visible {
    outline-offset: -2px;
  }

  @media (hover: none) {
    visibility: visible;
  }

  &.pinned {
    color: var(--color-text-on-dark-muted);
    visibility: visible;

    .nav-row-pin-glyph {
      fill: currentcolor;
    }
  }
}

.nav-row-pin-touch {
  inline-size: var(--size-control-target);
}
</style>
