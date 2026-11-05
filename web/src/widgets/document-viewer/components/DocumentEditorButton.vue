<script setup lang="ts">
/**
 * Opens the document's own file in the owner's editor, at the line the reader is at, by
 * the same plan a file named in a text opens by. It reads that line at the press, since
 * the reader may have moved since the head was drawn.
 *
 * What came of it is said in the shell's status line, which lies over every host this
 * head stands in and on the page of its own as well. A plan that refuses leaves the path
 * copied, and says why. A file the viewer cannot show still opens here: an editor is
 * what such a file is for.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { DocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import { useOpenNotice } from '@/features/session-open/openNotice.ts'

import { opens, useDocumentOpener } from '@/entities/project-document/documentLinks.ts'

import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  view: DocumentView
  /** The line the reader is at now, or null for none. */
  line: () => number | null
}>()

/** Refusals of a file that is there, which an editor reads where the viewer does not. */
const EDITOR_READS = new Set(['tooLarge', 'notUtf8', 'binary'])

const { t } = useI18n()
const opener = useDocumentOpener()
const say = useOpenNotice()
const { document: shownFile, failure, place, staleness } = props.view

const editor = computed(() => opener.editor ?? 'VS Code')
const label = computed(() => t('documentLinks.viewer.editor', { editor: editor.value }))
const title = computed(() => t('documentLinks.viewer.editorTitle', { editor: editor.value }))

/** Only where the file is there to open and something here can open it. */
const offered = computed(() => {
  if (!opener.openFile || !place.value) return false
  if (shownFile.value) return staleness.value?.kind !== 'deleted'
  return EDITOR_READS.has(failure.value?.kind ?? '')
})

const busy = ref(false)
/** Absent rather than false, because `aria-busy="false"` is a claim and not a default. */
const busyMark = computed(() => busy.value || undefined)

async function copyPath(path: string, why: string) {
  try {
    await navigator.clipboard.writeText(path)
    say(
      why ? t('documentLinks.openRefused', { reason: why }) : t('documentLinks.openFailed'),
      'refused',
    )
  } catch {
    say(t('documentLinks.copyFailed'), 'refused')
  }
}

async function press() {
  const file = place.value
  const openFile = opener.openFile
  if (busy.value || !file || !openFile) return
  busy.value = true
  try {
    const target = { project: file.project, path: file.path, suffix: '', line: props.line() }
    const answer = await opens(openFile, target)
    if (answer !== true) await copyPath(file.path, typeof answer === 'string' ? answer : '')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <VButton
    v-if="offered"
    variant="ghost"
    :aria-label="label"
    :aria-busy="busyMark"
    :title="title"
    icon
    @click="press"
  >
    <VIcon name="edit" />
  </VButton>
</template>
