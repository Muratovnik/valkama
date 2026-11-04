<script setup lang="ts">
/**
 * A project's Markdown file, read in Valkama: what stands in whichever host the window has
 * room for, a pane beside what it was opened from or a drawer over it.
 *
 * Inside, a link to another Markdown file opens here and leaves the place the reader
 * was at for Back; a link to a place in this one only moves there. What a press in the
 * text says, a path copied or why not, sounds in this viewer's own status line and not
 * in the corner of the window behind it.
 */
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTimeoutFn, useTitle } from '@vueuse/core'

import DocumentEditorButton from '@/widgets/document-viewer/components/DocumentEditorButton.vue'
import DocumentText from '@/widgets/document-viewer/components/DocumentText.vue'
import DocumentWindowButton from '@/widgets/document-viewer/components/DocumentWindowButton.vue'
import type {
  DocumentFailure,
  DocumentView,
} from '@/widgets/document-viewer/composables/useDocumentView.ts'
import { useReaderPlace } from '@/widgets/document-viewer/composables/useReaderPlace.ts'

import {
  provideDocumentOpener,
  useDocumentOpener,
} from '@/entities/project-document/documentLinks.ts'

import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { blockAtLine } from '@/shared/lib/richText.ts'
import type { RichDocument } from '@/shared/lib/richText.ts'
import { suffixTarget } from '@/shared/lib/textReferences.ts'
import OverlayHeader from '@/shared/ui/OverlayHeader.vue'
import { pageWasTouched } from '@/shared/ui/overlayStack.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  view: DocumentView
  /** It stands in a pane, beside what a link here may open, and not over it. */
  beside?: boolean
  /** The document is the whole window, at an address of its own, with nothing to close. */
  page?: boolean
}>()

/** How long what a press said stays, before the line goes back to what stands. */
const SAID_FOR_MS = 5000

const { t, d } = useI18n()
// One view for the window's life, so its parts can stand here unwrapped for the template.
const {
  back,
  canGoBack,
  close,
  document: shownFile,
  failure,
  go,
  loading,
  parsed,
  place,
  placement,
  previous,
  refresh,
  staleness,
  title,
} = props.view

const said = ref('')
const quiet = useTimeoutFn(
  () => {
    said.value = ''
  },
  SAID_FOR_MS,
  { immediate: false },
)
/** Emptied first, so that the same words said twice are announced twice. */
async function say(message: string) {
  said.value = ''
  await nextTick()
  said.value = message
  quiet.start()
}
const outer = useDocumentOpener()
provideDocumentOpener({
  // Read through, not copied: the editor's name follows the setting and the language.
  get editor() {
    return outer.editor
  },
  openFile: outer.openFile,
  openFolder: outer.openFolder,
  openDocument: ({ path, project, suffix }) => {
    go({ path, project, suffix })
    return true
  },
  say: (message) => void say(message),
})

// A page is the window, whose tab takes the document's title.
if (props.page) useTitle(title)
const path = computed(() => place.value?.path ?? '')
const project = computed(() => place.value?.project ?? '')
const closeLabel = computed(() => (props.page ? '' : t('documentLinks.viewer.close')))
const headingLevel = computed(() => (props.page ? 'h1' : 'h2'))
const refreshLabel = computed(() => t('documentLinks.viewer.refresh'))
const refreshTitle = computed(() => t('documentLinks.viewer.refreshTitle'))
const copyTitle = computed(() => t('documentLinks.viewer.copyPath', { path: path.value }))
const backTitle = computed(() =>
  t('documentLinks.viewer.backTo', { path: previous.value?.path ?? '' }),
)

function failureWords(reason: DocumentFailure): string {
  if (reason.kind === 'tooLarge') {
    const size = t('documentLinks.viewer.sizeKib', { size: Math.ceil(reason.size / 1024) })
    return t('documentLinks.viewer.failure.tooLarge', { size })
  }
  return t(`documentLinks.viewer.failure.${reason.kind}`, {
    path: path.value,
    project: project.value,
  })
}

const panel = computed<PlatformUiState | null>(() => {
  const reason = failure.value
  if (reason)
    return {
      interface_version: 'valkama-ui-state',
      status: reason.kind === 'unreachable' ? 'error' : 'unavailable',
      reason: failureWords(reason),
    }
  return loading.value ? { interface_version: 'valkama-ui-state', status: 'loading' } : null
})

/** Refreshing has a point where there is a text to renew or a read worth trying again. */
const canRefresh = computed(() =>
  shownFile.value ? staleness.value?.kind !== 'deleted' : failure.value?.kind === 'unreachable',
)

/** Another window has a point only while there is a text here it would show as well. */
const canOpenWindow = computed(
  () =>
    !props.page && shownFile.value !== null && (staleness.value?.kind ?? 'changed') === 'changed',
)

const anchorMissing = ref('')
const staleWords = computed(() => {
  const stale = staleness.value
  if (!stale) return ''
  if (stale.kind === 'changed') {
    const at = new Date(stale.at)
    const time = Number.isNaN(at.valueOf()) ? stale.at : d(at, 'clock')
    return t('documentLinks.viewer.changed', { time })
  }
  return stale.kind === 'deleted'
    ? t('documentLinks.viewer.deleted')
    : t('documentLinks.viewer.rereadFailed')
})
const status = computed(() => said.value || staleWords.value || anchorMissing.value)
const isQuiet = computed(() => status.value === '')
/** A text that may no longer be the file's is a warning; anything else is a report. */
const warns = computed(
  () => !said.value && staleWords.value !== '' && staleness.value?.kind !== 'changed',
)

const root = ref<HTMLElement | null>(null)
const header = ref<InstanceType<typeof OverlayHeader> | null>(null)
const scroller = ref<HTMLElement | null>(null)
const text = ref<InstanceType<typeof DocumentText> | null>(null)
const marked = shallowRef<ReadonlySet<number>>(new Set())

/** Where a suffix leads: the first block to land on and every block to mark. */
function blocksFor(shown: RichDocument, suffix: string): { first: number; marks: number[] } {
  const target = suffixTarget(suffix)
  if (target?.kind === 'anchor') {
    const first = shown.blocks.findIndex(({ anchors }) =>
      anchors.some((anchor) => anchor === target.id || anchor === target.id.toLowerCase()),
    )
    anchorMissing.value =
      first === -1 ? t('documentLinks.viewer.anchorMissing', { anchor: suffix }) : ''
    return { first, marks: first === -1 ? [] : [first] }
  }
  if (target?.kind !== 'lines') return { first: -1, marks: [] }
  const at = blockAtLine(shown, target.first)
  const first = at ? shown.blocks.indexOf(at) : -1
  const within = shown.blocks.flatMap((block, index) =>
    block.lastLine >= target.first && block.firstLine <= target.last ? [index] : [],
  )
  return { first, marks: within.length || first === -1 ? within : [first] }
}

/**
 * Focus follows the reader. A block a link sent them to is an answer to the press, which
 * asks for the ring; the head of a document just opened is only where reading starts,
 * and the input that opened it decides. A page opened by an address or a reload answers
 * nothing: focus waits on what it is read with, unringed, where the keys that scroll work.
 */
function land(box: HTMLElement | null) {
  if (props.page && !pageWasTouched()) scroller.value?.focus({ preventScroll: true })
  else if (box) moveFocus(box, { preventScroll: true })
  else header.value?.focusTitle()
}

function goToSuffix(suffix: string) {
  anchorMissing.value = ''
  const shown = parsed.value
  const { first, marks } = shown ? blocksFor(shown, suffix) : { first: -1, marks: [] }
  marked.value = new Set(marks)
  const body = scroller.value
  const box = first === -1 || !body ? null : (text.value?.bring(first, body) ?? null)
  if (!box) body?.scrollTo({ top: 0 })
  land(box)
}

watch(placement, async (aim) => {
  said.value = ''
  await nextTick()
  if (aim.kind === 'suffix') {
    goToSuffix(aim.suffix)
  } else {
    anchorMissing.value = ''
    marked.value = new Set()
    scroller.value?.scrollTo({ top: aim.top })
    land(null)
  }
})

const { lineAt } = useReaderPlace({
  anchorMissing,
  focusHead: () => header.value?.focusTitle(),
  marked,
  parsed,
  root,
  scroller,
  text,
  view: props.view,
})

/**
 * Beside what it was opened from nothing else takes focus as it opens, so it comes in here
 * as the read starts: from then on Escape closes this and not the card, whatever the read
 * comes to. A drawer has its own first control to go to.
 */
watch(
  loading,
  (reading) => {
    if (reading && props.beside && !root.value?.contains(document.activeElement))
      header.value?.focusTitle()
  },
  { flush: 'post', immediate: true },
)

/** A link leaves a document over the card for what it opens; beside, both stand. */
function leaveForLink() {
  if (!props.beside) close()
}

async function copyPath() {
  try {
    await navigator.clipboard.writeText(path.value)
    await say(t('documentLinks.copied'))
  } catch {
    await say(t('documentLinks.copyFailed'))
  }
}
</script>

<template>
  <article
    ref="root"
    class="document-viewer"
  >
    <OverlayHeader
      ref="header"
      class="document-head"
      :title="title"
      :close-label="closeLabel"
      :heading="headingLevel"
      focusable-title
      single-line
      @close="close"
    >
      <template
        v-if="canGoBack"
        #start
      >
        <VButton
          variant="ghost"
          :aria-label="backTitle"
          :title="backTitle"
          icon
          @click="back"
        >
          <VIcon name="chevron-left" />
        </VButton>
      </template>
      <template #meta>
        <p class="document-where">
          <span class="document-project">{{ project }} ·</span>
          <button
            class="document-path"
            type="button"
            :aria-label="copyTitle"
            :title="copyTitle"
            @click="copyPath"
          >
            <bdi>{{ path }}</bdi>
          </button>
        </p>
      </template>
      <template #actions>
        <VButton
          v-if="canRefresh"
          variant="ghost"
          :aria-label="refreshLabel"
          :title="refreshTitle"
          icon
          @click="refresh"
        >
          <VIcon name="refresh" />
        </VButton>
        <DocumentEditorButton
          :view="view"
          :line="lineAt"
        />
        <DocumentWindowButton
          v-if="canOpenWindow && place"
          :place="place"
          @opened="close"
        />
      </template>
    </OverlayHeader>
    <!-- Always there, so that what it comes to say is heard. -->
    <p
      class="document-status"
      role="status"
      :class="{ 'is-quiet': isQuiet }"
    >
      <VIcon
        v-if="warns"
        class="document-status-mark"
        name="alert"
        :size="14"
      />
      {{ status }}
    </p>
    <div
      ref="scroller"
      class="document-body"
      tabindex="-1"
      data-overlay-scroller
    >
      <PlatformStatePanel
        v-if="panel"
        :state="panel"
        :retryable="false"
        compact
      />
      <DocumentText
        v-else-if="parsed"
        ref="text"
        :document="parsed"
        :marked="marked"
        :path="path"
        :project="project"
        @leave="leaveForLink"
      />
    </div>
  </article>
</template>

<style scoped>
.document-viewer {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.document-head {
  flex: 0 0 auto;
  padding: var(--space-4) max(var(--space-5), var(--document-inset, 0px));
}

/* The path's end tells two files apart, so a long one gives up its start, and the whole
   of it stands in the tooltip. */
.document-where {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.document-project {
  flex: 0 0 auto;
}

.document-path {
  min-width: 0;
  min-height: 24px;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  text-align: start;
  white-space: nowrap;
  direction: rtl;
  background: transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: copy;

  &:hover {
    color: var(--color-text);
  }
}

/* A band of its own tone, under the head's rule, that takes no room with nothing to say.
   It is still there then, because a status region has to exist before what it announces. */
.document-status {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) max(var(--space-5), var(--document-inset, 0px));
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  background: var(--color-surface-muted);

  &.is-quiet {
    padding-block: 0;
    background: transparent;
  }
}

.document-status-mark {
  flex: 0 0 auto;
  color: var(--color-warning);
}

.document-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-5) max(var(--space-6), var(--document-inset, 0px)) var(--space-8);
  overflow-y: auto;
  overscroll-behavior: contain;
  outline: none;
}

@container overlay (width <= 560px) {
  .document-head,
  .document-status,
  .document-body {
    padding-inline: var(--space-4);
  }
}
</style>
