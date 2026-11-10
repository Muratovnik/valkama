<script setup lang="ts">
/**
 * «Open session» at the end of an item's row in the side panel's list: it opens the session
 * the row's state comes from, as the session button of a card does (`useOpenPress`), and a
 * plan that takes more than one press goes on in `OpenPanel`.
 *
 * It stands beside the pin and the way the pin does (`NavWorkPin`): in a column of its own
 * that the row keeps whether it is in sight or not, so the title neither moves nor narrows
 * when it comes up; out of sight at rest and up under the pointer and the keyboard in its row
 * (`reveal.css`), and standing where nothing can hover. Its glyph is the session's, the one a
 * session's own row carries in its number's column. Its name says whose session it opens.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import OpenPanel from '@/features/session-open/OpenPanel.vue'
import { useOpenPress } from '@/features/session-open/openPress.ts'

import type { Executor } from '@/shared/api/executorModel.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The session the row's state comes from. */
  executor: Executor & { session: string }
  reference: string
  size: 'rail' | 'touch'
  title: string
}>()

const { t } = useI18n()

const sized = computed(() => ({ 'nav-row-open-touch': props.size === 'touch' }))
const item = computed(() => `${props.reference} ${props.title}`)
const name = computed(() =>
  t('liveWork.openSession', { reference: props.reference, title: props.title }),
)
const { busy, finished, panel, press } = useOpenPress(
  () => ({
    kind: 'session',
    session: props.executor.session,
    family: props.executor.family || undefined,
  }),
  () => item.value,
)
/** Absent rather than false, because `aria-busy="false"` is a claim and not a default. */
const busyMark = computed(() => busy.value || undefined)
</script>

<template>
  <button
    v-tooltip:right.name="t('session.open')"
    class="nav-row-open reveal"
    type="button"
    :class="sized"
    :aria-label="name"
    :aria-busy="busyMark"
    @click="press"
  >
    <VIcon
      name="terminal"
      :size="14"
    />
  </button>
  <OpenPanel
    v-if="panel"
    :actions="panel.actions"
    :context="item"
    :notice="panel.notice"
    :offer="panel.offer"
    :opens="panel.opens"
    @close="panel = null"
    @finished="finished"
  />
</template>

<style scoped>
/* Above the row's link, whose box is stretched over the whole row, as the pin is. It is as
   tall as the row's first line and stands at its top, so its glyph is level with the title. */
.nav-row-open {
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
}

.nav-row-open-touch {
  inline-size: var(--size-control-target);
}
</style>

<style scoped src="@/shared/ui/reveal.css"></style>
