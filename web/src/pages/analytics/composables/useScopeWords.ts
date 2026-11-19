/**
 * Which projects the Analytics page's figures are of, as its scope says: in the bar's few words,
 * «project Billing» or «all projects», and as the sentence the overview's «ⓘ» says. A project is
 * named as the shell names it, by its id where it has no name.
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
    if (!id) return { bar: t('analytics.scope.all'), about: t('analytics.scope.aboutAll') }
    const name = scope.title() ?? id
    return {
      bar: t('analytics.scope.project', { name }),
      about: t('analytics.scope.aboutProject', { name }),
    }
  })
}
