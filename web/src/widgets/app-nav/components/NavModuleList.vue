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
import { useI18n } from 'vue-i18n'

import type { ModuleId, ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    active: ModuleId
    modules: readonly ModuleManifest[]
    badges?: Partial<Record<ModuleId, number>>
    /** Shown above the entries, and hidden from sight — never from readers — on a narrow rail. */
    heading?: string
  }>(),
  { badges: () => ({}), heading: '' },
)

const emit = defineEmits<{
  navigate: [module: ModuleId]
  prefetch: [module: ModuleId, trigger: 'hover' | 'focus']
}>()

const { t, te } = useI18n()

function moduleTitle(module: ModuleManifest): string {
  return te(module.title_key) ? t(module.title_key) : module.module_id
}

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
  return { 'class': { active: current }, 'aria-current': current ? ('page' as const) : undefined }
}
</script>

<template>
  <section class="nav-group">
    <h2
      v-if="heading"
      class="nav-group-heading"
    >
      {{ heading }}
    </h2>
    <button
      v-for="module in modules"
      :key="module.module_id"
      type="button"
      class="nav-item"
      :class="`module-${module.module_id}`"
      v-bind="currentState(module)"
      :aria-label="moduleTitle(module)"
      :title="moduleTitle(module)"
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
        :label="t('modules.attention', { count: moduleBadge(module) })"
      />
    </button>
  </section>
</template>

<style scoped>
.nav-group {
  display: grid;
  gap: var(--space-half);
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
  grid-template-columns: 22px minmax(0, auto) minmax(0, 1fr);
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

  .nav-item {
    grid-template-columns: 1fr;
    justify-items: center;
    padding: 0;
  }

  .nav-item-label {
    display: none;
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
