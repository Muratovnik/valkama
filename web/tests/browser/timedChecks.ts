/**
 * A browser test that bounds a time carries `timedTag`, and runs in the project `timedProject`
 * alone: after every other project of the run has ended, failed or not, in one worker.
 *
 * A run's other workers are the heaviest work beside a test: Playwright runs half the logical
 * cores by default. Work of the same priority beside it has stretched the processor time the
 * page's main thread spent on one screen up to 1.7 times what it spent alone, since a core's
 * other half and the clock of every core are shared. `playwright.config.ts` makes the timed project the teardown of every
 * other one, which Playwright runs after them whatever they ended in, and gives it one worker.
 * The suite's `test` (`test.ts`) fails a tagged test that any other project runs.
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
