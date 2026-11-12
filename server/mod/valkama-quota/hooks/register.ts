import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// Hands each session's plan-limit reading to Valkama after a model response: the quota source
// `mod`. The engine reads the limits off every response. The status line carries the same
// windows, but only a terminal session runs a status line; this runs wherever the session does,
// the VS Code extension included.
//
// The reading goes to Valkama's receiver, `valkama statusline --source=mod`, as the JSON fields
// the status line sends, so one parser, one write path and one spool serve both sources. The
// receiver is started the way Valkama's hook commands are registered: the interpreter the managed
// launcher's manifest records, running the launcher's shim with `-I -S`. Valkama missing, slow or
// failing costs the reading, never the session a turn: the hand-over runs after the hook has
// answered, one at a time, each bounded by RECEIVER_TIMEOUT_MS.

/** The managed launcher's manifest and shim, as `valkama launcher install` writes them. */
export const MANIFEST = 'valkama-launcher.json'
export const SHIM = 'valkama-launcher.py'
/** What the receiver is asked to do. */
export const RECEIVER = ['statusline', '--source=mod'] as const
/** How long one hand-over may run before the engine stops it. The receiver never waits for a
 * busy store (it spools instead), so this bounds only an interpreter that hangs. */
export const RECEIVER_TIMEOUT_MS = 10_000

type StatusLineWindow = { used_percentage: number; resets_at?: number }

/** The status line's fields for one reading: `session_id`, and `rate_limits` by window, each a
 * share used and a reset in Unix seconds when the engine knows it. */
export const statusLineInput = (sessionId: string, rateLimits: readonly SessionRateLimit[]): string => {
  const windows: Record<string, StatusLineWindow> = {}
  for (const limit of rateLimits) {
    const resets = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)
    windows[limit.kind] = Number.isFinite(resets)
      ? { used_percentage: limit.percentUsed, resets_at: resets / 1000 }
      : { used_percentage: limit.percentUsed }
  }
  return JSON.stringify({ session_id: sessionId, rate_limits: windows })
}

// Where `valkama launcher install` puts the stable command by default (`launcher.default_directory`):
// %LOCALAPPDATA%\Valkama\bin on Windows, else $XDG_BIN_HOME or ~/.local/bin.
const launcherDirectory = async ($: EngineInterface): Promise<{ folder: string; separator: string } | null> => {
  const local = await $.env.get('LOCALAPPDATA')
  if (local !== undefined && local !== '') return { folder: `${local}\\Valkama\\bin`, separator: '\\' }
  const home = await $.env.get('HOME')
  const bin = await $.env.get('XDG_BIN_HOME')
  if (bin !== undefined && bin !== '') {
    if (bin === '~' || bin.startsWith('~/')) return home ? { folder: home + bin.slice(1), separator: '/' } : null
    return { folder: bin, separator: '/' }
  }
  return home ? { folder: `${home}/.local/bin`, separator: '/' } : null
}

/** The receiver's command line, or null when no managed launcher is installed. */
export const receiver = async ($: EngineInterface): Promise<string[] | null> => {
  const directory = await launcherDirectory($)
  if (directory === null) return null
  const { folder, separator } = directory
  let manifest: unknown
  try {
    manifest = JSON.parse(String(await $.fs.read(`${folder}${separator}${MANIFEST}`)))
  } catch {
    return null
  }
  const python = typeof manifest === 'object' && manifest !== null ? (manifest as { python?: unknown }).python : undefined
  if (typeof python !== 'string' || python === '') return null
  return [python, '-I', '-S', `${folder}${separator}${SHIM}`, ...RECEIVER]
}

/** One hand-over; true when the receiver ran to its end. It never throws. */
const handOver = async ($: EngineInterface, input: string): Promise<boolean> => {
  try {
    const argv = await receiver($)
    if (argv === null) return false
    const { exitCode } = await $.process.run(argv, { stdin: input, timeoutMs: RECEIVER_TIMEOUT_MS })
    return exitCode === 0
  } catch {
    // Valkama could not start, or ran past its time: the next reading tries again.
    return false
  }
}

// The latest reading of each session not yet handed over, and the last one the receiver took: a
// reading is handed over once, and while one hand-over runs the next waits, so a slow Valkama holds
// one process, never one per response. One per registration, so a reload starts it afresh.
type Queue = { waiting: Map<string, string>; delivered: string | null; running: boolean }

async function drain($: EngineInterface, queue: Queue): Promise<void> {
  queue.running = true
  try {
    for (let entry = queue.waiting.entries().next(); !entry.done; entry = queue.waiting.entries().next()) {
      const [session, input] = entry.value
      queue.waiting.delete(session)
      if (input !== queue.delivered && (await handOver($, input))) queue.delivered = input
    }
  } finally {
    queue.running = false
  }
}

async function publish($: EngineInterface, queue: Queue, rateLimits: readonly SessionRateLimit[]): Promise<void> {
  try {
    if (rateLimits.length === 0) return
    const session = await $.session.id()
    queue.waiting.delete(session)
    queue.waiting.set(session, statusLineInput(session, rateLimits))
    // Not awaited: the hook answers now, and the receiver runs after it.
    if (!queue.running) void drain($, queue)
  } catch {
    // A reading that cannot be read costs the reading, never the session a turn.
  }
}

async function reread($: EngineInterface, queue: Queue): Promise<void> {
  try {
    await publish($, queue, (await $.session.usage()).rateLimits)
  } catch {
    // As above.
  }
}

export const register: Register = on => {
  const queue: Queue = { waiting: new Map(), delivered: null, running: false }

  // A resumed session already has a reading.
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await reread($, queue)
    return started
  })

  // Raised during a turn when a window moves a whole point.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('rateLimits')) await publish($, queue, e.rateLimits)
    return measured
  })

  // Every turn ends with a response, so its reading is the freshest there is, tenths included.
  // After /clear, /resume and /branch the session goes on under a new id, and the next finished
  // turn hands the reading over under it.
  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    await reread($, queue)
    return completed
  })
}
