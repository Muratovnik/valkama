/**
 * A doctor report with one of each kind, across the levels it answers in.
 *
 * Its own file for the reason the execution and memory fixtures got one:
 * `backend.ts` is a route table, not a place where every module's payload
 * accumulates until nobody can read it.
 *
 * The failure sits in the last level on purpose. Level order is causal rather
 * than severity-ordered, so a red Connections under a green Installation is
 * exactly the arrangement a severity sort would wrongly rearrange.
 */

export const doctorReport = {
  checked_at: '2026-08-24T08:30:00Z',
  interface_version: 'valkama-doctor',
  status: 'fail',
  summary: { ok: 1, warn: 1, fail: 1, unknown: 0 },
  levels: [
    {
      id: 'installation',
      title: 'Installation',
      status: 'ok',
      checks: [
        {
          id: 'store-schema',
          title: 'Store schema',
          status: 'ok',
          detail: 'schema 5',
          fix: '',
          presentation: { code: 'store-schema-supported', parameters: { stored: 5 } },
        },
      ],
    },
    {
      id: 'projects',
      title: 'Projects',
      status: 'warn',
      checks: [
        {
          id: 'registry',
          title: 'Project registry',
          status: 'warn',
          detail: '0 project(s) from C:\\Users\\operator\\AppData\\Local\\Valkama\\projects.json',
          fix: 'Check that the registry file exists and contains valid JSON.',
          presentation: {
            code: 'registry-unavailable',
            parameters: {
              count: 0,
              path: 'C:\\Users\\operator\\AppData\\Local\\Valkama\\projects.json',
            },
          },
        },
      ],
    },
    { id: 'capabilities', title: 'Capabilities', status: 'unknown', checks: [] },
    {
      id: 'connections',
      title: 'Connections',
      status: 'fail',
      checks: [
        {
          id: 'listener',
          title: 'Listener identity',
          status: 'fail',
          detail: 'the listener serves a different build',
          fix: 'Stop that process and start it again from here.',
          presentation: { code: 'listener-stale', parameters: { port: 8642 } },
        },
      ],
    },
  ],
}
