import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PlaywrightTestConfig } from '@playwright/test'

import { lockedCommand, spawnInherited } from '../heavyLock.ts'
import { harnessPort } from './browserRun.ts'
import { clipboardOptIn, clipboardSpecs } from './clipboardSpecs.ts'
import { timedList } from './timedChecks.ts'

/**
 * `npm run test:browser:allowed`: every browser spec but the ones that write the system
 * clipboard, in one Playwright run.
 *
 * Playwright given no spec runs the whole suite but the clipboard specs, which the
 * configuration selects only under `clipboardOptIn`; and a list of two hundred names does not
 * fit a Windows command line. So the list never goes on one: it is written to a file
 * Playwright reads with `--test-list`, and the runner refuses, before Playwright starts, a
 * list that is empty, a list file that is missing, a name that is no spec, a clipboard
 * spec that `--with-clipboard=<spec name>` does not name, and a listed spec no project of
 * `playwright.config.ts` runs, which Playwright would leave out without a word: a list runs
 * whole or not at all. Playwright runs with `clipboardOptIn` set when `--with-clipboard` names
 * a spec, and without it otherwise.
 *
 * The same run ends with the tests that bound a time (`timedChecks.ts`), the listed specs' and
 * no others, after every other test has ended and one at a time, in the project `timed`; the
 * run fails when a test of either part does, and the timed ones run whatever the rest ended in.
 * Playwright runs that project whole, so `--grep` and its other filters of tests do not reach it.
 *
 * A run holds a lease at the machine's heavy-process gate, through `tests/heavy_gate.py`, for as
 * long as Playwright runs, on the 16 workers its configuration gives. The gate counts it by what
 * earlier runs of as many specs used, not as the whole machine; with no room it exits 75 at once
 * in an agent's session, saying why, and waits elsewhere or with `HEAVY_GATE_WAIT=1`. A run
 * under `--list` runs no test, and takes no lease. The command line is read whole, and refused,
 * before the lease is asked for, so a refusal never comes after a wait for room.
 *
 * Input that means one thing is taken in each of its forms: a list file names a spec by its file
 * name, by that name without `.spec.ts` or by its path, and so does `--with-clipboard`, which also
 * takes `all`; an option of the runner's or of Playwright's that needs a value takes it after `=`
 * or as the next word (`--grep "a|b"`). A word that is no option and no option's value is refused.
 *
 *   npm run test:browser:allowed -- --list                 what would run, and the total
 *   npm run test:browser:allowed -- --specs=<file>         the specs a file names, one a line
 *   npm run test:browser:allowed -- --with-clipboard=all   the clipboard specs as well
 *   npm run test:browser:allowed -- --workers 4            any other Playwright option
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

/** A project of the Playwright configuration: the spec files it runs, by their absolute paths. */
export interface ProjectRule {
  name: string
  /** and none of these. */
  testIgnore: readonly RegExp[]
  /** A spec runs in the project when its path matches one of these, */
  testMatch: readonly RegExp[]
}

/** What the runner reads, writes and starts, so a test can stand in for each. */
export interface RunnerIo {
  /**
   * Runs Playwright with these arguments and resolves with its exit code; `clipboard` says
   * whether its configuration may select the clipboard specs, `lease` gives the size of the
   * selection Playwright runs under a lease of, or is null for no lease, and `list` is the list
   * file it runs, which its configuration reads for the timed project (`timedList`).
   */
  playwright: (
    args: readonly string[],
    clipboard: boolean,
    lease: { size: number } | null,
    list: string,
  ) => Promise<number>
  /** The projects of the configuration Playwright will load, the clipboard specs let in. */
  projects: () => Promise<readonly ProjectRule[]>
  /** A list file's text, or null when there is no such file. */
  readList: (file: string) => string | null
  say: (line: string) => void
  /** Every spec of the suite, by file name. */
  suiteSpecs: () => string[]
  /** Writes the list Playwright reads and returns its path. */
  writeList: (specs: readonly string[]) => string
}

/** What `--with-clipboard` takes to name every clipboard spec. */
const everyClipboardSpec = 'all'

/**
 * The options of `playwright test` that take a value, by every spelling, each mapped to its long
 * form. Its value may come as the next argument as well as after `=`; it goes on to Playwright
 * after `=` either way, since a short flag takes `=` as part of its value. An option whose value
 * is optional (`--update-snapshots`, `--only-changed`, `--shuffle`, `--debug`) is not here: a
 * word after it may be the next thing asked for, so that one takes its value after `=` alone.
 */
const playwrightValueFlags = new Map(
  [
    ['--add-reporter'],
    ['--browser'],
    ['--config', '-c'],
    ['--global-timeout'],
    ['--grep', '-g'],
    ['--grep-invert', '-G'],
    ['--last-failed-file'],
    ['--max-failures'],
    ['--output'],
    ['--project'],
    ['--repeat-each'],
    ['--reporter'],
    ['--retries'],
    ['--run-agents'],
    ['--shard'],
    ['--test-list'],
    ['--test-list-invert'],
    ['--timeout'],
    ['--trace'],
    ['--tsconfig'],
    ['--ui-host'],
    ['--ui-port'],
    ['--update-source-method'],
    ['--workers', '-j'],
  ].flatMap(([long = '', short]) => [
    [long, long],
    ...(short === undefined ? [] : [[short, long] as const]),
  ]),
)

/**
 * The flags of the runner's own, each with what it takes; the value follows `=` or comes as the
 * next argument.
 */
const ownValues: Record<string, string> = {
  '--specs': 'a list file',
  '--with-clipboard': `a clipboard spec's name, or ${everyClipboardSpec}`,
}

/** The next argument as a flag's value; one that is itself an option is not taken for one. */
function nextValue(flag: string, rest: string[]): string {
  const value = rest[0]
  if (value === undefined || value === '' || value.startsWith('-')) throw needsValue(flag)
  rest.shift()
  return value
}

function needsValue(flag: string): Refusal {
  const what = Object.hasOwn(ownValues, flag) ? ownValues[flag] : 'a value'
  return new Refusal(
    `${flag} needs ${what}: give it as the next word or after "=" (${flag}=<value>), ` +
      'which is also how to give one that begins with "-"',
  )
}

function parseArguments(argv: readonly string[]): Request {
  const request: Request = { playwright: [], withClipboard: [] }
  const rest = [...argv]
  for (let argument = rest.shift(); argument !== undefined; argument = rest.shift()) {
    const [flag = '', inline] = argument.split(/=(.*)/s)
    const long = playwrightValueFlags.get(flag)
    if (Object.hasOwn(ownValues, flag)) {
      const value = inline ?? nextValue(flag, rest)
      if (!value) throw needsValue(flag)
      if (flag === '--specs') request.listFile = value
      else request.withClipboard.push(value)
    } else if (long !== undefined) {
      request.playwright.push(`${long}=${inline ?? nextValue(flag, rest)}`)
    } else if (argument.startsWith('-')) {
      request.playwright.push(argument)
    } else {
      throw new Refusal(
        `"${argument}" is not an option: name specs in a file with --specs=<file>, ` +
          'and give an option the runner does not know its value after "="',
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

/**
 * The spec of `specs` a name means, or undefined. A spec is named by its file name, by that name
 * without `.spec.ts`, or by a path that ends in `tests/browser/` and one of those, with either
 * slash. Each form names one file of the flat suite directory or none, so no name means two.
 */
function specNamed(name: string, specs: readonly string[]): string | undefined {
  const path = name.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '')
  const base = path.includes('/') ? /(?:^|\/)tests\/browser\/([^/]+)$/.exec(path)?.[1] : path
  return base === undefined
    ? undefined
    : [base, `${base}.spec.ts`].find((candidate) => specs.includes(candidate))
}

/** The clipboard specs `--with-clipboard` names; `all` names every one. */
function namedClipboardSpecs(values: readonly string[]): string[] {
  const named = values.flatMap((value) => {
    if (value === everyClipboardSpec) return clipboardSpecs
    const spec = specNamed(value, clipboardSpecs)
    if (spec === undefined)
      throw new Refusal(
        `--with-clipboard=${value} names no clipboard spec; name one of ` +
          `${clipboardSpecs.join(', ')}, or all of them with --with-clipboard=${everyClipboardSpec}`,
      )
    return [spec]
  })
  return [...new Set(named)]
}

function selectSpecs(request: Request, io: RunnerIo): string[] {
  const suite = io.suiteSpecs()
  request.withClipboard = namedClipboardSpecs(request.withClipboard)
  const allowed = (name: string) =>
    !clipboardSpecs.includes(name) || request.withClipboard.includes(name)
  if (request.listFile === undefined) return suite.filter((name) => allowed(name))
  const text = io.readList(request.listFile)
  if (text === null) throw new Refusal(`the list file ${request.listFile} does not exist`)
  const listed = [...new Set(listedNames(text))]
  if (listed.length === 0) throw new Refusal(`the list file ${request.listFile} names no spec`)
  const unknown = listed.filter((name) => specNamed(name, suite) === undefined)
  if (unknown.length > 0) {
    const example = suite.find((name) => allowed(name)) ?? suite[0]
    const such = example === undefined ? '' : `, such as ${example}`
    throw new Refusal(
      `no such spec under tests/browser: ${unknown.join(', ')}; a list file names a spec ` +
        'one a line, by its file name, that name without .spec.ts, or a path ending in ' +
        `tests/browser/ and either${such}`,
    )
  }
  const names = [...new Set(listed.map((name) => specNamed(name, suite) ?? name))]
  const clipboard = names.filter((name) => !allowed(name))
  if (clipboard.length > 0)
    throw new Refusal(
      `${clipboard.join(', ')} write the clipboard; name each with --with-clipboard=<spec name>, ` +
        `or all of them with --with-clipboard=${everyClipboardSpec}`,
    )
  return names
}

const web = fileURLToPath(new URL('../..', import.meta.url))
/** The gate's kind for a run of the suite or a batch of it, as `.heavy-gate.toml` declares it. */
const suiteKind = 'browser-suite'
const suiteDirectory = join(web, 'tests/browser')

/** Refuses the listed specs no project runs, with the rule of each project. */
function refuseUnrun(names: readonly string[], projects: readonly ProjectRule[]): void {
  // Playwright matches a project's patterns against the spec's absolute path.
  const runs = (project: ProjectRule, path: string) =>
    project.testMatch.some((pattern) => pattern.test(path)) &&
    !project.testIgnore.some((pattern) => pattern.test(path))
  const unrun = names.filter((name) => {
    const path = join(suiteDirectory, name)
    return !projects.some((project) => runs(project, path))
  })
  if (unrun.length === 0) return
  const rules = projects.map((project) => {
    const leftOut =
      project.testIgnore.length > 0 ? ` but not ${project.testIgnore.join(' or ')}` : ''
    return `${project.name} runs a path matching ${project.testMatch.join(' or ')}${leftOut}`
  })
  throw new Refusal(
    `no project of playwright.config.ts runs ${unrun.join(', ')}: ${rules.join('; ')}`,
  )
}

/** Runs the request and resolves with the exit code; a refusal starts nothing and is 2. */
export async function runAllowed(argv: readonly string[], io: RunnerIo): Promise<number> {
  let request: Request
  let specs: string[]
  try {
    request = parseArguments(argv)
    specs = selectSpecs(request, io)
    if (specs.length === 0) throw new Refusal('the list of specs to run is empty')
    if (request.listFile !== undefined) refuseUnrun(specs, await io.projects())
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    io.say(`Refused, no test ran: ${error.message}`)
    return 2
  }
  const left = clipboardSpecs.filter((name) => !specs.includes(name))
  io.say(`${specs.length} spec files; clipboard specs left out: ${left.join(', ') || 'none'}`)
  const summary = fileURLToPath(new URL('runSummary.ts', import.meta.url))
  const lease = request.playwright.includes('--list') ? null : { size: specs.length }
  const list = io.writeList(specs)
  return io.playwright(
    ['test', `--test-list=${list}`, `--reporter=line,${summary}`, ...request.playwright],
    request.withClipboard.length > 0,
    lease,
    list,
  )
}

/**
 * The environment Playwright runs in: this one, with `clipboardOptIn` set to `1` when the run
 * may select a clipboard spec and removed when it may not, whatever the caller's shell held, and
 * `timedList` naming the list file the run runs.
 */
export function playwrightEnvironment(
  base: NodeJS.ProcessEnv,
  clipboard: boolean,
  list: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, [clipboardOptIn]: '1', [timedList]: list }
  if (!clipboard) delete env[clipboardOptIn]
  return env
}

type Pattern = PlaywrightTestConfig['testMatch']

/** A configuration's patterns as RegExps; a glob the runner cannot check against is refused. */
function patterns(project: string, pattern: Pattern): RegExp[] {
  return [pattern ?? []].flat().map((one) => {
    if (one instanceof RegExp) return one
    throw new Refusal(
      `project ${project} selects specs by ${String(one)}, and the runner checks a list ` +
        'only against RegExps',
    )
  })
}

/**
 * The projects of `playwright.config.ts`, loaded in this process's environment as Playwright
 * will load it, but with the clipboard specs let in: the runner refuses those itself, by
 * `--with-clipboard`, and sets the variable for Playwright only when one is named.
 */
async function configProjects(): Promise<ProjectRule[]> {
  const shell = process.env[clipboardOptIn]
  process.env[clipboardOptIn] = '1'
  let loaded: { default: PlaywrightTestConfig }
  try {
    loaded = await import('../../playwright.config.ts')
  } finally {
    if (shell === undefined) delete process.env[clipboardOptIn]
    else process.env[clipboardOptIn] = shell
  }
  const config = loaded.default
  return (config.projects ?? [config]).map((project, index) => {
    const name = project.name ?? `#${index + 1}`
    return {
      name,
      testMatch: patterns(
        name,
        project.testMatch ?? config.testMatch ?? "Playwright's default glob",
      ),
      testIgnore: patterns(name, project.testIgnore ?? config.testIgnore),
    }
  })
}

/** The real file system and Playwright, run from `web/` with this process's Node. */
export const realIo: RunnerIo = {
  playwright: (args, clipboard, lease, list) => {
    const command = [process.execPath, join(web, 'node_modules/@playwright/test/cli.js'), ...args]
    const run = lease === null ? command : lockedCommand(suiteKind, command, { size: lease.size })
    return spawnInherited(run, {
      cwd: web,
      env: playwrightEnvironment(process.env, clipboard, list),
    })
  },
  projects: configProjects,
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
