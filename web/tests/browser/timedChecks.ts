import { readFileSync } from 'node:fs'

/**
 * A browser test that bounds a time carries `timedTag`, and runs in the project `timedProject`
 * alone: after every other project of the run has ended, failed or not, in one worker.
 *
 * A run's other workers are the heaviest work beside a test: Playwright runs half the logical
 * cores by default. Work of the same priority beside it has stretched the processor time the
 * page's main thread spent on one screen up to 1.7 times what it spent alone, since a core's
 * other half and the clock of every core are shared. `playwright.config.ts` makes the timed
 * project the teardown of every other one, which Playwright runs after them whatever they ended
 * in, and gives it one worker. The suite's `test` (`test.ts`) fails a tagged test that any other
 * project runs.
 *
 * Playwright runs a teardown project whole: neither a spec named on its command line nor `--grep`
 * reaches it. So a run of the allowed set names its list to the configuration (`timedList`), and
 * the timed project takes the listed specs alone; a bare Playwright run takes every timed test.
 */

/**
 * The tag, as a test names it: `test('…', { tag: '@timed' }, async …)`, written out, since the
 * linter's Playwright rules read a tag only as a literal.
 */
export const timedTag = '@timed'

/** The project a timed test runs in, and nowhere else. */
export const timedProject = 'timed'

/**
 * A test's title with its tags, as Playwright matches `grep` against it, when one of the tags is
 * `timedTag`: the project's name, the file's, the describe's and the test's, then the tags,
 * each divided by a space.
 */
export const timedTitle = new RegExp(`(?:^|\\s)${timedTag}(?=\\s|$)`)

/** The variable naming the file of specs a run of the allowed set runs, one a line. */
export const timedList = 'VALKAMA_BROWSER_LIST'

/**
 * The specs the timed project takes: those of `specs`, a project's pattern, that the list
 * `timedList` names, or every one of them without a list. One RegExp ending as the suite's
 * patterns do, `\.spec\.ts$`, which the probe configuration relies on.
 */
export function timedSpecs(
  specs: RegExp,
  env: Readonly<Record<string, string | undefined>>,
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): RegExp {
  const list = env[timedList]
  if (!list) return specs
  const names = read(list)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => specs.test(name))
    .map((name) => literal(name.slice(0, -'.spec.ts'.length)))
  // A list with none of them matches no file.
  const any = names.length > 0 ? names.join('|') : '(?!)'
  return new RegExp(`(?:^|[\\\\/])(?:${any})\\.spec\\.ts$`)
}

/** Text as a RegExp that matches it and nothing else. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
