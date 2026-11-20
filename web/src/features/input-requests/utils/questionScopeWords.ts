import type { QuestionScope } from '@/shared/api/inputRequestApi.ts'
import { projectName, spaceName } from '@/shared/lib/spaceNames.ts'
import type { SpaceName } from '@/shared/lib/spaceNames.ts'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** What the questions window says of what its list is narrowed to. */
export type QuestionScopeWords = {
  /** The chip over the list: the space, its project and the filter's kinds and labels. */
  chip: string
  /** The chip's way back to every space's questions. */
  exit: string
  /** The window's subtitle: where the questions stand and on which tasks; empty when nowhere. */
  subtitle: string
}

/**
 * The words of the window's narrowing. The space and the project are named as the context bar
 * names them (`spaceName`, `projectName`), a kind as the Volumes page's filter names it, and a
 * label as it is written. With no narrowing the window has no subtitle: that it lists the open
 * questions is what it always does, and a line saying so said nothing.
 */
export function questionScopeWords(
  scope: QuestionScope | null,
  spaces: readonly SpaceName[],
  t: Translate,
): QuestionScopeWords {
  if (!scope) return { chip: '', exit: '', subtitle: '' }
  const space = scope.space ? spaceName(spaces, scope.space) : null
  const project =
    scope.space && scope.project ? projectName(spaces, scope.space, scope.project) : null
  const kinds = scope.kinds.map((kind) => t(`workItem.kind.${kind}`))
  const chip = [space, project, ...kinds, ...scope.labels].filter(Boolean).join(' · ')
  let where = ''
  if (space)
    where = project
      ? t('requests.scopeProject', { space, project })
      : t('requests.scopeSpace', { space })
  const tasks = [
    kinds.length ? t('requests.tasksOfKind', { kind: kinds.join(', ') }) : '',
    scope.labels.length ? t('requests.tasksLabelled', { label: scope.labels.join(', ') }) : '',
  ]
    .filter(Boolean)
    .join(' ')
  let subtitle = where
  if (tasks)
    subtitle = where
      ? t('requests.scopeTasks', { scope: where, tasks })
      : t('requests.scopeTasksOnly', { tasks })
  return {
    chip,
    exit: space ? t('requests.scopeAll', { space: chip }) : t('requests.scopeAllTasks'),
    subtitle,
  }
}
