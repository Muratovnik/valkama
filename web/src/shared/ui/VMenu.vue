<script setup lang="ts">
/**
 * A menu of actions behind one button: «…» in a card's head, a view's settings in a bar.
 *
 * It is the WAI-ARIA APG menu button. The trigger names the menu and says that it opens one;
 * Enter, Space and ArrowDown open it on its first entry, a press opens it too. Inside, the
 * arrows walk the entries and wrap, Home and End go to the ends, a typed letter goes to the
 * entry it starts, Enter and Space choose. Escape, a choice, a press outside or Tab close it,
 * and focus goes back to the trigger, except where Tab or a press took it elsewhere; an entry
 * that opens a dialog hands it on from there, and the dialog gives it back on close. Reka's
 * dropdown menu does all of that; this owns how it looks and what it holds (`menuEntries`).
 *
 * A menu is not a choice control. `ChoiceSelect` picks the one value a field has and shows it
 * on its face; a menu does things to what it stands beside, and its face is its sign. A toggle
 * or a choice inside it shows its state with a check, which is why both are entries of a menu
 * and not controls of their own beside it.
 *
 * The trigger is a ghost `VButton`: its sign alone, with the menu's name as its hint and its
 * accessible name, reaching `--size-control-target` under a finger as every icon button does;
 * or its sign and its words where the host says so. A press that was meant for something that
 * stood here before reaches neither the trigger nor an entry (`strayPress`).
 */
import { computed, ref, useTemplateRef, watch } from 'vue'

import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'

import type { MenuEntry } from '@/shared/ui/menuEntries.ts'
import { stopStrayPresses } from '@/shared/ui/strayPress.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    entries: readonly MenuEntry[]
    /** What the menu is for: the trigger's accessible name, and its hint while it shows no words. */
    label: string
    /** Which edge of the trigger the menu lines up with. */
    align?: 'start' | 'end'
    icon?: string
    size?: 'default' | 'compact'
    /** The trigger shows the label as words beside its sign. */
    words?: boolean
  }>(),
  { align: 'end', icon: 'more', size: 'default', words: false },
)

const open = ref(false)

/**
 * Over the card or the dialog it stands in, as every list portalled out of one is: Reka lifts
 * its positioning wrapper to the z-index of the element it is given, which a scoped class does
 * not reach (`SearchCombobox`).
 */
const LAYER = { zIndex: 120 }

/** Without words the trigger is its sign alone, and the label is its hint and its name. */
const hint = computed(() => (props.words ? undefined : props.label))
const glyphSize = computed(() => (props.size === 'compact' ? 16 : 20))

type Entry<Kind extends MenuEntry['kind']> = Extract<MenuEntry, { kind: Kind }>

/** The entry that `opens`, chosen and waiting for the menu to go (`closed`). */
let opening: (() => void) | null = null
/**
 * What choosing an entry does is the entry's own: the menu keeps no copy of a setting's or a
 * choice's state, and reads both off the entries it is handed again.
 */
const act = (entry: Entry<'action'>) => {
  if (entry.opens) opening = entry.select
  else entry.select()
}
const toggle = (entry: Entry<'toggle'>, value: boolean | 'indeterminate') =>
  entry.select(value === true)
const choose = (entry: Entry<'choice'>, value: unknown) => entry.select(String(value))
/** A choice's caption is set apart by a rule from whatever stands before it. */
const ruledOff = (index: number) => index > 0

/** The trigger, and the entries while the menu is open: a stray press reaches neither. */
const trigger = useTemplateRef<HTMLElement>('trigger')
const list = useTemplateRef<HTMLElement>('list')
watch(trigger, stopStrayPresses, { flush: 'post' })
watch(list, stopStrayPresses, { flush: 'post' })

/**
 * An entry that `opens` a dialog runs as the menu goes, not as it is chosen. Reka gives focus
 * back to the trigger on a timer of its own after the menu is gone, which took it from a dialog
 * opened in between, and nothing outside could cancel that. So the menu cancels it here
 * (`close-auto-focus`), puts focus on its trigger at once, and only then runs the entry: what
 * it opens takes focus from the trigger, in the same task, and gives it back there on close.
 */
function closed(event: Event) {
  const run = opening
  opening = null
  if (!run) return
  event.preventDefault()
  trigger.value?.querySelector<HTMLElement>('.menu-trigger')?.focus()
  run()
}
</script>

<template>
  <DropdownMenuRoot
    v-model:open="open"
    :modal="false"
  >
    <span
      ref="trigger"
      class="menu-trigger-box"
    >
      <DropdownMenuTrigger as-child>
        <VButton
          v-tooltip.name="hint"
          class="menu-trigger"
          variant="ghost"
          :size="size"
          :icon="!words"
          :aria-label="hint"
        >
          <VIcon
            :name="icon"
            :size="glyphSize"
          />
          <template v-if="words">{{ label }}</template>
        </VButton>
      </DropdownMenuTrigger>
    </span>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="menu-popup"
        :style="LAYER"
        :align="align"
        :side-offset="4"
        :collision-padding="12"
        loop
        @close-auto-focus="closed"
      >
        <div
          ref="list"
          class="menu-list"
        >
          <template
            v-for="(entry, index) in entries"
            :key="entry.key"
          >
            <DropdownMenuItem
              v-if="entry.kind === 'action'"
              class="menu-item"
              :disabled="entry.disabled"
              :text-value="entry.label"
              @select="act(entry)"
            >
              <VIcon
                v-if="entry.icon"
                class="menu-item-icon"
                :name="entry.icon"
                :size="16"
              />
              <span class="menu-item-label">{{ entry.label }}</span>
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              v-else-if="entry.kind === 'toggle'"
              class="menu-item"
              :model-value="entry.checked"
              :disabled="entry.disabled"
              :text-value="entry.label"
              @update:model-value="(value) => toggle(entry, value)"
            >
              <VIcon
                v-if="entry.icon"
                class="menu-item-icon"
                :name="entry.icon"
                :size="16"
              />
              <span class="menu-item-label">{{ entry.label }}</span>
              <DropdownMenuItemIndicator class="menu-item-check">
                <VIcon
                  name="check"
                  :size="16"
                />
              </DropdownMenuItemIndicator>
            </DropdownMenuCheckboxItem>
            <template v-else>
              <DropdownMenuSeparator
                v-if="ruledOff(index)"
                class="menu-rule"
              />
              <DropdownMenuLabel class="menu-caption">{{ entry.label }}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                :model-value="entry.value"
                @update:model-value="(value) => choose(entry, value)"
              >
                <DropdownMenuRadioItem
                  v-for="option in entry.options"
                  :key="option.value"
                  class="menu-item"
                  :value="option.value"
                  :text-value="option.label"
                >
                  <VIcon
                    v-if="option.icon"
                    class="menu-item-icon"
                    :name="option.icon"
                    :size="16"
                  />
                  <span class="menu-item-label">{{ option.label }}</span>
                  <DropdownMenuItemIndicator class="menu-item-check">
                    <VIcon
                      name="check"
                      :size="16"
                    />
                  </DropdownMenuItemIndicator>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </template>
          </template>
        </div>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<!-- The menu is portalled out of this component, so its surface is not scoped. -->
<style>
/* The menu floats over what it stands beside, as a choice list does: the surface, its one
   edge and its shadow, never wider than the window. Reka draws the menu's element without
   this component's scope, so a scoped rule never reached it and the menu had no surface. */
.menu-popup {
  min-width: 200px;
  max-width: min(360px, calc(100vw - 24px));
  padding: var(--space-1);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  border-radius: var(--radius-control);
  box-shadow: 0 14px 34px var(--color-shadow);
}
</style>

<style scoped>
.menu-trigger-box {
  display: inline-flex;
  flex: none;
}

/* The entries' box adds nothing to the layout; it is where a stray press is stopped. */
.menu-list {
  display: contents;
}

/* An entry is a row of a list of choices: its sign, its words and, for a setting, the check
   at its end. The row the keys or the pointer are on takes the active fill; it never needs a
   ring, because the menu holds one such row at a time. */
.menu-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-height);
  padding: 0 var(--space-2);
  font: var(--font-row-title);
  border-radius: var(--radius-status);
  outline: none;
  cursor: pointer;

  &:has(.menu-item-icon) {
    grid-template-columns: 16px minmax(0, 1fr) 16px;
  }

  &[data-highlighted] {
    background: var(--color-surface-active);
  }

  &[data-disabled] {
    color: var(--color-text-muted);
    cursor: not-allowed;
  }
}

.menu-item-icon {
  color: var(--color-text-muted);
}

.menu-item-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.menu-item-check {
  display: inline-flex;
  grid-column: -2;
}

.menu-caption {
  padding: var(--space-2) var(--space-2) var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.menu-rule {
  height: 1px;
  margin: var(--space-1) calc(-1 * var(--space-1));
  background: var(--color-rule);
}

/* Forced colours draw no fills, so the row the keys are on keeps an outline there. */
@media (forced-colors: active) {
  .menu-item[data-highlighted] {
    outline: 1px solid Highlight;
    outline-offset: -1px;
  }
}
</style>
