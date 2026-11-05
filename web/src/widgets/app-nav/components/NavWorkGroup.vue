<script setup lang="ts">
/**
 * Work going on now, under «Work» on the rail: the list on a rail with room for words,
 * and on a phone's rail a button that opens the same list in a panel over the page.
 *
 * The list scrolls by itself, so the rail's head, its actions, «Work» and the foot stay
 * where they are however long it grows. Escape inside it folds it and gives focus back
 * to the fold on «Work», which the entry above draws (`NavModuleList`).
 *
 * The button counts the items an agent's session is on now. A press opens the panel; a
 * row pressed there closes it and opens the card, and the cross, the scrim and Escape
 * close it and give focus back to the button. The panel's rows are a finger's height
 * and the same rows: the frame is the store's, and so is what folds are open.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import NavWorkTree from '@/widgets/app-nav/components/NavWorkTree.vue'
import type { NavShown, NavTarget } from '@/widgets/app-nav/components/NavWorkTree.vue'
import type { NavOpen } from '@/widgets/app-nav/composables/useNavOpen.ts'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import SidePanel from '@/shared/ui/SidePanel.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The fold on «Work» that this list answers to. */
  foldId: string
  listId: string
  open: NavOpen
  shown: NavShown | null
  target: NavTarget
}>()

const emit = defineEmits<{ go: [route: PlatformRoute] }>()

const { t } = useI18n()
const store = useLiveWorkStore()
const prefix = `nav-work-${useId()}`
const panelOpen = ref(false)

function go(route: PlatformRoute) {
  panelOpen.value = false
  emit('go', route)
}

/** Escape that no group inside took folds the list and gives focus to the fold on «Work». */
function escape(event: KeyboardEvent) {
  if (!props.open.isOpen('work')) return
  event.preventDefault()
  props.open.set('work', false)
  document.querySelector<HTMLElement>(`#${CSS.escape(props.foldId)}`)?.focus()
}

const listShown = computed(() => props.open.isOpen('work'))
const countWords = computed(() => t('liveWork.open', { count: store.count }))
const elsewhere = computed(() => store.frame?.elsewhere ?? 0)
</script>

<template>
  <div class="nav-work">
    <!-- The keys land here on their way up from the controls inside the list. -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div
      v-if="store.frame !== null"
      v-show="listShown"
      :id="listId"
      class="nav-work-list"
      @keydown.esc="escape"
    >
      <NavWorkTree
        size="rail"
        :prefix="`${prefix}-rail`"
        :spaces="store.spaces"
        :elsewhere="elsewhere"
        :open="open"
        :shown="shown"
        :target="target"
        @go="go"
      />
    </div>
    <button
      class="nav-work-rail"
      type="button"
      :aria-label="countWords"
      :title="countWords"
      :aria-expanded="panelOpen"
      @click="panelOpen = true"
    >
      <VIcon
        class="nav-work-rail-icon"
        name="live-work"
        :size="20"
      />
      <CountBadge
        v-if="store.count > 0"
        class="nav-work-rail-count"
        placement="inline"
        :value="store.count"
      />
    </button>
    <SidePanel
      :open="panelOpen"
      :title="t('liveWork.title')"
      :close-label="t('liveWork.close')"
      @close="panelOpen = false"
    >
      <NavWorkTree
        size="touch"
        :prefix="`${prefix}-panel`"
        :spaces="store.spaces"
        :elsewhere="elsewhere"
        :open="open"
        :shown="shown"
        :target="target"
        @go="go"
      />
    </SidePanel>
  </div>
</template>

<style scoped>
.nav-work {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* The one part of the rail that scrolls: whatever the list holds, the rail around it
   stays put. The scrollbar takes its room from the list's own end. */
.nav-work-list {
  min-height: 0;
  padding-block: var(--space-1);
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* Only a rail with no room for a word has the button, in the place an entry has. */
.nav-work-rail {
  position: relative;
  display: none;
  grid-template-columns: 1fr;
  place-items: center;
  width: 100%;
  min-height: var(--size-control-height);
  padding: 0;
  border: 0;
  color: var(--color-text-on-dark-muted);
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-raised);
  }
}

/* The count rides the icon's top corner, as an entry's does on a narrow rail. */
:is(.nav-work-rail-icon, .nav-work-rail-count) {
  grid-area: 1/1;
}

.nav-work-rail-count {
  place-self: start end;
}

@container nav (width < 150px) {
  .nav-work-list {
    display: none;
  }

  .nav-work-rail {
    display: grid;
  }
}
</style>
