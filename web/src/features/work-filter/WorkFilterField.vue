<script setup lang="ts">
/**
 * The one filter over the Work views: free text and facet chips in one field,
 * the two presets beside it, and the «Фильтр» menu of facet values.
 *
 * Three ways in, one model out. A chip clicked on a tile, a value picked from
 * the menu and a preset pressed all produce the same `WorkFilterToken`, so a
 * filter reads the same whichever way it was built, and the chips that show
 * it are how it is taken apart again.
 *
 * The chips are the host's to place (`WorkFilterChips`); the field asks for
 * them with its `chips` event.
 *
 * The keyboard: `/` anywhere outside a text field comes here; ↓ opens the menu
 * and moves through it; Enter picks the highlighted value; Escape closes the
 * menu, then clears the text, then leaves the field — one step per press; ←
 * from the start of the text reaches the chips, and Backspace there takes the
 * last one out.
 *
 * The menu is drawn in place rather than portalled, under the nearest
 * positioned ancestor: this root where there is room, the bar on a phone.
 */
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import { filterGroups, narrowGroups, picked } from '@/features/work-filter/filterOptions.ts'
import WorkFilterPresets from '@/features/work-filter/WorkFilterPresets.vue'

import { filterTokens, removeToken, toggleToken } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { optionGroupItemId } from '@/shared/ui/choiceControls.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import OptionGroups from '@/shared/ui/OptionGroups.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The states the workflow has, by category: what the state facet offers. */
  categories: readonly WorkItemBrief['state']['category'][]
  /** Open items somebody holds: the «Назначено» preset's count. */
  held: number
  /** The work the bar counts, whose labels and holders the menu offers. */
  items: readonly WorkItemBrief[]
}>()

const emit = defineEmits<{
  /** ← from the start of the text: the chips, wherever the host shows them. */
  chips: []
}>()

const filter = defineModel<WorkFilter>('filter', { required: true })

const { t } = useI18n()

const root = useTemplateRef<HTMLElement>('root')
const text = useTemplateRef<{ control: () => HTMLInputElement | null }>('text')
const input = computed(() => text.value?.control() ?? null)

const menuId = useId()

const tokens = computed(() => filterTokens(filter.value))
const pickedCount = computed(() => tokens.value.length)
const triggerName = computed(() =>
  pickedCount.value
    ? t('workItem.filter.menuNamed', { count: pickedCount.value })
    : t('workItem.filter.menu'),
)

// ---------------------------------------------------------------------------
// The text and the chips.
// ---------------------------------------------------------------------------

function setText(text: string) {
  filter.value = { ...filter.value, text }
}

function clearText() {
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

const groups = computed(() =>
  narrowGroups(
    filterGroups({
      categories: props.categories,
      filter: filter.value,
      held: props.held,
      items: props.items,
      t,
    }),
    filter.value.text,
  ),
)
/** The options in reading order, which is the order the arrows walk. */
const options = computed(() => groups.value.flatMap((group) => group.options))
/**
 * The groups as the list draws them: each value's word and whether it is in.
 * A closed menu draws none of them. A space's labels made it a list of some
 * two thousand nodes that the board built, out of sight, before its first tile
 * could show; it is built when it opens instead.
 */
const menuGroups = computed(() =>
  (open.value ? groups.value : []).map((group) => ({
    ...group,
    options: group.options.map((option) => ({
      key: option.key,
      text: option.text,
      detail: option.detail,
      selected: picked(filter.value, option),
    })),
  })),
)
const typed = computed(() => filter.value.text.trim())
const activeOption = computed(() =>
  open.value && highlight.value >= 0 ? optionGroupItemId(menuId, highlight.value) : undefined,
)
const completion = computed(() => ({
  controls: menuId,
  activeDescendant: activeOption.value,
  expanded: open.value,
}))

// A narrower list keeps the highlight on a row that still exists. A closed
// menu has no highlight, so its rows are not worked out to keep one.
watch(
  () => (open.value ? options.value.length : 0),
  (length) => {
    if (highlight.value >= length) highlight.value = length - 1
  },
)

function openMenu(first: boolean) {
  open.value = true
  highlight.value = first && options.value.length ? 0 : -1
}

function closeMenu() {
  open.value = false
  highlight.value = -1
}

function toggleMenu() {
  if (open.value) closeMenu()
  else openMenu(false)
  focusText()
}

function move(step: 1 | -1) {
  const count = options.value.length
  if (!count) return
  highlight.value =
    highlight.value < 0 && step < 0 ? count - 1 : (highlight.value + step + count) % count
  const id = optionGroupItemId(menuId, highlight.value)
  void nextTick(() =>
    root.value?.querySelector(`[id="${id}"]`)?.scrollIntoView({ block: 'nearest' }),
  )
}

/**
 * Pick a value: in it goes, or out if it was in. Text typed to find the value
 * was a search of the menu, not of the work, so it goes with the pick.
 */
function choose(key: string) {
  const option = options.value.find((entry) => entry.key === key)
  if (!option) return
  const next = toggleToken(filter.value, option.token)
  filter.value = filter.value.text ? { ...next, text: '' } : next
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
  const option = options.value[highlight.value]
  if (event.key !== 'Enter' || !option) return false
  choose(option.key)
  return true
}

/**
 * Escape does one thing per press: it closes the menu, then clears the text,
 * then leaves the field.
 */
function escape(field: HTMLInputElement) {
  if (open.value) closeMenu()
  else if (field.value) setText('')
  else field.blur()
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
  else if (menuKey(event) || chipKey(event, field)) event.preventDefault()
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
        @update:model-value="setText"
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
    />

    <button
      class="filter-trigger"
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="menuId"
      :aria-label="triggerName"
      :title="triggerName"
      @click="toggleMenu"
    >
      <VIcon
        name="filters"
        :size="16"
      />
      <span class="filter-trigger-text">{{ t('workItem.filter.menu') }}</span>
      <CountBadge
        v-if="pickedCount"
        placement="inline"
        :value="pickedCount"
      />
    </button>

    <OptionGroups
      v-show="open"
      :id="menuId"
      v-model:highlight="highlight"
      class="filter-menu"
      :empty="t('workItem.filter.noOptions', { text: typed })"
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

/* The trigger is a compact control, the height of the view switch beside
   it, and holds the chosen segment's fill while its menu is open. */
.filter-trigger {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--size-control-height-compact);
  padding: 0 var(--space-3);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-control);
  white-space: nowrap;
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  &[aria-expanded='true'] {
    color: var(--color-text);
    background: var(--color-surface-active);
  }
}

/* A phone: the trigger is its icon and its count, and the root steps aside so
   the menu spans the bar under the row. */
@container workspace (width <= 556px) {
  .work-filter {
    position: static;
  }

  .filter-trigger-text {
    display: none;
  }

  .filter-trigger {
    padding: 0 var(--space-2);
  }

  .filter-menu {
    right: 0;
    left: 0;
    width: auto;
  }
}
</style>
