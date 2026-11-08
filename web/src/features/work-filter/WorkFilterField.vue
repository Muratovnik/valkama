<script setup lang="ts">
/**
 * The one filter over the Work views: free text and facet chips in one field,
 * the two presets beside it, and the menu of facet values it opens.
 *
 * Three ways in, one model out. A chip clicked on a tile, a value picked from
 * the menu and a preset pressed all produce the same `WorkFilterToken`, so a
 * filter reads the same whichever way it was built, and the chips that show
 * it are how it is taken apart again.
 *
 * The chips are the host's to place (`WorkFilterChips`); the field asks for
 * them with its `chips` event.
 *
 * The menu opens to what a person did: a press in the field, `/`, ↓ or a letter
 * typed, and never because focus arrived. Tab passes through on its way to what
 * lies behind the menu, and focus also comes back here on its own, when a card
 * closes or the window returns; so nothing here listens for focus at all. It
 * opens on the facets, the presets over them, and a facet's row steps into its
 * values (`stepGroups`). Typing there still finds a value of any facet; inside a
 * facet it narrows that facet's values. Text ends the menu with a row that hands
 * it to the search over every project, the one thing this filter cannot do. It
 * stands as tall as the window lets it (`useMenuRoom`).
 *
 * The keyboard: `/` anywhere outside a text field comes here and opens the menu;
 * ↓ opens it and moves through it; Enter takes the highlighted row; Escape
 * closes the menu, then clears the text, then leaves the field — one step per
 * press; ← or Backspace from the start of the text steps from a facet's values
 * back to the facets, and from there ← reaches the chips and Backspace takes
 * the last one out.
 *
 * The menu is drawn in place rather than portalled, under the nearest
 * positioned ancestor: this root where there is room, the bar on a phone.
 */
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import { filterGroups, picked, stepGroups } from '@/features/work-filter/filterOptions.ts'
import type { FilterStep } from '@/features/work-filter/filterOptions.ts'
import { useMenuRoom } from '@/features/work-filter/useMenuRoom.ts'
import WorkFilterPresets from '@/features/work-filter/WorkFilterPresets.vue'

import {
  filterTokens,
  removeToken,
  setLabelsMatch,
  toggleToken,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { optionGroupItemId } from '@/shared/ui/choiceControls.ts'
import OptionGroups from '@/shared/ui/OptionGroups.vue'
import { isStrayPress } from '@/shared/ui/strayPress.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The states the workflow has, by category: what the state facet offers. */
  categories: readonly WorkItemBrief['state']['category'][]
  /** Open items somebody holds: the «Назначено» preset's count; none while it is unknown. */
  held: number | null
  /** The work the bar counts, whose labels and holders the menu offers. */
  items: readonly WorkItemBrief[]
}>()

const emit = defineEmits<{
  /** ← from the start of the text: the chips, wherever the host shows them. */
  chips: []
  /** The menu's last row: search every project for the text, which this filter cannot. */
  find: [text: string]
}>()

const filter = defineModel<WorkFilter>('filter', { required: true })

const { t } = useI18n()

const root = useTemplateRef<HTMLElement>('root')
const text = useTemplateRef<{ control: () => HTMLInputElement | null }>('text')
const input = computed(() => text.value?.control() ?? null)

const menuId = useId()

const tokens = computed(() => filterTokens(filter.value))

// ---------------------------------------------------------------------------
// The text and the chips.
// ---------------------------------------------------------------------------

function setText(text: string) {
  filter.value = { ...filter.value, text }
}

/** A letter typed is a search of the menu too, so it opens the menu if it was closed. */
function type(text: string) {
  setText(text)
  if (text.trim() && !open.value) openMenu(false)
}

/** With the text gone the whole list is on offer, so it stays open only if it was in sight. */
function clearText() {
  if (!shown.value) closeMenu()
  setText('')
  input.value?.focus()
}

function remove(token: WorkFilterToken) {
  filter.value = removeToken(filter.value, token)
}

function focusText() {
  const field = input.value
  if (!field) return
  field.focus()
  field.setSelectionRange(field.value.length, field.value.length)
}

// ---------------------------------------------------------------------------
// The menu.
// ---------------------------------------------------------------------------

const open = ref(false)
/** The highlighted option by its place in `options`; -1 for none. */
const highlight = ref(-1)
/** The facets, or the values of the one picked; a menu opens on the facets. */
const step = ref<FilterStep>('facets')

const groups = computed(() =>
  stepGroups(
    filterGroups({
      categories: props.categories,
      filter: filter.value,
      held: props.held,
      items: props.items,
      t,
    }),
    step.value,
    filter.value.text,
    t,
  ),
)
/** What the menu offers in reading order, which is the order the arrows walk. */
const entries = computed(() =>
  groups.value.flatMap((group) => [
    ...(group.back ? [group.back] : []),
    ...(group.choices ?? []),
    ...group.options,
  ]),
)
/** With nothing to offer, the menu is no empty frame over the work. */
const shown = computed(() => open.value && entries.value.length > 0)
/**
 * The groups as the list draws them: each value's word and whether it is in.
 * A closed menu draws none of them. A space's labels made it a list of some
 * two thousand nodes that the board built, out of sight, before its first tile
 * could show; it is built when it opens instead, and then only for the step
 * on show.
 */
const menuGroups = computed(() =>
  (open.value ? groups.value : []).map((group) => ({
    id: group.id,
    name: group.name,
    bare: group.bare,
    back: group.back && {
      key: group.back.key,
      name: t('workItem.filter.back', { facet: group.name }),
    },
    options: group.options.map((option) => ({
      key: option.key,
      text: option.text,
      detail: option.detail,
      kind: option.kind,
      icon: option.action.do === 'find' ? 'search' : undefined,
      next: option.action.do === 'open',
      selected: picked(filter.value, option),
    })),
    choices: group.choices?.map((choice) => ({
      key: choice.key,
      name: choice.name,
      text: choice.text,
      title: choice.title,
      selected: (filter.value.labelsMatch ?? 'all') === choice.match,
    })),
  })),
)
const menuRoom = useMenuRoom(
  () => root.value?.querySelector<HTMLElement>(`[id="${menuId}"]`),
  () => shown.value,
  () => tokens.value.length,
)
const activeOption = computed(() =>
  shown.value && highlight.value >= 0 ? optionGroupItemId(menuId, highlight.value) : undefined,
)
const completion = computed(() => ({
  controls: menuId,
  activeDescendant: activeOption.value,
  expanded: shown.value,
}))

// A narrower list keeps the highlight on a row that still exists. A closed
// menu has no highlight, so its rows are not worked out to keep one.
watch(
  () => (open.value ? entries.value.length : 0),
  (length) => {
    if (highlight.value >= length) highlight.value = length - 1
  },
)

function openMenu(first: boolean) {
  open.value = true
  highlight.value = first && entries.value.length ? 0 : -1
}

function closeMenu() {
  open.value = false
  highlight.value = -1
  step.value = 'facets'
}

/** The place of the row with this key, once the list is drawn, highlighted and in sight. */
function highlightKey(key: string) {
  void nextTick(() => {
    highlight.value = entries.value.findIndex((candidate) => candidate.key === key)
    reveal()
  })
}

/**
 * Into a facet's values, or back out to the facets. The list starts from its top,
 * the highlight on the first value going in and on the facet left coming out, so
 * the arrows go on from where the reader was.
 */
function goTo(next: FilterStep) {
  const from = step.value
  step.value = next
  void nextTick(() => {
    const list = root.value?.querySelector<HTMLElement>(`[id="${menuId}"]`)
    if (list) list.scrollTop = 0
    highlight.value =
      next === 'facets'
        ? entries.value.findIndex((entry) => entry.key === `open:${from}`)
        : entries.value.findIndex((entry) => 'action' in entry && entry.action.do === 'pick')
    reveal()
  })
}

/** A press in the field opens the menu and leaves an open one as it is. */
function press(event: MouseEvent) {
  if (!open.value && !isStrayPress(event)) openMenu(false)
}

/** Brings the highlighted row into the list's sight, once it is drawn. */
function reveal() {
  const id = optionGroupItemId(menuId, highlight.value)
  void nextTick(() =>
    root.value?.querySelector(`[id="${id}"]`)?.scrollIntoView({ block: 'nearest' }),
  )
}

function move(step: 1 | -1) {
  const count = entries.value.length
  if (!count) return
  highlight.value =
    highlight.value < 0 && step < 0 ? count - 1 : (highlight.value + step + count) % count
  reveal()
}

/**
 * Take a row. A value goes in, or out if it was in. Text typed to find the value
 * was a search of the menu, not of the work, so it goes with the pick, and the
 * highlight stays on that value as the list grows back around it: in its own
 * facet's step, where a value found from the facets lands, so the pick is in
 * sight beside the facet's other values. How the labels combine is no value:
 * the text stays. A facet's row steps in, the back row steps out, and the last
 * row hands the text to the search over every project.
 */
function choose(key: string) {
  const entry = entries.value.find((candidate) => candidate.key === key)
  if (!entry) return
  if ('match' in entry) {
    filter.value = setLabelsMatch(filter.value, entry.match)
    return
  }
  const { action } = entry
  switch (action.do) {
    case 'open': {
      goTo(action.facet)
      return
    }
    case 'back': {
      goTo('facets')
      return
    }
    case 'find': {
      const text = filter.value.text.trim()
      closeMenu()
      emit('find', text)
      return
    }
    default: {
      pick(action.token, key)
    }
  }
}

function pick(token: WorkFilterToken, key: string) {
  const next = toggleToken(filter.value, token)
  if (!filter.value.text) {
    filter.value = next
    return
  }
  filter.value = { ...next, text: '' }
  if (token.facet !== 'ready' && token.facet !== 'held') step.value = token.facet
  highlightKey(key)
}

// ---------------------------------------------------------------------------
// The keyboard.
// ---------------------------------------------------------------------------

const caretAtStart = (field: HTMLInputElement) =>
  field.selectionStart === 0 && field.selectionEnd === 0

/** The keys that walk the menu; true when the key was the menu's. */
function menuKey(event: KeyboardEvent): boolean {
  if (event.key === 'ArrowDown') {
    if (open.value) move(1)
    else openMenu(true)
    return true
  }
  if (!open.value) return false
  if (event.key === 'ArrowUp') {
    move(-1)
    return true
  }
  const entry = entries.value[highlight.value]
  if (event.key !== 'Enter' || !entry) return false
  choose(entry.key)
  return true
}

/**
 * Escape does one thing per press: it closes the menu, then clears the text,
 * then leaves the field.
 */
function escape(field: HTMLInputElement) {
  const inSight = shown.value
  closeMenu()
  if (inSight) return
  if (field.value) setText('')
  else field.blur()
}

/** ← or Backspace from the start of the text, in a facet's values: back to the facets. */
function stepKey(event: KeyboardEvent, field: HTMLInputElement): boolean {
  if (!shown.value || step.value === 'facets' || !caretAtStart(field)) return false
  if (event.key !== 'ArrowLeft' && event.key !== 'Backspace') return false
  goTo('facets')
  return true
}

/** The keys that reach the chips from the start of the text. */
function chipKey(event: KeyboardEvent, field: HTMLInputElement): boolean {
  if (!caretAtStart(field) || !tokens.value.length) return false
  if (event.key === 'ArrowLeft') {
    closeMenu()
    emit('chips')
    return true
  }
  const last = tokens.value.at(-1)
  if (event.key !== 'Backspace' || !last) return false
  remove(last)
  return true
}

function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  const field = event.target as HTMLInputElement
  if (event.key === 'Escape') {
    // The press stops here: a drawer behind the bar must not close on the
    // Escape that only closed this menu.
    event.preventDefault()
    event.stopPropagation()
    escape(field)
  } else if (event.key === 'Tab') closeMenu()
  else if (menuKey(event) || stepKey(event, field) || chipKey(event, field)) event.preventDefault()
}

/** `/` focuses the field from anywhere a key is not already text. */
function editable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || Boolean(target.closest('input, textarea, select')))
  )
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
    return
  if (event.defaultPrevented || editable(event.target)) return
  // A dialog over the work owns the keyboard; the bar behind it does not.
  if (document.querySelector('[aria-modal="true"]')) return
  const field = input.value
  if (!field || field.offsetParent === null) return
  event.preventDefault()
  field.focus()
  field.select()
  openMenu(false)
})

// The menu closes when focus or a pointer leaves the filter.
function focusout(event: FocusEvent) {
  const next = event.relatedTarget
  if (!(next instanceof Node) || !root.value?.contains(next)) closeMenu()
}
useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (open.value && !(event.target instanceof Node && root.value?.contains(event.target)))
    closeMenu()
})

defineExpose({ focus: focusText })
</script>

<template>
  <div
    ref="root"
    class="work-filter"
    @focusout="focusout"
  >
    <div class="filter-box">
      <VTextInput
        ref="text"
        class="filter-text"
        size="compact"
        autocomplete="off"
        :spellcheck="false"
        :label="t('workItem.filter.label')"
        :placeholder="t('workItem.filter.placeholder')"
        :short-placeholder="t('workItem.filter.placeholderShort')"
        :model-value="filter.text"
        :completion="completion"
        hide-label
        @click="press"
        @update:model-value="type"
        @keydown="keydown"
      />
      <VButton
        v-if="filter.text"
        size="inline"
        variant="ghost"
        :aria-label="t('workItem.filter.clearText')"
        :title="t('workItem.filter.clearText')"
        icon
        @click="clearText"
        ><VIcon
          name="close"
          :size="16"
      /></VButton>
    </div>

    <WorkFilterPresets
      v-model:filter="filter"
      :held="held"
      @focusin="closeMenu"
    />

    <OptionGroups
      v-show="shown"
      :id="menuId"
      v-model:highlight="highlight"
      class="filter-menu"
      :style="{ '--size-option-groups-max-height': menuRoom }"
      :groups="menuGroups"
      :label="t('workItem.filter.menuLabel')"
      @choose="choose"
    />
  </div>
</template>

<style scoped>
/* It takes the width its row leaves and starts from none, so the row never
   wraps to make room for the field's own preferred width. */
.work-filter {
  position: relative;
  display: flex;
  flex: 1 1 0;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

/* The text field and its clear button, as wide as the row leaves them. */
.filter-box {
  display: flex;
  flex: 1 1 160px;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
}

.filter-text {
  flex: 1 1 0;
  min-width: 0;
}

/* The menu stands under the filter, above the work, as the choice lists do. */
.filter-menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: 120;
  width: min(24rem, 100%);
}

/* A phone: the root steps aside so the menu spans the bar under the row. */
@container workspace (width <= 624px) {
  .work-filter {
    position: static;
  }

  .filter-menu {
    right: 0;
    left: 0;
    width: auto;
  }
}
</style>
