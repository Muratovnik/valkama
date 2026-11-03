import { onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import { useAlertFailureText } from '@/pages/settings/composables/useAlertSettings.ts'
import {
  failedReadiness,
  readinessOfStatus,
  readinessOfTrial,
} from '@/pages/settings/utils/alertReadiness.ts'
import type { AlertReadiness } from '@/pages/settings/utils/alertReadiness.ts'

import { fetchAlertStatus, sendTestAlert } from '@/shared/api/alertsApi.ts'

/**
 * Whether Windows will show Valkama's alerts, and the test that asks it to.
 *
 * The cure for most answers is in the Windows settings, so the answer is read again
 * whenever the window comes back. What was last read stays on screen meanwhile.
 */
export function useAlertChannel() {
  const { t } = useI18n()
  const failureText = useAlertFailureText()
  const readiness = shallowRef<AlertReadiness | null>(null)
  const checking = ref(false)
  const sending = ref(false)
  /** The last test's answer, until the next one starts. */
  const testOutcome = shallowRef<AlertReadiness | null>(null)

  async function recheck() {
    if (checking.value) return
    checking.value = true
    try {
      readiness.value = readinessOfStatus(await fetchAlertStatus())
    } catch (error) {
      readiness.value = failedReadiness(failureText(error))
    } finally {
      checking.value = false
    }
  }

  async function sendTest() {
    if (sending.value) return
    sending.value = true
    testOutcome.value = null
    try {
      testOutcome.value = readinessOfTrial(await sendTestAlert(), t('alerts.testNotStarted'))
    } catch (error) {
      testOutcome.value = failedReadiness(failureText(error))
    } finally {
      sending.value = false
    }
    void recheck()
  }

  useEventListener(window, 'focus', () => void recheck())
  onMounted(recheck)

  return { readiness, checking, sending, testOutcome, recheck, sendTest }
}
