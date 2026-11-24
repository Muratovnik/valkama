/**
 * The interface's language as the reader chooses it: Russian or English, kept on the device
 * and named on the document, so what reads the page's language reads the one it is in.
 */
import { useI18n } from 'vue-i18n'

export function useLocaleChoice() {
  const { locale } = useI18n()
  return (requested: string) => {
    const value = requested === 'ru' ? 'ru' : 'en'
    locale.value = value
    localStorage.setItem('valkama-locale', value)
    document.documentElement.lang = value
  }
}
