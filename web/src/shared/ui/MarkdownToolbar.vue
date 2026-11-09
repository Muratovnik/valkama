<script setup lang="ts">
/**
 * The row at the top of an editor: what can be done to the text at its start, how
 * the text is looked at at its end.
 *
 * Pressing a button leaves focus where it is, because the selection in the field
 * is what the button acts on. Reached by Tab, as every other group of buttons here
 * is, a button hands focus back to the field when it has acted.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { MarkdownTool } from '@/shared/lib/markdownEdits.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import type { TabIds } from '@/shared/ui/tabIds.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** Whether the text can be acted on: not while it is being sent. */
  disabled: boolean
  /** Whether the host offers tasks to link: a mention with no list to open is a lie. */
  mentions: boolean
  /** Write and Preview are tabs over the text and its preview, which name them back. */
  views: TabIds
}>()
const emit = defineEmits<{ format: [tool: MarkdownTool]; mention: [] }>()
const preview = defineModel<boolean>('preview', { required: true })
const { t } = useI18n()

/** The formatting buttons in their order: what each does, draws and answers to. */
const FORMATS = [
  ['bold', 'format-bold', 'Ctrl+B'],
  ['italic', 'format-italic', 'Ctrl+I'],
  ['code', 'format-code', ''],
  ['link', 'format-link', ''],
  ['list', 'format-list', ''],
] as const

const tools = computed(() => [
  ...(props.mentions
    ? [
        {
          key: 'mention',
          icon: 'mention',
          keys: '',
          name: t('editor.tool.mention'),
          press: () => emit('mention'),
        },
      ]
    : []),
  ...FORMATS.map(([key, icon, keys]) => ({
    key,
    icon,
    keys,
    name: t(`editor.tool.${key}`),
    press: () => emit('format', key),
  })),
])
const toolTitle = (tool: { keys: string; name: string }) =>
  tool.keys ? `${tool.name} (${tool.keys})` : tool.name
const toolsOff = computed(() => preview.value || props.disabled)

const view = computed({
  get: () => (preview.value ? 'preview' : 'write'),
  set: (value: 'preview' | 'write') => {
    preview.value = value === 'preview'
  },
})
const viewOptions = computed(() => [
  { value: 'write' as const, label: t('editor.write') },
  { value: 'preview' as const, label: t('editor.preview') },
])
</script>

<template>
  <div class="markdown-toolbar">
    <div
      class="markdown-tools reach-grow"
      role="group"
      :aria-label="t('editor.tools')"
    >
      <VButton
        v-for="tool in tools"
        :key="tool.key"
        v-tooltip.name="toolTitle(tool)"
        variant="ghost"
        size="inline"
        :disabled="toolsOff"
        :aria-label="tool.name"
        icon
        @mousedown.prevent
        @click="tool.press"
      >
        <VIcon
          :name="tool.icon"
          :size="16"
        />
      </VButton>
    </div>
    <SegmentedControl
      v-model="view"
      class="markdown-view"
      size="inline"
      :label="t('editor.view')"
      :options="viewOptions"
      :tabs="views"
    />
  </div>
</template>

<style scoped>
/* Slim, at the height of its buttons: a row for reaching things, not for reading.
   It takes a second line rather than push the switch out of a narrow window. */
.markdown-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-half) var(--space-2);
  align-items: center;
  padding: var(--space-1);
}

/* The switch holds the end of whichever line it is on, as a form's buttons do: alone on the
   second line it stood at the start, under the bold and italic it has nothing to do with. */
.markdown-view {
  margin-inline-start: auto;
}

/* Where a finger presses an icon is a 44px target, drawn bare, as an entry's actions are
   (`reach-grow`); two pixels apart they have no room to reach into. */
.markdown-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-half);
}
</style>

<style scoped src="./reach.css"></style>
