/**
 * The production build for the browser suite. Playwright drops a web server's
 * standard output, and `vue-tsc` writes its errors there, so a type error in a test
 * reached the reader as "Process from config.webServer was not able to start". A
 * good build stays quiet; a failed one says why, on the stream Playwright keeps.
 */
import { spawnSync } from 'node:child_process'

const build = spawnSync('npm run build', { encoding: 'utf8', shell: true })
if (build.status !== 0) {
  process.stderr.write(`${build.stdout}${build.stderr}`)
  process.exit(build.status ?? 1)
}
