import type { QuestionScope } from '@/shared/api/inputRequestApi.ts'
import { spaceName } from '@/shared/lib/spaceNames.ts'
import type { SpaceName } from '@/shared/lib/spaceNames.ts'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** What the questions window says of what its list is narrowed to. */
export type QuestionScopeWords = {
  /** The chip over the list: the space, its project and the filter's kinds and labels. */
  chip: string
  /** The chip's way back to every space's questions. */
  exit: string
  /** The window's subtitle: where the questions stand and on which tasks. */
  subtitle: string
}

/**
 * The words of the window's narrowing. The space is named as the context bar names it
 * (`spaceName`), the project by its id, a kind as the Volumes page's filter names it, and a
 * label as it is written; with no narrowing the subtitle says the list is every space's.
 */
export function questionScopeWords(
  scope: QuestionScope | null,
  spaces: readonly SpaceName[],
  t: Translate,
): QuestionScopeWords {
  if (!scope) return { chip: '', exit: '', subtitle: t('requests.scope') }
  const space = scope.space ? spaceName(spaces, scope.space) : null
  const project = scope.space ? scope.project : null
  const kinds = scope.kinds.map((kind) => t(`workItem.kind.${kind}`))
  const chip = [space, project, ...kinds, ...scope.labels].filter(Boolean).join(' · ')
  let where = t('requests.scope')
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
  return {
    chip,
    exit: space ? t('requests.scopeAll', { space: chip }) : t('requests.scopeAllTasks'),
    subtitle: tasks ? t('requests.scopeTasks', { scope: where, tasks }) : where,
  }
}
