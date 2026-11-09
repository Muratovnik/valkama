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
 *
 * Its width is the reader's: its right edge is a window splitter, dragged or stepped
 * with the arrow keys between the narrowest and the widest the window leaves it, and
 * kept for the next visit (`useDrawerWidth`, as a drawer's edge is). At 760px and
 * narrower it is its icons alone, and has no edge to drag.
 */
import { computed, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import NavConnectionButton, {
  connectionTroubled,
} from '@/widgets/app-nav/components/NavConnectionButton.vue'
import NavModuleList from '@/widgets/app-nav/components/NavModuleList.vue'
import NavWorkActions from '@/widgets/app-nav/components/NavWorkActions.vue'
import NavWorkGroup from '@/widgets/app-nav/components/NavWorkGroup.vue'
import type { NavShown, NavTarget } from '@/widgets/app-nav/components/NavWorkTree.vue'
import { useNavOpen } from '@/widgets/app-nav/composables/useNavOpen.ts'

import type { PendingCount } from '@/features/input-requests/composables/useInputRequests.ts'

import type {
  ModuleId,
  ModuleManifest,
  NavigationGroup,
} from '@/shared/api/platformModuleContract.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import {
  NAV_DEFAULT_WIDTH,
  NAV_ICONS_ONLY_WIDTH,
  NAV_MAX_WIDTH,
  NAV_MIN_WIDTH,
  NAV_WIDTH_STORAGE_KEY,
  NAV_WORKSPACE_ROOM,
} from '@/shared/lib/shellLayout.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import BrandMark from '@/shared/ui/BrandMark.vue'
import OverlayResizer from '@/shared/ui/OverlayResizer.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { useDrawerWidth } from '@/shared/ui/useDrawerWidth.ts'

const props = withDefaults(
  defineProps<{
    /** The section showing; null when the address names none. */
    active: ModuleId | null
    modules: readonly ModuleManifest[]
    badges?: Partial<Record<ModuleId, number>>
    connection?: 'connecting' | 'live' | 'reconnecting'
    /** The space and card on show, for the list of work going on now. */
    liveShown?: NavShown | null
    /** Where a row of that list leads; without it the list is not drawn. */
    liveTarget?: NavTarget | null
    pendingRequestCount?: PendingCount | null
    refreshing?: boolean
  }>(),
  {
    badges: () => ({}),
    connection: 'connecting',
    liveShown: null,
    liveTarget: null,
    refreshing: false,
    pendingRequestCount: null,
  },
)

const emit = defineEmits<{
  find: []
  go: [route: PlatformRoute]
  home: []
  navigate: [module: ModuleId]
  prefetch: [module: ModuleId, trigger: 'hover' | 'focus']
  refresh: []
  requests: []
}>()

const { t } = useI18n()
const GROUPS: readonly NavigationGroup[] = ['work', 'understand', 'capabilities']

const groupedModules = computed(() =>
  GROUPS.map((group) => {
    const modules = props.modules.filter((module) => module.navigation_group === group)
    return {
      group,
      heading: t(`platform.navigation.groups.${group}`),
      modules,
      // Work going on now hangs under «Work», wherever the work module is listed.
      live: props.liveTarget !== null && modules.some((module) => module.module_id === 'planning'),
    }
  }).filter((entry) => entry.modules.length > 0),
)

const systemModules = computed(() =>
  props.modules.filter((module) => module.navigation_group === 'system'),
)

/**
 * Work going on now hangs under «Work», which folds it: the entry still goes to the
 * board, and the fold at its end shows or hides the list.
 */
const navOpen = useNavOpen()
const liveListId = `nav-live-${useId()}`
const liveFold = computed(() => ({
  module: 'planning' as ModuleId,
  id: `${liveListId}-fold`,
  controls: liveListId,
  expanded: navOpen.isOpen('work'),
  label: t('liveWork.list'),
}))
const liveStore = useLiveWorkStore()
/** A row of the list, or its space's name, is the page on show. */
const liveWithin = computed(() => {
  const shown = props.liveShown
  const space = shown ? liveStore.spaces.find((each) => each.key === shown.key) : undefined
  return Boolean(
    shown &&
    space &&
    (shown.reference === null || space.rows.some((row) => row.reference === shown.reference)),
  )
})
const withinFor = (live: boolean) => live && liveWithin.value
const toggleLive = () => navOpen.set('work', !navOpen.isOpen('work'))
const foldFor = (live: boolean) => (live ? liveFold.value : null)

const railId = `nav-rail-${useId()}`
const {
  beginResize,
  drawerMaximum,
  drawerMinimum,
  drawerWidth,
  resizeFromKeyboard,
  resizing,
  restoreDrawerWidth,
  viewportWidth,
} = useDrawerWidth({
  active: () => !iconsOnly.value,
  defaultWidth: () => NAV_DEFAULT_WIDTH,
  edge: 'end',
  maxWidth: (viewport) => Math.min(NAV_MAX_WIDTH, viewport - NAV_WORKSPACE_ROOM),
  minWidth: () => NAV_MIN_WIDTH,
  resizable: () => true,
  storageKey: () => NAV_WIDTH_STORAGE_KEY,
})
restoreDrawerWidth()
/** The same question the style block's one viewport query asks. */
const iconsOnly = computed(() => viewportWidth.value <= NAV_ICONS_ONLY_WIDTH)
/**
 * The width the reader chose, which only a rail with words stands at. It is handed to the style
 * block rather than set as the width: an inline width outranks the viewport query, and between
 * a window narrowing and this file hearing of it the rail stood at the chosen width over a
 * workspace a phone leaves 130px.
 */
const railStyle = computed(() => ({ '--size-navigation-chosen-width': `${drawerWidth.value}px` }))

/** The foot draws its rule only while it holds the lost connection's control. */
const troubled = computed(() => connectionTroubled(props.connection))
const rail = useTemplateRef<HTMLElement>('rail')
/** The connection came back under focus: focus goes to the entry on show, else the first one. */
function settle() {
  const entries = rail.value?.querySelectorAll<HTMLElement>(
    '.app-nav-frame button, .app-nav-frame a',
  )
  const current = rail.value?.querySelector<HTMLElement>('.app-nav-frame [aria-current]')
  ;(current ?? entries?.[0])?.focus()
}

/** A list reports what was chosen; the shell above decides what to do about it. */
function forwardNavigate(module: ModuleId) {
  emit('navigate', module)
}

function forwardPrefetch(module: ModuleId, trigger: 'hover' | 'focus') {
  emit('prefetch', module, trigger)
}
</script>

<template>
  <aside
    :id="railId"
    ref="rail"
    class="app-nav-shell"
    :class="{ 'is-resizing': resizing }"
    :style="railStyle"
  >
    <div class="nav-head">
      <button
        v-tooltip:right.detail="t('navigation.home')"
        class="app-brand"
        type="button"
        @click="emit('home')"
      >
        <BrandMark
          tone="chrome"
          :size="30"
        />
        <span
          v-tooltip.clipped="t('app.title')"
          class="brand-name one-line"
          >{{ t('app.title') }}</span
        >
      </button>
    </div>

    <!-- One landmark from the actions down to the foot: Settings stands in the foot, so it
         is still a destination of the navigation wherever the list above it ends. -->
    <nav
      class="app-nav-frame"
      :aria-label="t('modules.label')"
    >
      <div class="app-nav">
        <NavWorkActions
          :pending-count="pendingRequestCount"
          @find="emit('find')"
          @requests="emit('requests')"
        />
        <NavModuleList
          v-for="entry in groupedModules"
          :key="entry.group"
          :class="{ 'nav-live-group': entry.live }"
          :active="active"
          :badges="badges"
          :heading="entry.heading"
          :modules="entry.modules"
          :disclosure="foldFor(entry.live)"
          :within="withinFor(entry.live)"
          @fold="toggleLive"
          @navigate="forwardNavigate"
          @prefetch="forwardPrefetch"
        >
          <NavWorkGroup
            v-if="entry.live && liveTarget"
            class="nav-live"
            :fold-id="liveFold.id"
            :list-id="liveListId"
            :open="navOpen"
            :shown="liveShown"
            :target="liveTarget"
            @go="(route) => emit('go', route)"
          />
        </NavModuleList>
      </div>

      <!-- The foot: the connection's state while it is lost, and Settings under it at the
           floor of the rail. Settings stood under the last group, so a long list of work
           going on now carried it down into the middle of the rail and a short one left it
           half way up; at the floor it is where it was the last time, whatever the list holds,
           and a lost connection said above it does not move it. -->
      <div
        class="nav-utility"
        :class="{ 'is-quiet': !troubled }"
      >
        <NavConnectionButton
          :connection="connection"
          :refreshing="refreshing"
          @refresh="emit('refresh')"
          @settled="settle"
        />
        <NavModuleList
          v-if="systemModules.length"
          :active="active"
          :badges="badges"
          :modules="systemModules"
          @navigate="forwardNavigate"
          @prefetch="forwardPrefetch"
        />
      </div>
    </nav>

    <OverlayResizer
      v-if="!iconsOnly"
      at="after"
      :label="t('navigation.resize')"
      :controls="railId"
      :minimum="drawerMinimum"
      :maximum="drawerMaximum"
      :now="drawerWidth"
      @pointerdown="beginResize"
      @keydown="resizeFromKeyboard"
    />
  </aside>
</template>

<style scoped>
.app-nav-shell {
  /* The width the reader chose, which the element's own style writes over. */
  --size-navigation-chosen-width: 260px;
  --size-navigation-width: var(--size-navigation-chosen-width);

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

  /* While the edge is dragged the pointer crosses the rail's words, which neither select
     nor change the cursor under it. */
  &.is-resizing,
  &.is-resizing * {
    cursor: col-resize;
    user-select: none;
  }
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
}

/* Everything under the head: the middle, then the foot at the floor of the rail. */
.app-nav-frame {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* The rail's middle: the actions and the groups, in a column whose one flexible part
   is the list of work going on now. Everything else keeps its height, so the list gives
   way first and scrolls, and the foot under it stays in sight. */
.app-nav {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
  min-height: 0;
  padding: var(--space-4) var(--space-3);

  & > * {
    flex: none;
  }

  & > .nav-live-group {
    flex: 0 1 auto;
  }
}

.nav-live {
  flex: 0 1 auto;
}

/* Its entries start where the middle's do. A rule above it only while it says the
   connection is lost: Settings alone is one more entry of the rail, and a line over it
   would divide nothing. */
.nav-utility {
  display: grid;
  flex: none;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-3) var(--space-4);
  margin-top: auto;
  border-top: 1px solid var(--color-rule);

  &.is-quiet {
    padding-top: 0;
    border-top: 0;
  }
}

/* The one viewport question in this component, and the reason `check:ui-system`
   names this file among the two that may ask: an element deciding its own width
   cannot ask a container about it, because the container is itself. Its number is
   `NAV_ICONS_ONLY_WIDTH`, which takes the width the reader chose off the rail. */
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
