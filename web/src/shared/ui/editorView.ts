import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Write or preview: the one choice every host of `MarkdownEditor` offers above
 * its fields, as a `SegmentedControl` model.
 *
 * The host owns it rather than the editor because one choice can govern several
 * fields at once — a report's three sections, a question's text answers — and a
 * switch per field would let them disagree about which view is showing.
 */
export function useEditorView() {
  const { t } = useI18n()
  const previewing = ref(false)
  const view = computed({
    get: () => (previewing.value ? 'preview' : 'write'),
    set: (value: 'preview' | 'write') => {
      previewing.value = value === 'preview'
    },
  })
  const views = computed(() => [
    { value: 'write' as const, label: t('editor.write') },
    { value: 'preview' as const, label: t('editor.preview') },
  ])
  return { previewing, view, views }
}
