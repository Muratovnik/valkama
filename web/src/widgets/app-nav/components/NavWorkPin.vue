<script setup lang="ts">
/**
 * The pin at the end of a row of the side panel's list: it pins the item to the list, and
 * on a pinned row it is the one mark of the pin and the way to take it off.
 *
 * It stands in a column of its own as tall as the row, with no ground of its own: the
 * row's is under it, and a ground would cover the row's keyboard ring. Unpinned, it comes up
 * under the pointer and the keyboard on its row (`reveal.css`, the row is `NavWorkRow`); where
 * nothing can hover it stands, and a pinned row's pin, the one mark of the pin, stands always.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenNotice } from '@/features/session-open/openNotice.ts'

import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
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
  'reveal': !props.pinned,
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
    v-tooltip:right.name="words"
    class="nav-row-pin"
    type="button"
    :class="marks"
    :aria-label="words"
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
/* Above the row's link, whose box is stretched over the whole row. It is as tall as the row's
   first line and stands at its top (`--nav-row-line`, `NavWorkRow`), so its glyph is level
   with the title on a row of two lines as on a row of one. */
.nav-row-pin {
  position: relative;
  z-index: 1;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  align-self: start;
  inline-size: var(--size-control-inline);
  block-size: var(--nav-row-line, var(--size-control-inline));
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: var(--color-navigation-text-muted);
  background: none;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text-on-dark);
  }

  &:focus-visible {
    outline-offset: -2px;
  }

  &.pinned {
    color: var(--color-text-on-dark-muted);

    .nav-row-pin-glyph {
      fill: currentcolor;
    }
  }
}

.nav-row-pin-touch {
  inline-size: var(--size-control-target);
}
</style>

<style scoped src="@/shared/ui/reveal.css"></style>
