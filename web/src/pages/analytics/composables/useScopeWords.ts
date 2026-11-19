/**
 * Which projects the Analytics page's figures are of, as the sentence the overview's «ⓘ» says:
 * one project's, named as the shell names it, by its id where it has no name, or every project's.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export function useScopeWords(scope: {
  /** The project the page is scoped to; null on the global page. */
  id: () => string | null
  /** That project's name, as the shell names it; null where it has none. */
  title: () => string | null
}) {
  const { t } = useI18n()
  return computed(() => {
    const id = scope.id()
    return id
      ? t('analytics.scope.aboutProject', { name: scope.title() ?? id })
      : t('analytics.scope.aboutAll')
  })
}
