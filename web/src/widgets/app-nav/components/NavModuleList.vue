<script setup lang="ts">
/**
 * One group of destinations on the rail, under its own heading.
 *
 * The group is the unit because a heading and the entries under it are one
 * thing: the heading gives up its line when the rail has no room for a word, and
 * the entries stay. The list owns the entry — its icon, its label, its count and
 * what "current" looks like — so a rail that grows a second list of entries gets
 * the same button without a stylesheet knowing about it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ModuleId, ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    /** The section showing; null when the address names none. */
    active: ModuleId | null
    modules: readonly ModuleManifest[]
    badges?: Partial<Record<ModuleId, number>>
    /**
     * An entry that opens more under itself: a fold at its end, which says whether what it
     * controls is shown. The entry still goes to its module; the fold only shows or hides.
     */
    disclosure?: {
      controls: string
      expanded: boolean
      id: string
      label: string
      module: ModuleId
    } | null
    /** Shown above the entries, and hidden from sight — never from readers — on a narrow rail. */
    heading?: string
    /**
     * The page on show is one of the entry's own rows, which says it is the page: the entry
     * then says only that the reader is inside it, so one element of the rail is the page.
     */
    within?: boolean
  }>(),
  { badges: () => ({}), disclosure: null, heading: '', within: false },
)

const emit = defineEmits<{
  fold: []
  navigate: [module: ModuleId]
  prefetch: [module: ModuleId, trigger: 'hover' | 'focus']
}>()

const folds = (module: ModuleManifest) => props.disclosure?.module === module.module_id

const { t, te } = useI18n()

function moduleTitle(module: ModuleManifest): string {
  return te(module.title_key) ? t(module.title_key) : module.module_id
}

/**
 * A group whose only entry is already called by the group's name. The heading
 * still names the group for a reader; it just gives up its line, because the
 * entry under it says the same words.
 */
const headingRepeatsEntry = computed(() => {
  const [only] = props.modules
  return props.modules.length === 1 && only !== undefined && moduleTitle(only) === props.heading
})

/** How many things want attention in a module, or nothing when none do. */
function moduleBadge(module: ModuleManifest): number {
  return props.badges[module.module_id] ?? 0
}

/**
 * Whether this entry is the destination showing, as the two marks that say so.
 *
 * `aria-current` has to be absent rather than false on the other entries — every
 * entry claiming to be the current page names none of them — and the class and
 * the attribute cannot be allowed to disagree about which one it is.
 */
function currentState(module: ModuleManifest) {
  const current = props.active === module.module_id
  const mark = props.within ? ('true' as const) : ('page' as const)
  return { 'class': { active: current }, 'aria-current': current ? mark : undefined }
}
</script>

<template>
  <section class="nav-group">
    <h2
      v-if="heading"
      class="nav-group-heading"
      :class="{ 'nav-group-heading-echo': headingRepeatsEntry }"
    >
      {{ heading }}
    </h2>
    <div
      v-for="module in modules"
      :key="module.module_id"
      class="nav-entry"
    >
      <button
        v-tooltip:right.clipped="moduleTitle(module)"
        type="button"
        class="nav-item"
        :class="[`module-${module.module_id}`, { 'has-fold': folds(module) }]"
        v-bind="currentState(module)"
        @pointerenter="emit('prefetch', module.module_id, 'hover')"
        @focus="emit('prefetch', module.module_id, 'focus')"
        @click="emit('navigate', module.module_id)"
      >
        <VIcon
          class="nav-item-icon"
          :name="module.icon_key"
          :size="20"
        />
        <span class="nav-item-label">{{ moduleTitle(module) }}</span>
        <CountBadge
          v-if="moduleBadge(module)"
          class="nav-item-count"
          placement="inline"
          :value="moduleBadge(module)"
        />
      </button>
      <button
        v-if="disclosure && folds(module)"
        :id="disclosure.id"
        v-tooltip:right.name="disclosure.label"
        class="nav-entry-fold"
        type="button"
        :aria-expanded="disclosure.expanded"
        :aria-controls="disclosure.controls"
        :aria-label="disclosure.label"
        @click="emit('fold')"
      >
        <VIcon
          class="nav-entry-chevron"
          name="chevron-down"
          :size="16"
        />
      </button>
    </div>
    <slot />
  </section>
</template>

<style scoped>
/* Where an entry's label starts, measured from the entry's own start: its padding, the
   icon's column and the gap after it. A list in the group's slot reads it to start a
   caption under the label rather than at an edge of its own (`NavWorkTree`). */
.nav-group {
  --nav-icon-column: 22px;
  --nav-label-start: calc(var(--space-3) + var(--nav-icon-column) + var(--space-3));

  display: flex;
  flex-direction: column;
  gap: var(--space-half);
  min-height: 0;
}

.nav-entry {
  position: relative;
  flex: none;
}

/* The fold stands inside the entry's own ground, at its end, so «Work» and its list read
   as one control with one row; the entry keeps its room for it. */
.nav-item.has-fold {
  padding-inline-end: calc(var(--size-control-inline) + var(--space-2));
}

.nav-entry-fold {
  position: absolute;
  inset-block: 0;
  inset-inline-end: var(--space-1);
  display: inline-flex;
  justify-content: center;
  align-items: center;
  inline-size: var(--size-control-inline);
  block-size: var(--size-control-inline);
  padding: 0;
  margin-block: auto;
  border: 0;
  color: var(--color-navigation-text-muted);
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    color: var(--color-text-on-dark);
  }

  &:focus-visible {
    outline-offset: 0;
  }

  &[aria-expanded='false'] .nav-entry-chevron {
    rotate: -90deg;
  }
}

.nav-entry-chevron {
  transition: rotate var(--duration-quick) var(--ease-out);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}

/* 13px, not 12px. A group heading is read to decide where to go, which is the
   side of the floor the reading size is on; 12px is for chrome minutiae like a
   column count. */
.nav-group-heading {
  padding: 0 var(--space-3) var(--space-2);
  margin: 0;
  color: var(--color-navigation-text-muted);
  font: var(--font-group-heading);
}

/* Kept in the document for readers, out of the layout: the entry beneath it
   already prints the same word. */
.nav-group-heading-echo {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  white-space: nowrap;
  overflow: hidden;
  clip-path: inset(50%);
}

/* Icon, label, count — and the count belongs to the label, not to the far edge
   of the rail. It sat in a track pushed to the end, so a two-word entry put its
   own number an inch away from itself and six numbers lined up in a column that
   meant nothing. A label track that sizes to its content keeps the pair
   together, and the free space goes after both of them. */
.nav-item {
  /* For the count, which becomes a corner mark when the rail has no room for a
     line. */
  position: relative;
  display: grid;
  grid-template-columns: var(--nav-icon-column) minmax(0, auto) minmax(0, 1fr);
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: var(--size-control-height);
  padding: 0 var(--space-3);
  border: 0;
  color: var(--color-text-on-dark-muted);
  text-align: left;
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-raised);
  }

  /* The selected row is a lighter ground, nothing more. An accent rail beside it
     spends the product's one chromatic color on a fact the fill already states. */
  &.active {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-active);

    .nav-item-label {
      font-weight: 600;
    }

    /* A forced palette clears the ground, which leaves the weight alone to say where you
       are. The row takes the palette's selected pair instead, out of its reach as a pressed
       `SegmentedControl` segment is; the count it carries goes back into reach, and the
       ring outside the row takes the palette's colour, not the app's. */
    @media (forced-colors: active) {
      color: HighlightText;
      background: Highlight;
      forced-color-adjust: none;

      .nav-item-count {
        forced-color-adjust: auto;
      }

      &:focus-visible {
        outline-color: Highlight;
      }
    }
  }
}

.nav-item-count {
  justify-self: start;
}

.nav-item-label {
  min-width: 0;
  font: var(--font-name);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The rail declares the `nav` container and every part of it answers for itself,
   which is what lets this file own the narrow form of its own entries instead of
   the shell reaching down into them by class name.
   A group heading needs room for its longest word. When the rail has none, the
   heading stays for screen readers and gives up its line rather than being
   sliced at the rail edge. */
@container nav (width < 150px) {
  .nav-group-heading {
    position: absolute;
    width: 1px;
    height: 1px;

    /* Without this the heading keeps its 24px of padding under border-box, so
       the "1px" box is really 24px of clipped text rather than nothing. */
    padding: 0;
    white-space: nowrap;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .nav-item,
  .nav-item.has-fold {
    grid-template-columns: 1fr;
    justify-items: center;
    padding: 0;
  }

  /* No room for the list, so nothing to fold: a phone opens it from its own button. */
  .nav-entry-fold {
    display: none;
  }

  /* Out of sight, never out of the name. The entry is named by its content —
     label and count, exactly what a sighted reader sees beside the icon — so
     the label stays for a reader once the rail has no line for it. */
  .nav-item-label {
    position: absolute;
    width: 1px;
    height: 1px;
    white-space: nowrap;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* No line to print a number on, so the count shares the icon's cell and rides
     its top corner. Left in the single column it took a row of its own and made
     the one entry that has a count 44px tall beside five that are 40px. A rule
     for this existed in `shell.css` and was dead: it hung off a `.collapsed`
     class no template had rendered in a long time, so the container query is the
     first thing that has actually asked the question.

     One cell rather than `position: absolute`, because the badge declares its own
     `position` and `inset` for the inline placement and declares them at a higher
     specificity than a host can reach with one class. Placing the two in the same
     grid cell overrides nothing the badge said — a host that has to outrank a
     child's own rule is a host reaching past what the child agreed to. */
  :is(.nav-item-icon, .nav-item-count) {
    grid-area: 1/1;
  }

  .nav-item-count {
    place-self: start end;
  }
}
</style>
