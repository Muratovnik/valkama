import { computed } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

/** What of a question's form the press of the comment on its block opens and reads. */
interface NoteFields {
  noteOpen: boolean
  noteWritten: boolean
  pressNote: () => void
}

/**
 * The press of the comment on a question's block, which stands in the block's head while there
 * is a form to write it in (`shown`).
 *
 * A block of one question with options offers no comment of its own: the field's comment would
 * say the same. One an older answer wrote there stays open, to be read and changed.
 */
export function useBlockNote(host: {
  disabled: Readonly<Ref<boolean>>
  fields: Readonly<Ref<NoteFields | null>>
  request: Readonly<Ref<InputRequestEntry['request']>>
  shown: () => boolean
}) {
  const { t } = useI18n()
  const offers = computed(() => {
    const [only, ...rest] = host.request.value.fields
    return rest.length > 0 || only?.type === 'text' || (host.fields.value?.noteOpen ?? false)
  })
  const noteToggle = computed(() =>
    host.shown() && offers.value
      ? {
          disabled: host.disabled.value,
          name: t('requests.questionNoteName', { title: host.request.value.title }),
          open: host.fields.value?.noteOpen ?? false,
          written: host.fields.value?.noteWritten ?? false,
        }
      : null,
  )
  const pressNote = () => host.fields.value?.pressNote()
  return { noteToggle, pressNote }
}
