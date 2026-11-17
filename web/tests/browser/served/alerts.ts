/**
 * What the alerts' specs serve: the settings, each readiness the row can show, and a
 * trial Windows refused, all through `installAlerts` as the specs install it.
 */
import { installAlerts, READINESS_CASES } from '../alertsFixtures.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

const statusOf = (name: string) => READINESS_CASES.find((entry) => entry.name === name)?.status

/** A trial the helper could not show, as the readiness row reads a failed check. */
export const REFUSED_TRIAL = { ...statusOf('helper-unavailable')?.windows, shown: false }

const READS = [
  '/api/alerts/settings',
  '/api/alerts/status',
  { method: 'POST', url: '/api/alerts/test', body: {} },
] as const

export const routes: DrivenRoutes[] = [
  {
    name: 'alertsFixtures.ts installAlerts()',
    install: (page) => installAlerts(page),
    reads: READS,
  },
  ...READINESS_CASES.map(({ name, status }) => ({
    name: `alertsFixtures.ts READINESS_CASES ${name}`,
    install: (page: Parameters<DrivenRoutes['install']>[0]) => installAlerts(page, { status }),
    reads: READS,
  })),
  {
    name: 'served/alerts.ts REFUSED_TRIAL',
    install: (page) =>
      installAlerts(page, { status: statusOf('disabled-for-application'), test: REFUSED_TRIAL }),
    reads: READS,
  },
]
