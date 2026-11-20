import { useI18n } from 'vue-i18n'

/**
 * A moment work is put off until, as the owner reads it. A day comes back at its midnight in UTC,
 * so it is said as that day, wherever the reader is; a time is said as the reader's own clock has
 * it. A value that is no moment is said as it came.
 */
export function usePutOffDay(): (value: string) => string {
  const { d } = useI18n()
  return (value) => {
    const date = new Date(value)
    if (Number.isNaN(date.valueOf())) return value
    const midnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0
    return midnight
      ? d(date, { day: 'numeric', month: 'long', timeZone: 'UTC' })
      : d(date, 'activity')
  }
}
