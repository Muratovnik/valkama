<script setup lang="ts">
/**
 * The navigation rail: the brand, the destinations, and whether the app is live.
 *
 * The rail owns its own width and declares the `nav` container, which is the one
 * fact its contents cannot work out for themselves — at 260px an entry has room
 * for a word and at 64px it has none, and only the rail knows which it is. So
 * this file asks the window exactly once, about itself, and every reaction to the
 * answer is a container query here or in the part it belongs to.
 *
 * What the rail hands out is a list of destinations and the connection control.
 * Their rules used to live in `app/styles/shell.css`, where a stylesheet outside
 * this component named `.app-nav-item`, `.nav-label`, `.connection-dot` and a
 * bare `svg` inside a `VIcon` — 190 lines describing this component's insides
 * from a file that could not see them, which is the failure scoped styles exist
 * to prevent. Splitting the parts out is what made bringing the rules home
 * possible without this file growing past what one screen holds.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import NavConnectionButton from '@/widgets/app-nav/components/NavConnectionButton.vue'
import NavModuleList from '@/widgets/app-nav/components/NavModuleList.vue'

import type {
  ModuleId,
  ModuleManifest,
  NavigationGroup,
} from '@/shared/api/platformModuleContract.ts'
import BrandMark from '@/shared/ui/BrandMark.vue'

const props = withDefaults(
  defineProps<{
    active: ModuleId
    modules: readonly ModuleManifest[]
    badges?: Partial<Record<ModuleId, number>>
    connection?: 'connecting' | 'live' | 'reconnecting'
    refreshing?: boolean
  }>(),
  { badges: () => ({}), connection: 'connecting', refreshing: false },
)

const emit = defineEmits<{
  home: []
  navigate: [module: ModuleId]
  prefetch: [module: ModuleId, trigger: 'hover' | 'focus']
  refresh: []
}>()

const { t } = useI18n()
const GROUPS: readonly NavigationGroup[] = ['work', 'understand', 'capabilities']

const groupedModules = computed(() =>
  GROUPS.map((group) => ({
    group,
    heading: t(`platform.navigation.groups.${group}`),
    modules: props.modules.filter((module) => module.navigation_group === group),
  })).filter((entry) => entry.modules.length > 0),
)

const systemModules = computed(() =>
  props.modules.filter((module) => module.navigation_group === 'system'),
)

/** A list reports what was chosen; the shell above decides what to do about it. */
function forwardNavigate(module: ModuleId) {
  emit('navigate', module)
}

function forwardPrefetch(module: ModuleId, trigger: 'hover' | 'focus') {
  emit('prefetch', module, trigger)
}
</script>

<template>
  <aside class="app-nav-shell">
    <div class="nav-head">
      <button
        class="app-brand"
        type="button"
        :aria-label="t('navigation.home')"
        @click="emit('home')"
      >
        <BrandMark
          tone="chrome"
          :size="30"
        />
        <span class="brand-name">{{ t('app.title') }}</span>
      </button>
    </div>

    <nav
      class="app-nav"
      :aria-label="t('modules.label')"
    >
      <NavModuleList
        v-for="entry in groupedModules"
        :key="entry.group"
        :active="active"
        :badges="badges"
        :heading="entry.heading"
        :modules="entry.modules"
        @navigate="forwardNavigate"
        @prefetch="forwardPrefetch"
      />

      <!-- Settings is a destination like every other entry, so it stands under
           the last of them, in a group of its own with no heading. It used to be
           pinned to the floor of the rail beside the connection strip, which put
           a place you navigate to inside the block that reports whether the app
           is connected — two different kinds of thing sharing one footer, and a
           gap of empty rail between the navigation and its own last item. -->
      <NavModuleList
        v-if="systemModules.length"
        :active="active"
        :badges="badges"
        :modules="systemModules"
        @navigate="forwardNavigate"
        @prefetch="forwardPrefetch"
      />
    </nav>

    <div class="nav-utility">
      <NavConnectionButton
        :connection="connection"
        :refreshing="refreshing"
        @refresh="emit('refresh')"
      />
    </div>
  </aside>
</template>

<style scoped>
.app-nav-shell {
  --size-navigation-width: 260px;

  position: relative;
  z-index: 40;
  display: flex;
  flex-direction: column;
  grid-row: 1;
  grid-column: 1;
  width: var(--size-navigation-width);
  min-width: var(--size-navigation-width);
  height: 100dvh;
  min-height: 0;
  color: var(--color-text-on-dark);
  background: var(--color-navigation);
  container: nav / inline-size;
}

/* No rule under the brand and none down the right edge of the rail. The rail,
   the context bar and the window are one ground now, so a line inside it divides
   nothing; the only edge worth drawing is the one where the workspace panel
   begins, and the panel draws it. */
.nav-head {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
}

.app-brand {
  display: flex;
  flex: 1 1 auto;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
  padding: 0;
  border: 0;
  color: var(--color-text-on-dark);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

/* Named, because `& > span:last-child` was a rule about where the word sits in
   the markup rather than about what the word is. */
.brand-name {
  font-size: var(--font-size-module);
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-nav {
  display: grid;
  gap: var(--space-6);
  align-content: start;
  min-width: 0;
  padding: var(--space-4) var(--space-3);
}

.nav-utility {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-3) var(--space-4);
  margin-top: auto;
  border-top: 1px solid var(--color-rule);
}

/* The one viewport question in this component, and the reason `check:ui-system`
   names this file among the two that may ask: an element deciding its own width
   cannot ask a container about it, because the container is itself. */
@media (width <= 760px) {
  .app-nav-shell {
    --size-navigation-width: 64px;
  }
}

/* Everything the narrowing does is answered against the container the rail
   declares, at the same threshold its parts use. A rail with no room for a word
   keeps the mark out of the way of the destinations and closes the groups up. */
@container nav (width < 150px) {
  .app-nav {
    gap: var(--space-2);
  }

  .app-brand {
    display: none;
  }

  .nav-head {
    justify-content: center;
    padding-inline: var(--space-2);
  }
}
</style>
