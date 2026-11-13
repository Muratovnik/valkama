import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ProcessRunResult, SessionRateLimit } from 'claude-code'

// The engine beneath the mod: the environment, the session's id and usage reading, a file system
// holding the managed launcher's manifest, and a host that records each command the mod runs and
// answers it as the test says. Every path, id and number is invented. The expected reset times are
// worked out from the epoch by hand: 2026-10-14T16:00:00Z is 1791993600, 2026-10-17T02:00:00Z is
// 1792202400.

const T0 = Date.UTC(2026, 9, 14, 12, 0, 0)
const LOCAL = 'C:\\Users\\operator\\AppData\\Local'
const BIN = `${LOCAL}\\Valkama\\bin`
const PYTHON = 'C:\\Python\\python.exe'
const MANIFEST = JSON.stringify({ schema_version: 1, platform: 'nt', python: PYTHON, files: {} })

type Run = { argv: readonly string[]; stdin: string | undefined; timeoutMs: number | undefined }
type Answer = (run: Run) => ProcessRunResult | Promise<ProcessRunResult>
type Setup = { env?: Record<string, string>; files?: Record<string, string>; answer?: Answer }

const ran = (exitCode: number): ProcessRunResult => ({ exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

const engine = (on: On, rateLimits: SessionRateLimit[], setup: Setup = {}) => {
  const { env = { LOCALAPPDATA: LOCAL }, files = { [`${BIN}\\valkama-launcher.json`]: MANIFEST }, answer = () => ran(0) } = setup
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, env)
  const session = { id: 's1' }
  const usage = { rateLimits }
  const runs: Run[] = []
  on('session.id', () => ({ value: session.id }))
  on('session.usage', () => ({ value: { startedAt: T0, context: { window: 200_000 }, rateLimits: usage.rateLimits } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  // The engine hands a hook the path as this host spells it (`/opt/bin` reads `C:\opt\bin` on
  // Windows), so a file is found by its path with the drive and the separators left aside.
  const plain = (path: string) => path.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/')
  const held = new Map(Object.entries(files).map(([path, text]) => [plain(path), text]))
  on('fs.read', (_$, e) => {
    const text = held.get(plain(e.path))
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('process.run', async (_$, e) => {
    const run = { argv: e.argv, stdin: e.init?.stdin, timeoutMs: e.init?.timeoutMs }
    runs.push(run)
    return { value: await answer(run) }
  })
  return { clock, session, usage, runs }
}

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: null, isInteractive: false })
const completeTurn = ($: Engine) => $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
const handed = (run: Run | undefined) => JSON.parse(run?.stdin ?? 'null')

const plan: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-14T16:00:00.000Z' },
  { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-17T02:00:00.000Z' },
]

describe('the hand-over', () => {
  test('a finished turn hands the reading to the receiver the managed launcher names, bounded in time', async ($, on) => {
    const { clock, runs } = engine(on, plan)
    await completeTurn($)
    await clock.settle()

    expect(runs.length).toBe(1)
    expect(runs[0]?.argv).toEqual([PYTHON, '-I', '-S', `${BIN}\\valkama-launcher.py`, 'statusline', '--source=mod'])
    expect(runs[0]?.timeoutMs).toBe(10_000)
    expect(handed(runs[0])).toEqual({
      session_id: 's1',
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: 1791993600 },
        seven_day: { used_percentage: 41, resets_at: 1792202400 },
      },
    })
  })

  test('a session that starts with a reading hands it over; one before its first response hands nothing', async ($, on) => {
    const { clock, usage, runs } = engine(on, [])
    await start($)
    await completeTurn($)
    await clock.settle()
    expect(runs.length).toBe(0)

    usage.rateLimits = plan
    await start($)
    await clock.settle()
    expect(runs.length).toBe(1)
  })

  test('a measurement that moves a window is handed over at once; one that moves only the context is not', async ($, on) => {
    const { clock, runs } = engine(on, [])
    await $.session.measure({ context: { window: 200_000 }, rateLimits: plan, changed: ['context'] })
    await clock.settle()
    expect(runs.length).toBe(0)

    await $.session.measure({ context: { window: 200_000 }, rateLimits: plan, changed: ['rateLimits'] })
    await clock.settle()
    expect(handed(runs[0]).rate_limits.five_hour.used_percentage).toBe(23.5)
  })

  test('a reading the receiver took is not handed over again; a changed one and a new session are', async ($, on) => {
    const { clock, session, usage, runs } = engine(on, plan)
    await completeTurn($)
    await clock.settle()
    await completeTurn($)
    await clock.settle()
    expect(runs.length).toBe(1)

    usage.rateLimits = [{ kind: 'five_hour', percentUsed: 24.1, resetsAt: '2026-10-14T16:00:00.000Z' }]
    await completeTurn($)
    await clock.settle()
    session.id = 's2'
    await completeTurn($)
    await clock.settle()
    expect(runs.map(run => [handed(run).session_id, handed(run).rate_limits.five_hour.used_percentage])).toEqual([
      ['s1', 23.5],
      ['s1', 24.1],
      ['s2', 24.1],
    ])
  })

  test('a reset with no time is handed over without one', async ($, on) => {
    const { clock, runs } = engine(on, [{ kind: 'five_hour', percentUsed: 0 }])
    await completeTurn($)
    await clock.settle()
    expect(handed(runs[0]).rate_limits).toEqual({ five_hour: { used_percentage: 0 } })
  })

  const posix = JSON.stringify({ python: '/usr/bin/python3' })
  for (const [where, env, shim] of [
    ['~/.local/bin', { HOME: '/home/operator' }, '/home/operator/.local/bin/valkama-launcher.py'],
    ['XDG_BIN_HOME', { HOME: '/home/operator', XDG_BIN_HOME: '/opt/bin' }, '/opt/bin/valkama-launcher.py'],
    ['XDG_BIN_HOME under ~', { HOME: '/home/operator', XDG_BIN_HOME: '~/bin' }, '/home/operator/bin/valkama-launcher.py'],
  ] as const) {
    test(`elsewhere the launcher is found under ${where}`, async ($, on) => {
      const { clock, runs } = engine(on, plan, { env, files: { [shim.replace('.py', '.json')]: posix } })
      await completeTurn($)
      await clock.settle()
      expect(runs[0]?.argv.slice(0, 4)).toEqual(['/usr/bin/python3', '-I', '-S', shim])
    })
  }
})

describe('without Valkama, or with Valkama failing', () => {
  for (const [missing, setup] of [
    ['no manifest', { files: {} }],
    ['no folder to look in', { env: {} }],
    ['a manifest naming no interpreter', { files: { [`${BIN}\\valkama-launcher.json`]: '{"python": ""}' } }],
    ['a manifest that is not JSON', { files: { [`${BIN}\\valkama-launcher.json`]: 'not json' } }],
  ] as const) {
    test(`with ${missing}, nothing runs and the turn is answered as it was`, async ($, on) => {
      const { clock, runs } = engine(on, plan, setup)
      expect(await completeTurn($)).toEqual({ text: 'done' })
      await clock.settle()
      expect(runs.length).toBe(0)
    })
  }

  test('a receiver that cannot start or runs past its time fails nothing, and the reading is tried again', async ($, on) => {
    let refuse = true
    const { clock, runs } = engine(on, plan, {
      answer: () => {
        if (refuse) throw new Error('the command ran past its timeout')
        return ran(0)
      },
    })
    expect(await completeTurn($)).toEqual({ text: 'done' })
    await clock.settle()
    expect(runs.length).toBe(1)

    refuse = false
    expect(await completeTurn($)).toEqual({ text: 'done' })
    await clock.settle()
    expect(runs.length).toBe(2)
    expect(handed(runs[1])).toEqual(handed(runs[0]))
  })

  test('a receiver that exits with a failure is tried again with the next response', async ($, on) => {
    let status = 1
    const { clock, runs } = engine(on, plan, { answer: () => ran(status) })
    await completeTurn($)
    await clock.settle()
    status = 0
    await completeTurn($)
    await clock.settle()
    await completeTurn($)
    await clock.settle()
    expect(runs.length).toBe(2)
  })

  test('a slow receiver holds no turn and one process: the newest reading waits for it', async ($, on) => {
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const { clock, usage, runs } = engine(on, plan, {
      answer: async () => {
        await held
        return ran(0)
      },
    })
    expect(await completeTurn($)).toEqual({ text: 'done' })
    await clock.settle()
    usage.rateLimits = [{ kind: 'five_hour', percentUsed: 25, resetsAt: '2026-10-14T16:00:00.000Z' }]
    expect(await completeTurn($)).toEqual({ text: 'done' })
    usage.rateLimits = [{ kind: 'five_hour', percentUsed: 26, resetsAt: '2026-10-14T16:00:00.000Z' }]
    expect(await completeTurn($)).toEqual({ text: 'done' })
    await clock.settle()
    expect(runs.length).toBe(1)

    release()
    await clock.settle()
    expect(runs.map(run => handed(run).rate_limits.five_hour.used_percentage)).toEqual([23.5, 26])
  })
})
