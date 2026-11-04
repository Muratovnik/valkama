<script setup lang="ts">
/**
 * The page behind a work item address that did not lead to a card.
 *
 * Each answer names what is wrong with this link and offers the step that follows
 * from it: the space when the number is the mistake, the finder when the whole
 * link is, another try when the store could not say. The address is what a person
 * followed, so it stays as written and Reload asks again, which is how a number
 * filed a minute later opens.
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { readWorkItemLink } from '@/features/work-item-link/workItemLink.ts'
import type { WorkItemLinkAnswer } from '@/features/work-item-link/workItemLink.ts'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { uiLoading, uiUnavailable } from '@/shared/api/platformUiState.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ text: string }>()
const emit = defineEmits<{
  find: []
  found: [route: PlatformRoute]
  go: [route: PlatformRoute]
  home: []
}>()
const { t } = useI18n()

/** The most of a mistyped address worth repeating to the person who followed it. */
const SHOWN_TEXT = 64

const answer = shallowRef<WorkItemLinkAnswer | 'failed' | 'loading'>('loading')
let reading: AbortController | null = null

async function read() {
  reading?.abort()
  const current = new AbortController()
  reading = current
  answer.value = 'loading'
  try {
    const result = await readWorkItemLink(props.text, current.signal)
    if (current.signal.aborted) return
    if (result.kind === 'found') emit('found', result.route)
    else answer.value = result
  } catch {
    if (!current.signal.aborted) answer.value = 'failed'
  }
}

watch(() => props.text, read, { immediate: true })
onBeforeUnmount(() => reading?.abort())

const region = ref<HTMLElement | null>(null)
const retryButton = ref<InstanceType<typeof VButton> | null>(null)

/**
 * The read takes the failure panel down with this button in it, so focus falls to the
 * page. As a refresh pressed in the questions dialog does, the answer hands it back: to
 * Retry when the read failed again, to the region when it said something else. A reader
 * who moved on while it ran has focus somewhere else, and keeps it.
 */
async function retry() {
  await read()
  await nextTick()
  if (document.activeElement !== document.body) return
  const button = retryButton.value?.$el as HTMLElement | undefined
  ;(button ?? region.value)?.focus()
}

const absence = computed(() => {
  const value = answer.value
  if (typeof value === 'string') return null
  if (value.kind === 'no-item')
    return {
      title: t('workItemLink.noItem.title', { reference: value.reference }),
      description: t('workItemLink.noItem.description', { space: value.space }),
    }
  if (value.kind === 'no-space')
    return {
      title: t('workItemLink.noSpace.title', { space: value.space }),
      description: t('workItemLink.noSpace.description', { reference: value.reference }),
    }
  if (value.kind !== 'malformed') return null
  const text = props.text.trim()
  const shown = text.length > SHOWN_TEXT ? `${text.slice(0, SHOWN_TEXT)}…` : text
  return {
    title: t('workItemLink.malformed.title'),
    description: shown
      ? t('workItemLink.malformed.description', { text: shown })
      : t('workItemLink.malformed.empty'),
  }
})

const outage = computed(() => {
  const value = answer.value
  if (value === 'failed') return uiUnavailable(t('workItemLink.failed'))
  return typeof value === 'object' && value.kind === 'unreadable'
    ? uiUnavailable(
        t('workItemLink.unreadable', { reference: value.reference, space: value.space }),
      )
    : null
})

/** The space a missing number was looked for in, for the one step that goes there. */
const missedIn = computed(() => {
  const value = answer.value
  return typeof value === 'object' && value.kind === 'no-item' ? value : null
})
/** Going to that space is the step when there is one; otherwise the finder is. */
const findVariant = computed(() => (missedIn.value ? 'secondary' : 'primary'))
</script>

<template>
  <main
    ref="region"
    class="work-item-link"
    tabindex="-1"
  >
    <PlatformStatePanel
      v-if="outage"
      :state="outage"
      :retryable="false"
    >
      <template #action>
        <div class="work-item-link-actions">
          <VButton
            ref="retryButton"
            variant="primary"
            @click="retry"
            >{{ t('platform.actions.retry') }}</VButton
          >
          <VButton @click="emit('home')">{{ t('navigation.home') }}</VButton>
        </div>
      </template>
    </PlatformStatePanel>
    <DataEmptyState
      v-else-if="absence"
      class="work-item-link-absence"
      :title="absence.title"
      :description="absence.description"
    >
      <template #action>
        <div class="work-item-link-actions centered">
          <VButton
            v-if="missedIn"
            variant="primary"
            @click="emit('go', missedIn.spaceRoute)"
            >{{ t('workItemLink.openSpace', { space: missedIn.space }) }}</VButton
          >
          <VButton
            :variant="findVariant"
            @click="emit('find')"
            >{{ t('finder.trigger') }}</VButton
          >
          <VButton @click="emit('home')">{{ t('navigation.home') }}</VButton>
        </div>
      </template>
    </DataEmptyState>
    <PlatformStatePanel
      v-else
      :state="uiLoading()"
    />
  </main>
</template>

<style scoped>
.work-item-link {
  /* The page lies on the workspace panel, so a step above it is the ground. */
  --color-state-panel-surface: var(--color-surface);

  display: grid;
  gap: var(--space-4);
  align-content: start;
  width: min(var(--size-module-column), 100%);
  padding: var(--space-6) var(--size-page-gutter) var(--space-12);
  margin: 0 auto;
  outline: none;
}

/* A mistyped address is one long word as often as not. */
.work-item-link-absence {
  overflow-wrap: anywhere;
}

.work-item-link-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);

  &.centered {
    justify-content: center;
    margin-top: var(--space-2);
  }
}

/* The state panel drops its third column here, and a row of buttons left in the
   first would widen it until the message had no room. */
@container (width <= 560px) {
  .work-item-link-actions {
    grid-column: 1/-1;
  }
}
</style>
