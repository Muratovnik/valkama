import { createI18n } from 'vue-i18n'

import { en } from './locales/en.ts'
import { ru } from './locales/ru.ts'

export type AppLocale = 'en' | 'ru'

export function resolveLocale(stored: string | null, languages: readonly string[]): AppLocale {
  if (stored === 'en' || stored === 'ru') return stored
  return languages.some((language) => language.toLowerCase().startsWith('ru')) ? 'ru' : 'en'
}

function initialLocale(): AppLocale {
  let stored: string | null = null
  try {
    stored = typeof localStorage === 'undefined' ? null : localStorage.getItem('valkama-locale')
  } catch {
    // Storage can be disabled; browser preference remains a complete fallback.
  }
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages
  return resolveLocale(stored, languages)
}

export const messages = { en, ru } as const

const RUSSIAN = new Intl.PluralRules('ru')
/** Which of a Russian message's three forms a number takes: день, дня, дней. */
const RUSSIAN_FORMS: Record<Intl.LDMLPluralRule, number> = {
  zero: 2,
  one: 0,
  two: 1,
  few: 1,
  many: 2,
  // A fraction: «1,5 дня» takes the form of «2 дня».
  other: 1,
}

/**
 * How a `|`-separated message picks its form. English needs no rule — vue-i18n's
 * default is the English one — but applies that same two-form rule to Russian,
 * which has three, and would print «2 дней». The forms come from the platform's
 * plural rules rather than from arithmetic on the last digits.
 */
export const pluralRules = {
  ru: (choice: number, choicesLength: number) =>
    choicesLength === 3 ? RUSSIAN_FORMS[RUSSIAN.select(Math.abs(choice))] : Number(choice !== 1),
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages,
  pluralRules,
  datetimeFormats: {
    en: {
      activity: {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      },
    },
    ru: {
      activity: {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      },
    },
  },
})
