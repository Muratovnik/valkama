/**
 * Which projects the Analytics page's figures are of, said twice: in a few quiet words beside the
 * heading of every section the period's figures fill, «project Billing» or «all projects»
 * (`SectionScope`), and as the sentence the overview's «ⓘ» says. One project is named as the
 * shell names it, by its id where it has no name. The quota's sections say neither: the quota is
 * an account's, of no project.
 */
import { computed, inject, provide } from 'vue'
import type { ComputedRef, InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

export interface ScopeWords {
  /** The sentence of the overview's «ⓘ». */
  about: string
  /** The few words beside a section's heading. */
  short: string
}

const WORDS: InjectionKey<ComputedRef<ScopeWords>> = Symbol('analytics-scope-words')

/** The page's scope in words, for the sections under it to say beside their headings. */
export function provideScopeWords(scope: {
  /** The project the page is scoped to; null on the global page. */
  id: () => string | null
  /** That project's name, as the shell names it; null where it has none. */
  title: () => string | null
}) {
  const { t } = useI18n()
  const words = computed<ScopeWords>(() => {
    const id = scope.id()
    if (!id) return { about: t('analytics.scope.aboutAll'), short: t('analytics.scope.all') }
    const name = scope.title() ?? id
    return {
      about: t('analytics.scope.aboutProject', { name }),
      short: t('analytics.scope.project', { name }),
    }
  })
  provide(WORDS, words)
  return words
}

/** The page's scope in words; none for a section drawn outside the page. */
export const useScopeWords = () => inject(WORDS, null)
