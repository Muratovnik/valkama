/**
 * What a frame's header says in words: what its buttons are called, and what a
 * fold hides. The buttons' names say what the header shows, so the keyboard and
 * the eye are told one thing at every zoom.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { countedGroups } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import { NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { FrameHead } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

interface FrameWordsInput {
  far: () => boolean
  frame: () => FrameHead
  overview: () => boolean
  working: () => number
}

export function useGraphFrameWords(input: FrameWordsInput) {
  const { t } = useI18n()

  /** The epic to open; the work under no epic has none. */
  const epic = computed(() => (input.frame().id === NO_EPIC_FRAME ? null : input.frame().epic))
  /** An epic says it is one; an item that grew children says it is an item. */
  const isEpic = computed(() => epic.value?.kind === 'epic')
  const named = computed(() =>
    epic.value ? { reference: epic.value.reference, title: epic.value.title } : null,
  )

  /**
   * What a fold hides: the epic's open work, whatever a filter let through, or
   * where none is open its closed work. Nothing when the frame is open or has
   * nothing to unfold.
   */
  const inside = computed(() => {
    const { folded, foldable, progress } = input.frame()
    if (!folded || !foldable) return null
    const open = progress.total - progress.done
    if (open > 0) return { count: open, words: t('graph.frame.openInside', open) }
    if (progress.done === 0) return null
    return { count: progress.done, words: t('graph.frame.closedInside', progress.done) }
  })
  /** The fold said whole, as a reader hears it at every zoom. */
  const insideWhole = computed(() => {
    const hidden = inside.value
    return hidden ? [`${hidden.count} ${hidden.words}`] : []
  })

  /** The fold as this zoom can show it; far out the words could not be read. */
  const insideShown = computed(() => {
    const hidden = inside.value
    if (!hidden) return ''
    if (input.far()) return `+${hidden.count}`
    if (input.overview()) return `${hidden.count} ${t('graph.frame.inside')}`
    return insideWhole.value.join('')
  })

  const foldLabel = computed(() => {
    const verb = input.frame().folded ? 'unfold' : 'fold'
    const kind = isEpic.value ? 'Epic' : 'Parent'
    const action = named.value
      ? t(`graph.frame.${verb}${kind}`, named.value)
      : t(`graph.frame.${verb}None`)
    return [action, ...insideWhole.value].join(' · ')
  })

  /** What a reader hears for the open target: the same facts the header shows. */
  const openLabel = computed(() => {
    const { progress } = input.frame()
    const kind = isEpic.value ? 'epic' : 'parent'
    const head = named.value ? t(`graph.frame.${kind}`, named.value) : t('graph.frame.noEpic')
    const { done, total } = progress
    const standing = total ? t('graph.frame.doneOf', { done, total }) : t('graph.frame.noTasks')
    const groups = countedGroups(progress).map(({ group, count }) => {
      const word = t(`graph.frame.${group}`, count)
      return `${count} ${word}`
    })
    const working = input.working()
    const live = working > 0 ? [`${working} ${t('graph.frame.working', working)}`] : []
    return [head, standing, ...groups, ...insideWhole.value, ...live].join(' · ')
  })

  return { epic, foldLabel, inside, insideShown, openLabel }
}
