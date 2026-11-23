<script setup lang="ts" generic="Row extends OptionRow">
/**
 * A filter's field: the text, and the menu of conditions and facet values it
 * opens, over what its host says the filter is over (`FacetSource`,
 * `facetMenu`). The Work views and the Analytics page filter through it.
 *
 * The host owns the filter and its words: this says what a reader took — a
 * value, a way a facet's values combine, the text handed on — and the host
 * puts it in, or takes it out again.
 *
 * The chips are the host's to place (`FacetFilterChips`); the field asks for
 * them with its `chips` event, and takes the last one out with `removeLast`.
 *
 * The menu opens to what a person did: a press in the field, `/`, ↓ or a letter
 * typed, and never because focus arrived. Tab passes through on its way to what
 * lies behind the menu, and focus also comes back here on its own, when a card
 * closes or the window returns; so nothing here listens for focus at all. It
 * opens on the facets, the conditions over them, and a facet's row steps into its
 * values (`facetMenu`). Typing there still finds a value of any facet; inside a
 * facet it narrows that facet's values. Text ends the menu with a row that hands
 * it to the host, where the host can do what this filter cannot (`find`). It
 * stands as tall as the window lets it (`useMenuRoom`).
 *
 * The facets whose values the menu shows are said as they change (`need`): the
 * one stepped into, every facet while text searches them all, none while the
 * menu is closed. A host that reads a facet's values only when shown reads them
 * from that.
 *
 * The keyboard: `/` anywhere outside a text field comes here and opens the menu;
 * ↓ opens it and moves through it; Enter takes the highlighted row; Escape
 * closes the menu, then clears the text, then leaves the field — one step per
 * press; ← or Backspace from the start of the text steps from a facet's values
 * back to the facets, and from there ← reaches the chips and Backspace takes
 * the last one out.
 *
 * The menu is drawn in place rather than portalled, under the nearest
 * positioned ancestor: this root where there is room, the bar on a phone. It is
 * as wide as the field up to 24rem, unless the host sets
 * `--size-facet-filter-menu-width` on this root, and never past the window's
 * end. While it shows it is the page's open popup (`data-popup-surface`): the
 * hints of what lies under it keep quiet, and its own rows' hints speak.
 */
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'

import { useEventListener } from '@vueuse/core'

import { placeFocus } from '@/shared/lib/scriptedFocus.ts'
import { optionGroupItemId } from '@/shared/ui/choiceControls.ts'
import type { OptionRow } from '@/shared/ui/choiceControls.ts'
import { facetMenu } from '@/shared/ui/facetMenu.ts'
import type { FacetMenuWords, FacetSource } from '@/shared/ui/facetMenu.ts'
import OptionGroups from '@/shared/ui/OptionGroups.vue'
import { isStrayPress } from '@/shared/ui/strayPress.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { useMenuRoom } from '@/shared/ui/useMenuRoom.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** How many chips show the filter, wherever the host places them. */
  chips: number
  /** The name of the button that clears the text. */
  clearLabel: string
  /** The field's name, for assistive technology: the bar it stands in names nothing. */
  label: string
  menuLabel: string
  placeholder: string
  /** What the filter is over: its conditions, its facets and their values. */
  source: FacetSource<Row>
  /** What the menu says of its own rows. */
  words: FacetMenuWords
  /** What the field says where it is too narrow for its whole placeholder. */
  shortPlaceholder?: string
}>()

const emit = defineEmits<{
  /** ← from the start of the text: the chips, wherever the host shows them. */
  'chips': []
  /** A way the facet's values combine was chosen; the text stays. */
  'choose': [key: string, facet: string]
  /** The menu's last row: the text, for what the host does with it (`FacetMenuWords.find`). */
  'find': [text: string]
  /** The facets whose values the menu shows now; none while it is closed. */
  'need': [facets: readonly string[]]
  /**
   * A value taken, into the filter or out of it. Text typed to find it was a search of the
   * menu and goes with the pick: `text` is what the field holds after it, so the host writes
   * the pick and the text as one change.
   */
  'pick': [key: string, facet: string | null, text: string]
  /** Backspace from the start of the text: the last chip goes. */
  'remove-last': []
}>()

defineSlots<{
  /** A value row's words, drawn the host's way; its text by default. */
  value?: (scope: { option: Row }) => unknown
}>()

const query = defineModel<string>('text', { required: true })

const root = useTemplateRef<HTMLElement>('root')
const text = useTemplateRef<{ control: () => HTMLInputElement | null }>('text')
const input = computed(() => text.value?.control() ?? null)

const menuId = useId()

// ---------------------------------------------------------------------------
// The text and the chips.
// ---------------------------------------------------------------------------

function setText(text: string) {
  query.value = text
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
  placeFocus(input.value)
}

function focusText() {
  const field = input.value
  if (!field) return
  placeFocus(field)
  field.setSelectionRange(field.value.length, field.value.length)
}

// ---------------------------------------------------------------------------
// The menu.
// ---------------------------------------------------------------------------

const open = ref(false)
/** The highlighted option by its place in `options`; -1 for none. */
const highlight = ref(-1)
/** The facets (null), or the values of the one picked; a menu opens on the facets. */
const step = ref<string | null>(null)

/** A closed menu reads nothing of its source: a space's labels built thousands of rows unseen. */
const groups = computed(() =>
  open.value
    ? facetMenu({ source: props.source, step: step.value, text: query.value, words: props.words })
    : { entries: [], groups: [] },
)
/** What the menu offers in reading order, which is the order the arrows walk. */
const entries = computed(() => groups.value.entries)
const entryOf = computed(() => new Map(entries.value.map((entry) => [entry.key, entry])))
/** With nothing to offer or say, the menu is no empty frame over the page. */
const shown = computed(() => open.value && groups.value.groups.length > 0)
/** Whether a row is a value of the host's, which its slot draws, rather than the menu's own. */
const isValue = (key: string) => entryOf.value.get(key)?.do === 'pick'
const menuRoom = useMenuRoom(
  () => root.value?.querySelector<HTMLElement>(`[id="${menuId}"]`),
  () => shown.value,
  () => props.chips,
)
/**
 * The menu marks itself the page's open popup only while it shows: drawn and hidden, the mark
 * would keep every hint on the page quiet, so a closed menu has no mark at all, not a false one.
 */
const popupMark = computed(() => (shown.value ? '' : undefined))
/** The room the window leaves the menu, down to its foot and across to its end. */
const menuStyle = computed(() => ({
  '--size-option-groups-max-height': menuRoom.room.value,
  'maxWidth': menuRoom.across.value,
}))
const activeOption = computed(() =>
  shown.value && highlight.value >= 0 ? optionGroupItemId(menuId, highlight.value) : undefined,
)
const completion = computed(() => ({
  controls: menuId,
  activeDescendant: activeOption.value,
  expanded: shown.value,
}))

/** The facets whose values are on show: the step's, or all of them while text searches them. */
const needed = computed<readonly string[]>(() => {
  if (!open.value) return []
  if (step.value !== null) return [step.value]
  return query.value.trim() ? props.source.facets().map((facet) => facet.id) : []
})
watch(
  () => needed.value.join('\n'),
  () => emit('need', needed.value),
)

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
  step.value = null
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
function goTo(next: string | null) {
  const from = step.value
  step.value = next
  void nextTick(() => {
    const list = root.value?.querySelector<HTMLElement>(`[id="${menuId}"]`)
    if (list) list.scrollTop = 0
    highlight.value =
      next === null
        ? entries.value.findIndex((entry) => entry.key === `open:${from}`)
        : entries.value.findIndex((entry) => entry.do === 'pick')
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
 * was a search of the menu, not of what it filters, so it goes with the pick, and the
 * highlight stays on that value as the list grows back around it: in its own
 * facet's step, where a value found from the facets lands, so the pick is in
 * sight beside the facet's other values. How the labels combine is no value:
 * the text stays. A facet's row steps in, the back row steps out, and the last
 * row hands the text to the host.
 */
function choose(key: string) {
  const entry = entryOf.value.get(key)
  if (!entry) return
  switch (entry.do) {
    case 'choose': {
      emit('choose', key, entry.facet)
      return
    }
    case 'open': {
      goTo(entry.facet)
      return
    }
    case 'back': {
      goTo(null)
      return
    }
    case 'find': {
      const text = query.value.trim()
      closeMenu()
      emit('find', text)
      return
    }
    default: {
      pick(key, entry.facet)
    }
  }
}

function pick(key: string, facet: string | null) {
  if (!query.value) {
    emit('pick', key, facet, query.value)
    return
  }
  emit('pick', key, facet, '')
  if (facet !== null) step.value = facet
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
  if (!shown.value || step.value === null || !caretAtStart(field)) return false
  if (event.key !== 'ArrowLeft' && event.key !== 'Backspace') return false
  goTo(null)
  return true
}

/** The keys that reach the chips from the start of the text. */
function chipKey(event: KeyboardEvent, field: HTMLInputElement): boolean {
  if (!caretAtStart(field) || !props.chips) return false
  if (event.key === 'ArrowLeft') {
    closeMenu()
    emit('chips')
    return true
  }
  if (event.key !== 'Backspace') return false
  emit('remove-last')
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
  // A dialog over the page owns the keyboard; the bar behind it does not.
  if (document.querySelector('[aria-modal="true"]')) return
  const field = input.value
  if (!field || field.offsetParent === null) return
  event.preventDefault()
  placeFocus(field)
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

defineExpose({ takeFocus: focusText })
</script>

<template>
  <div
    ref="root"
    class="facet-filter"
    @focusout="focusout"
  >
    <div class="filter-box">
      <VTextInput
        ref="text"
        class="filter-text"
        size="compact"
        autocomplete="off"
        :spellcheck="false"
        :label="label"
        :placeholder="placeholder"
        :short-placeholder="shortPlaceholder"
        :model-value="query"
        :completion="completion"
        hide-label
        @click="press"
        @update:model-value="type"
        @keydown="keydown"
      />
      <VButton
        v-if="query"
        v-tooltip.name="clearLabel"
        size="inline"
        variant="ghost"
        :aria-label="clearLabel"
        icon
        @click="clearText"
        ><VIcon
          name="close"
          :size="16"
      /></VButton>
    </div>

    <OptionGroups
      v-show="shown"
      :id="menuId"
      v-model:highlight="highlight"
      class="filter-menu"
      :data-popup-surface="popupMark"
      :style="menuStyle"
      :groups="groups.groups"
      :label="menuLabel"
      @choose="choose"
    >
      <template #text="{ option }">
        <slot
          v-if="isValue(option.key)"
          name="value"
          :option="option as Row"
          >{{ option.text }}</slot
        >
        <template v-else>{{ option.text }}</template>
      </template>
    </OptionGroups>
  </div>
</template>

<style scoped>
/* It takes the width its row leaves and starts from none, so the row never
   wraps to make room for the field's own preferred width. */
.facet-filter {
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

/* The menu stands under the filter, above what it filters, as the choice lists do. */
.filter-menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: 120;
  width: var(--size-facet-filter-menu-width);
}

/* A phone: the root steps aside so the menu spans the bar under the row. */
@container workspace (width <= 624px) {
  .facet-filter {
    position: static;
  }

  .filter-menu {
    right: 0;
    left: 0;
    width: auto;
  }
}
</style>
