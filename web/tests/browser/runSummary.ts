import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter'

/** How a test ended, in the words a summary line uses. */
const outcomeWords = {
  expected: 'passed',
  flaky: 'flaky',
  skipped: 'skipped',
  unexpected: 'failed',
} as const

/**
 * The last lines of a run of the allowed set: every project the configuration declares, with
 * how many tests it selected and how they ended, and the total. A project at 0, or a total
 * below the suite's, is a run that selected less than it was meant to, said where it shows.
 * A listing (`--list`) prints the same lines with no outcomes.
 */
export default class RunSummary implements Reporter {
  private projects: string[] = []
  private tests: TestCase[] = []
  private ran = false

  onBegin(config: FullConfig, suite: Suite): void {
    this.projects = config.projects.map((project) => project.name)
    this.tests = suite.allTests()
  }

  onTestEnd(): void {
    this.ran = true
  }

  onEnd(): void {
    const lines = ['', 'Projects:']
    for (const project of this.projects) {
      const tests = this.tests.filter((test) => test.parent.project()?.name === project)
      lines.push(`  ${project}: ${selection(tests)}${this.ended(tests)}`)
    }
    lines.push(`Total: ${selection(this.tests)}`)
    process.stdout.write(`${lines.join('\n')}\n`)
  }

  printsToStdio(): boolean {
    return true
  }

  /** How the tests ended, once any has run. */
  private ended(tests: readonly TestCase[]): string {
    if (!this.ran) return ''
    const counts = new Map<string, number>()
    for (const test of tests) {
      const word = outcomeWords[test.outcome()]
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
    if (counts.size === 0) return ''
    const parts = [...counts].map(([word, count]) => [count, word].join(' '))
    return ` — ${parts.join(', ')}`
  }
}

/** `12 tests in 3 files`, as Playwright's listing says it. */
function selection(tests: readonly TestCase[]): string {
  const files = new Set(tests.map((test) => test.location.file)).size
  return `${tests.length} ${tests.length === 1 ? 'test' : 'tests'} in ${files} ${files === 1 ? 'file' : 'files'}`
}
