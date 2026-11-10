<script setup lang="ts">
/**
 * Work going on now, under «Work» on the rail: the list on a rail with room for words,
 * and on a phone's rail a button that opens the same list in a panel over the page.
 *
 * The list scrolls by itself, so the rail's head, its actions, «Work» and the foot stay
 * where they are however long it grows. Escape inside it folds it and gives focus back
 * to the fold on «Work», which the entry above draws (`NavModuleList`).
 *
 * The button counts the rows of work to follow now, items and sessions on no item, as the
 * list stands them in sight (`liveCount`). A press opens the panel; a
 * row pressed there closes it and opens the card, and the cross, the scrim and Escape
 * close it and give focus back to the button. The panel's rows are a finger's height
 * and the same rows: the frame is the store's, and so is what folds are open. Its heading
 * starts where the spaces' names do.
 *
 * The group, not a row, holds the panel a press on a session goes on in, for both lists
 * (`useRowOpen`): a refresh that drops the row, fades it or moves it into a fold leaves the
 * panel and the focus in it where they are. Closed, the panel gives focus back to the control
 * that opened it while that control is still on the page; once a refresh has taken it away,
 * focus comes back to the list's head instead of falling to the page (`landFocus`).
 */
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import NavWorkTree, { NAME_INDENT_TOUCH } from '@/widgets/app-nav/components/NavWorkTree.vue'
import type { NavShown, NavTarget } from '@/widgets/app-nav/components/NavWorkTree.vue'
import type { NavOpen } from '@/widgets/app-nav/composables/useNavOpen.ts'
import { provideRowOpen } from '@/widgets/app-nav/composables/useRowOpen.ts'

import OpenPanel from '@/features/session-open/OpenPanel.vue'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import SidePanel from '@/shared/ui/SidePanel.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
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
const { context: openContext, finished: openFinished, panel: openPanel } = provideRowOpen()

const railButton = useTemplateRef<HTMLElement>('rail-button')
const sheetTree = useTemplateRef<{ $el: HTMLElement }>('sheet-tree')

/**
 * Where focus goes once the open-session panel has closed and could not give it back: the
 * overlay returns it only to a control still on the page, and a refresh that dropped the row,
 * faded it or moved it into a fold took that control away, so focus fell to the page's body,
 * out of the list and its keys. It comes to the list's head: in the phone's panel the panel's
 * first control, else the fold on «Work», or the rail's button where the rail has no room for
 * the list.
 */
async function landFocus() {
  await nextTick()
  const focused = document.activeElement
  if (focused !== null && focused !== document.body) return
  const head = panelOpen.value
    ? sheetTree.value?.$el.querySelector<HTMLElement>('a[href], button')
    : [document.querySelector<HTMLElement>(`#${CSS.escape(props.foldId)}`), railButton.value].find(
        (control) => control?.checkVisibility(),
      )
  head?.focus()
}

watch(openPanel, (now, before) => {
  if (now === null && before !== null) void landFocus()
})

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
        :elsewhere="store.elsewhere"
        :open="open"
        :shown="shown"
        :target="target"
        @go="go"
      />
    </div>
    <button
      ref="rail-button"
      v-tooltip:right.name="countWords"
      class="nav-work-rail"
      type="button"
      :aria-label="countWords"
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
      :title-indent="NAME_INDENT_TOUCH"
      @close="panelOpen = false"
    >
      <NavWorkTree
        ref="sheet-tree"
        size="touch"
        :prefix="`${prefix}-panel`"
        :spaces="store.spaces"
        :elsewhere="store.elsewhere"
        :open="open"
        :shown="shown"
        :target="target"
        @go="go"
      />
    </SidePanel>
    <OpenPanel
      v-if="openPanel"
      :actions="openPanel.actions"
      :context="openContext"
      :notice="openPanel.notice"
      :offer="openPanel.offer"
      :opens="openPanel.opens"
      @close="openPanel = null"
      @finished="openFinished"
    />
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
