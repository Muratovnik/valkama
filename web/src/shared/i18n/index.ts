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

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages,
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
