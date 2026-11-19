/**
 * What a frame's header says in words: what its buttons are called, what a fold
 * hides, and the name of a frame no goal heads — the work under no goal, or another
 * space's work, named as the list's group and the board's lane of that space are. The
 * buttons' names say what the header shows, so the keyboard and the eye are told one
 * thing at every zoom.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { countedGroups } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import { NO_PARENT_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { FrameHead } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

interface FrameWordsInput {
  far: () => boolean
  frame: () => FrameHead
  overview: () => boolean
  working: () => number
}

export function useGraphFrameWords(input: FrameWordsInput) {
  const { t } = useI18n()

  /** The goal to open; the work under no goal has none. */
  const goal = computed(() => (input.frame().id === NO_PARENT_FRAME ? null : input.frame().goal))
  /** A frame says which it is: a stage stands under a parent, a goal under none. */
  const isStage = computed(() => goal.value?.kind === 'stage')
  const named = computed(() =>
    goal.value ? { reference: goal.value.reference, title: goal.value.title } : null,
  )
  /** The frame's name: its goal's title, another space's key and name, or no goal. */
  const name = computed(() => {
    const { space } = input.frame()
    if (goal.value) return goal.value.title
    return space ? t('workItem.grouped.space', space) : t('graph.frame.noGoal')
  })

  /**
   * What a fold hides: the goal's open work, whatever a filter let through, or
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

  /** The work moving under it, said whole. */
  const live = computed(() => {
    const working = input.working()
    return working > 0 ? [`${working} ${t('graph.frame.working', working)}`] : []
  })

  /**
   * What the fold does and what it hides. Over the work under no goal the fold is the
   * header's one button, so it says the work moving under it too, as the goal's does.
   */
  const foldLabel = computed(() => {
    const verb = input.frame().folded ? 'unfold' : 'fold'
    const kind = isStage.value ? 'Stage' : 'Goal'
    const { space } = input.frame()
    let action = t(`graph.frame.${verb}None`)
    if (named.value) action = t(`graph.frame.${verb}${kind}`, named.value)
    else if (space) action = t(`graph.frame.${verb}Space`, space)
    return [action, ...insideWhole.value, ...(named.value ? [] : live.value)].join(' · ')
  })

  /** What a reader hears for the open target: the same facts the header shows. */
  const openLabel = computed(() => {
    const { progress } = input.frame()
    const kind = isStage.value ? 'stage' : 'goal'
    const head = named.value ? t(`graph.frame.${kind}`, named.value) : name.value
    const { done, total } = progress
    const standing = total ? t('graph.frame.doneOf', { done, total }) : t('graph.frame.noTasks')
    const groups = countedGroups(progress).map(({ group, count }) => {
      const word = t(`graph.frame.${group}`, count)
      return `${count} ${word}`
    })
    return [head, standing, ...groups, ...insideWhole.value, ...live.value].join(' · ')
  })

  return { goal, foldLabel, inside, insideShown, name, openLabel }
}
