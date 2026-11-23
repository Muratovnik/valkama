import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, join, relative } from 'node:path'

import type { Locator, Page, TestInfo } from '@playwright/test'
import { test } from '@playwright/test'

/**
 * What a browser run's tests wrote and attached, kept past the run.
 *
 * Playwright empties a run's results when the next run starts, and an attachment given as
 * a body never reaches the disk at all: it lives in the reporters, and the suite's report
 * only the lines. So the suite's `test` copies, as each test ends, every file the test wrote
 * into its output directory and every attachment it gave as a body into one directory per
 * run, `test-results/<port>/shots/<run>/`, beside the results Playwright empties. Each
 * file there is named by its spec and then by the name the test gave it, so two specs'
 * shots of the same screen never share a name, however they are copied on. The ten newest
 * runs of a port keep theirs; a run removes older ones as it starts.
 */

/** The variable naming this run's directory of kept files, set once by the global setup. */
export const shotRunVariable = 'VALKAMA_SHOT_RUN'

/** How many runs of one port keep their files. */
export const keptRuns = 10

const RUN_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/u

/** A run's directory name: when it started, in UTC, sortable as text. */
export function runName(at: Date): string {
  return at.toISOString().replaceAll(':', '-')
}

/** The runs to remove so that `keep` remain, the oldest first; other names are not runs. */
export function staleRuns(names: readonly string[], keep: number): string[] {
  const runs = names.filter((name) => RUN_NAME.test(name)).toSorted()
  return runs.slice(0, Math.max(0, runs.length - keep))
}

/** The spec a file is: `tests/browser/production-list.spec.ts` is `production-list`. */
function specName(file: string): string {
  return basename(file).replace(/\.spec\.[cm]?[jt]s$/u, '')
}

/**
 * The name a kept file goes by: its spec's, then the one its test gave it, folders and all.
 * An attachment's name is free text. On Windows a `:` in it writes the body into a hidden
 * stream of another file and `?`, `*` and the rest fail the test, so each character a
 * Windows file name may not hold becomes `_`.
 */
export function keptName(specFile: string, name: string): string {
  const kept = name.replaceAll(/[/\\]/gu, '__').replaceAll(/[\u{0}-\u{1F}"*:<>?|]/gu, '_')
  return `${specName(specFile)}__${kept}`
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/json': '.json',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'text/plain': '.txt',
}

/** An attachment's file name: its own where it has an extension, else the one its type gives. */
export function attachmentFile(name: string, contentType: string): string {
  return extname(name) ? name : `${name}${EXTENSIONS[contentType] ?? '.bin'}`
}

const PLAYWRIGHT_FILE =
  /^(?:trace\.zip|error-context\.md|test-(?:failed|finished)-\d+\.(?:png|jpeg)|video(?:-\d+)?\.webm)$/u

/**
 * Whether a path in a test's output directory is one Playwright writes there itself: the
 * trace, the shot of a failure, the video, the error's context, and its copies of the
 * attachments given as a path. The run's results hold those for the run that failed.
 */
export function isPlaywrightArtifact(path: string): boolean {
  const [top = ''] = path.split(/[/\\]/u)
  return top === 'attachments' || PLAYWRIGHT_FILE.test(top)
}

/** Writes a new file named `name` in `directory`, or `name~2`, `~3`… when that one is taken. */
function writeNew(directory: string, name: string, write: (target: string) => void): void {
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  for (let copy = 1; ; copy += 1) {
    const target = join(directory, copy === 1 ? name : `${stem}~${copy}${extension}`)
    try {
      write(target)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

/** Every file under `root`, relative to it; a link is neither followed nor listed. */
function filesUnder(root: string, at = root): string[] {
  if (!existsSync(at)) return []
  const files: string[] = []
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) files.push(...filesUnder(root, path))
    else if (entry.isFile()) files.push(relative(root, path))
  }
  return files
}

/** What a test leaves to keep: its spec, its output directory and its attachments. */
type TestOutput = Pick<TestInfo, 'attachments' | 'file' | 'outputDir'>

/** Copies what one test wrote and attached into the run's directory; returns how many files. */
export function keepTestOutput(output: TestOutput, directory: string): number {
  const written = filesUnder(output.outputDir).filter((path) => !isPlaywrightArtifact(path))
  const attached = output.attachments.filter((attachment) => attachment.body !== undefined)
  if (written.length === 0 && attached.length === 0) return 0
  mkdirSync(directory, { recursive: true })
  for (const path of written)
    writeNew(directory, keptName(output.file, path), (target) =>
      copyFileSync(join(output.outputDir, path), target, constants.COPYFILE_EXCL),
    )
  for (const { body, contentType, name } of attached)
    writeNew(directory, keptName(output.file, attachmentFile(name, contentType)), (target) =>
      writeFileSync(target, body as Buffer, { flag: 'wx' }),
    )
  return written.length + attached.length
}

/** Removes the runs of `root` past the newest `keep`; only directories a run made, never a link. */
export function removeStaleRuns(root: string, keep: number): void {
  if (!existsSync(root)) return
  for (const name of staleRuns(readdirSync(root), keep)) {
    const path = join(root, name)
    const entry = lstatSync(path)
    if (entry.isDirectory() && !entry.isSymbolicLink()) rmSync(path, { recursive: true })
  }
}

/** How many files a run kept. */
export const keptCount = (directory: string) => filesUnder(directory).length

/** Whether a person asked for shots by naming a folder in VALKAMA_SHOT_DIR. */
export const shotsRequested = () => Boolean(process.env.VALKAMA_SHOT_DIR)

/**
 * A shot a person asked for, written to the folder VALKAMA_SHOT_DIR names under its spec's
 * name, so the shots of every spec can share one folder; a run without the setting takes none.
 */
export async function requestedShot(target: Locator | Page, name: string): Promise<void> {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder)
    await target.screenshot({ path: join(folder, keptName(test.info().file, `${name}.png`)) })
}
