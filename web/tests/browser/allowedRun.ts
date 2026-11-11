import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { harnessPort } from './browserRun.ts'
import { clipboardOptIn, clipboardSpecs } from './clipboardSpecs.ts'

/**
 * `npm run test:browser:allowed`: every browser spec but the ones that write the system
 * clipboard, in one Playwright run.
 *
 * Playwright given no spec runs the whole suite but the clipboard specs, which the
 * configuration selects only under `clipboardOptIn`; and a list of two hundred names does not
 * fit a Windows command line. So the list never goes on one: it is written to a file
 * Playwright reads with `--test-list`, and the runner refuses, before Playwright starts, a
 * list that is empty, a list file that is missing, a name that is no spec, and a clipboard
 * spec that `--with-clipboard=<file>` does not name. Playwright runs with `clipboardOptIn`
 * set when `--with-clipboard` names a spec, and without it otherwise.
 *
 *   npm run test:browser:allowed -- --list                 what would run, and the total
 *   npm run test:browser:allowed -- --specs=<file>         the specs a file names, one a line
 *   npm run test:browser:allowed -- --workers=4            any other Playwright option
 */

/** A request the runner will not start Playwright for; its message says why. */
export class Refusal extends Error {}

/** What the command line asks for. */
interface Request {
  /** Options passed on to Playwright as they are. */
  playwright: string[]
  /** Clipboard specs named to run all the same. */
  withClipboard: string[]
  /** A file naming the specs to run, one a line; without it, the whole allowed set. */
  listFile?: string
}

/** What the runner reads, writes and starts, so a test can stand in for each. */
export interface RunnerIo {
  /**
   * Runs Playwright with these arguments and resolves with its exit code; `clipboard` says
   * whether its configuration may select the clipboard specs.
   */
  playwright: (args: readonly string[], clipboard: boolean) => Promise<number>
  /** A list file's text, or null when there is no such file. */
  readList: (file: string) => string | null
  say: (line: string) => void
  /** Every spec of the suite, by file name. */
  suiteSpecs: () => string[]
  /** Writes the list Playwright reads and returns its path. */
  writeList: (specs: readonly string[]) => string
}

/** The flags of the runner's own; the value follows `=` or comes as the next argument. */
const ownFlags = { '--specs': 'listFile', '--with-clipboard': 'withClipboard' } as const

function parseArguments(argv: readonly string[]): Request {
  const request: Request = { playwright: [], withClipboard: [] }
  const rest = [...argv]
  for (let argument = rest.shift(); argument !== undefined; argument = rest.shift()) {
    const [flag = '', inline] = argument.split(/=(.*)/s)
    if (flag in ownFlags) {
      const value = inline ?? rest.shift()
      if (!value) throw new Refusal(`${flag} needs a value`)
      if (flag === '--specs') request.listFile = value
      else request.withClipboard.push(value)
    } else if (argument.startsWith('-')) {
      request.playwright.push(argument)
    } else {
      throw new Refusal(
        `"${argument}" is not an option: name specs in a file with --specs=<file>, ` +
          'and give a Playwright option its value after "=" (--workers=4)',
      )
    }
  }
  return request
}

/** The names a list file holds: one a line, blank lines and `#` comments left out. */
function listedNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function selectSpecs(request: Request, io: RunnerIo): string[] {
  const suite = io.suiteSpecs()
  for (const name of request.withClipboard)
    if (!clipboardSpecs.includes(name))
      throw new Refusal(`--with-clipboard=${name} names no clipboard spec`)
  const allowed = (name: string) =>
    !clipboardSpecs.includes(name) || request.withClipboard.includes(name)
  if (request.listFile === undefined) return suite.filter((name) => allowed(name))
  const text = io.readList(request.listFile)
  if (text === null) throw new Refusal(`the list file ${request.listFile} does not exist`)
  const names = [...new Set(listedNames(text))]
  if (names.length === 0) throw new Refusal(`the list file ${request.listFile} names no spec`)
  const unknown = names.filter((name) => !suite.includes(name))
  if (unknown.length > 0)
    throw new Refusal(`no such spec under tests/browser: ${unknown.join(', ')}`)
  const clipboard = names.filter((name) => !allowed(name))
  if (clipboard.length > 0)
    throw new Refusal(
      `${clipboard.join(', ')} write the clipboard; name each with --with-clipboard=<file>`,
    )
  return names
}

/** Runs the request and resolves with the exit code; a refusal starts nothing and is 2. */
export async function runAllowed(argv: readonly string[], io: RunnerIo): Promise<number> {
  let request: Request
  let specs: string[]
  try {
    request = parseArguments(argv)
    specs = selectSpecs(request, io)
    if (specs.length === 0) throw new Refusal('the list of specs to run is empty')
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    io.say(`Refused, no test ran: ${error.message}`)
    return 2
  }
  const left = clipboardSpecs.filter((name) => !specs.includes(name))
  io.say(`${specs.length} spec files; clipboard specs left out: ${left.join(', ') || 'none'}`)
  const summary = fileURLToPath(new URL('runSummary.ts', import.meta.url))
  return io.playwright(
    [
      'test',
      `--test-list=${io.writeList(specs)}`,
      `--reporter=line,${summary}`,
      ...request.playwright,
    ],
    request.withClipboard.length > 0,
  )
}

/**
 * The environment Playwright runs in: this one, with `clipboardOptIn` set to `1` when the run
 * may select a clipboard spec and removed when it may not, whatever the caller's shell held.
 */
export function playwrightEnvironment(
  base: NodeJS.ProcessEnv,
  clipboard: boolean,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, [clipboardOptIn]: '1' }
  if (!clipboard) delete env[clipboardOptIn]
  return env
}

const web = fileURLToPath(new URL('../..', import.meta.url))
const suiteDirectory = join(web, 'tests/browser')

/** The real file system and Playwright, run from `web/` with this process's Node. */
export const realIo: RunnerIo = {
  playwright: (args, clipboard) =>
    new Promise((resolve, reject) => {
      const cli = join(web, 'node_modules/@playwright/test/cli.js')
      const child = spawn(process.execPath, [cli, ...args], {
        cwd: web,
        env: playwrightEnvironment(process.env, clipboard),
        stdio: 'inherit',
      })
      child.on('error', reject)
      // A code is null only when a signal ended the process, which is a failed run.
      child.on('exit', (code, signal) => resolve(signal ? 1 : Number(code)))
    }),
  readList: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
  say: (line) => process.stdout.write(`${line}\n`),
  suiteSpecs: () => readdirSync(suiteDirectory).filter((name) => name.endsWith('.spec.ts')),
  writeList: (specs) => {
    // Beside this port's results rather than in them: Playwright empties those when it starts.
    const directory = join(web, `test-results/${harnessPort}`)
    mkdirSync(directory, { recursive: true })
    const file = join(directory, 'allowed-specs.txt')
    writeFileSync(file, `${specs.join('\n')}\n`)
    return file
  },
}

if (import.meta.main) process.exitCode = await runAllowed(process.argv.slice(2), realIo)
