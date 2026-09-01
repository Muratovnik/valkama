<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { onClickOutside, onKeyStroke, useStorage } from '@vueuse/core'

import type { PlatformActivity } from '@/shared/api/platformActivity.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import CountBadge from '@/shared/ui/CountBadge.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  items: PlatformActivity[]
  /**
   * Whether a row leads anywhere. The bell cannot answer this: a row names a
   * work item by reference, and which project owns that space is the shell's
   * knowledge, so the shell hands the verdict down rather than the widget
   * reaching up for the context.
   */
  navigable: (item: PlatformActivity) => boolean
}>()
const emit = defineEmits<{ select: [item: PlatformActivity] }>()
const { t, d } = useI18n()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const seenId = useStorage<number>('valkama-activity-seen', 0)

/** An ISO timestamp in the activity format. */
function observedAt(iso: string): string {
  return d(new Date(iso), 'activity')
}

const newestId = computed(() => props.items[0]?.activity_id ?? 0)
const unread = computed(() => props.items.filter((item) => item.activity_id > seenId.value).length)

watch(newestId, (latest) => {
  if (latest > 0 && seenId.value > latest) seenId.value = 0
  if (open.value && latest > seenId.value) seenId.value = latest
})

function toggle() {
  open.value = !open.value
  if (open.value) seenId.value = newestId.value
}

function choose(item: PlatformActivity) {
  if (!isBound(item)) return
  open.value = false
  emit('select', item)
}

function isBound(item: PlatformActivity): boolean {
  return props.navigable(item)
}

onClickOutside(root, () => (open.value = false))
onKeyStroke('Escape', () => (open.value = false))
</script>

<template>
  <div
    ref="root"
    class="activity-bell"
  >
    <button
      class="bell-trigger"
      type="button"
      :class="{ active: open }"
      :title="t('notifications.label')"
      :aria-label="t('notifications.label')"
      @click="toggle"
    >
      <VIcon
        name="bell"
        :size="19"
        :stroke-width="1.7"
      />
      <!-- Capped at one digit, because this badge stands on a 40px glyph rather
           than in a column of its own: "99+" is wider than the bell it marks
           and covers the thing it is about. The exact figure is on the button's
           accessible name and at the top of the panel it opens. -->
      <CountBadge
        v-if="unread"
        class="bell-count"
        :value="unread"
        :limit="9"
        :label="t('notifications.unread', { count: unread })"
      />
    </button>

    <section
      v-if="open"
      class="activity-panel"
    >
      <header>
        <div>
          <h2>{{ t('notifications.title') }}</h2>
        </div>
        <span v-if="unread">{{ t('notifications.unread', { count: unread }) }}</span>
      </header>

      <ol
        v-if="items.length"
        class="activity-list"
      >
        <li
          v-for="item in items"
          :key="item.activity_id"
        >
          <button
            type="button"
            :disabled="!isBound(item)"
            @click="choose(item)"
          >
            <span
              class="event-marker"
              aria-hidden="true"
              :class="`action-${item.status}`"
              :data-tone="statePresentation('activity-action', item.status).tone"
            />
            <span class="event-copy">
              <span class="event-line">
                <strong>{{ item.status }}</strong>
                <time :datetime="item.observed_at">{{ observedAt(item.observed_at) }}</time>
              </span>
              <span class="event-title">{{ item.title }}</span>
              <span class="event-meta">
                <b>{{ item.actor }}</b>
              </span>
              <span
                v-if="item.summary"
                class="event-detail"
                >{{ item.summary }}</span
              >
              <span
                v-if="!isBound(item)"
                class="event-unbound"
                >{{ t('platform.activity.primaryBindingRequired') }}</span
              >
            </span>
          </button>
        </li>
      </ol>
      <p
        v-else
        class="empty"
      >
        {{ t('notifications.empty') }}
      </p>
      <footer>{{ t('notifications.latest', { count: items.length }) }}</footer>
    </section>
  </div>
</template>

<style scoped>
.activity-bell {
  position: relative;
}

/* The shape of a control in the chrome is owned by the context bar that holds
   it, because the point is that the bell and the workspace selector are the
   same object; App.vue states it once for both. What stays here is what only
   the bell has: a square box, and a count in the corner of the glyph.

   The count used to stand beside the glyph as a bare number, which widened the
   control past every other one in the bar and read as a second label rather
   than as a count of what the bell is about. It belongs on the bell. */
.bell-trigger {
  position: relative;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-width: var(--size-control-height);
  padding: 0;
  cursor: pointer;

  /* Inside the button, in the corner of the bell, clear of the button's own edge.
     The ring is the ground the badge is cut out of, and the bar states which
     ground that is. The class is this component's, handed to the badge; the
     name the badge gives its own root is none of the bell's business. */
  .bell-count {
    inset-block-start: var(--space-half);
    inset-inline-end: var(--space-half);
  }
}

/* The drawing is the chrome row; the pointer target is larger than the drawing.
   Two tokens, so a square icon button can be as tall as the labelled controls
   beside it and still answer a click across the full 44px. */
.bell-trigger::after {
  content: '';
  position: absolute;
  inset: calc((var(--size-control-height) - var(--size-control-target)) / 2);
}

.bell-trigger.active {
  color: var(--color-text);
}

.activity-panel {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  width: min(440px, calc(100vw - 24px));
  max-height: min(680px, calc(100vh - 94px));
  border: 1px solid var(--color-rule);
  color: var(--color-text);
  background: var(--color-surface-sheet);
  overflow: hidden;
  border-radius: var(--radius-status);
  box-shadow: var(--shadow-overlay);

  & > header {
    display: flex;
    gap: var(--space-4);
    justify-content: space-between;
    align-items: end;
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--color-rule);
  }

  & > footer {
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-rule);
  }
}

h2 {
  margin: var(--space-1) 0 0;
  color: var(--color-text);
  font: 600 var(--font-size-module)/var(--line-height-tight) var(--font-family-interface);
}

.activity-panel > header > span,
.activity-panel > footer {
  color: var(--color-text-muted);
  font: var(--font-line);
}

.activity-list {
  flex: 1 1 auto;
  padding: var(--space-1) 0;
  margin: 0;
  overflow-y: auto;
  list-style: none;

  li + li {
    border-top: 1px solid color-mix(in srgb, var(--color-rule) 55%, transparent);
  }

  button {
    display: grid;
    grid-template-columns: 9px minmax(0, 1fr);
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 0;
    color: var(--color-text);
    text-align: left;
    background: none;
    cursor: pointer;

    &:hover {
      background: color-mix(in srgb, var(--color-rule) 22%, transparent);
    }
  }
}

.event-marker {
  width: 7px;
  height: 7px;
  margin-top: var(--space-2);
  background: var(--color-rule);
  border-radius: 50%;
}

.action-claimed,
.action-taken_over,
.action-checklist_claimed,
.action-checklist_taken_over,
.action-checklist_reopened {
  background: var(--color-action-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-action-primary) 16%, transparent);
}

.event-marker[data-tone='success'] {
  background: var(--color-success);
}

.event-copy {
  min-width: 0;
}

.event-line {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;

  strong {
    color: var(--color-action-primary);
    font: var(--font-strong);
  }

  time {
    color: var(--color-text-muted);
    font: var(--font-detail);
    white-space: nowrap;
  }
}

.event-title {
  display: block;
  margin-top: var(--space-1);
  font: var(--font-row-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-detail);

  b {
    color: var(--color-text);
    font-weight: 500;
  }
}

.event-detail,
.event-unbound {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.empty {
  padding: var(--space-9) var(--space-5);
  margin: 0;
  color: var(--color-text-muted);
  text-align: center;
}

@container main (width <= 636px) {
  .activity-panel {
    position: fixed;
    top: 70px;
    right: 12px;
  }
}
</style>
