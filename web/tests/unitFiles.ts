import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { lockAvailable, lockHolder, spawnInherited } from './heavyLock.ts'
import { runUnits } from './unitRun.ts'

/**
 * `npm run test:unit:files -- <file> ...`: the Vitest files named, and no other. Vitest given no
 * file runs the whole suite, and so does `npm run test:unit` with none, so a list that came out
 * empty, such as the output of a search that matched nothing, would start the suite the caller
 * meant to narrow. This entry refuses that list before Vitest starts: no argument, or only blank
 * ones, is an empty list. The whole suite stays with `npm test` and `npm run test:unit`.
 *
 * A name is a path from `web/`, or else from the directory the command started in, and each must
 * be a file; Vitest is given its absolute path, so a name matches that file rather than every
 * path it is part of. One argument may hold several names, one a line, as a quoted search output
 * does. A word that begins with `-` goes to Vitest as an option, its value after `=`. What runs is
 * `npm run test:unit`'s targeted run: no lease at the heavy-process gate, and a failure names the
 * heavy runs going as it ends.
 *
 *   npm run test:unit:files -- tests/unitRun.test.ts tests/allowedRun.test.ts
 */

/** What `runUnits` asks, starts and says, and where the command was started. */
type FilesIo = Parameters<typeof runUnits>[1] & {
  /** The directory the command was started in, where a name not found under `web/` is looked for. */
  caller: string
}

const web = fileURLToPath(new URL('..', import.meta.url))

function refused(io: FilesIo, reason: string): number {
  io.write(`Refused, no test ran: ${reason}\n`)
  return 2
}

/** The file a name means, from `web/` or else from `caller`, or undefined. */
function fileNamed(name: string, caller: string): string | undefined {
  return [resolve(web, name), resolve(caller, name)].find(
    (path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true,
  )
}

/** Runs the files `args` name and resolves with Vitest's exit code; a refusal starts nothing and is 2. */
export async function runFiles(args: readonly string[], io: FilesIo): Promise<number> {
  const words = args
    .flatMap((argument) => argument.split(/\r?\n/))
    .map((word) => word.trim())
    .filter((word) => word !== '')
  const options = words.filter((word) => word.startsWith('-'))
  const names = words.filter((word) => !word.startsWith('-'))
  if (names.length === 0)
    return refused(
      io,
      'no test file was given. Name each file to run, as in ' +
        'npm run test:unit:files -- tests/unitRun.test.ts; ' +
        'the whole suite runs only through npm test or npm run test:unit',
    )
  const found = names.map((name) => ({ file: fileNamed(name, io.caller), name }))
  const files = found.flatMap(({ file }) => (file === undefined ? [] : [file]))
  const missing = found.filter(({ file }) => file === undefined).map(({ name }) => name)
  // The files come first, so `runUnits` reads the run as targeted whatever the options are.
  return missing.length > 0
    ? refused(
        io,
        `no such file: ${missing.join(', ')}; a name is a path from web/ or from the directory ` +
          'the command started in, and an option gives its value after "="',
      )
    : runUnits([...new Set(files), ...options], io)
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entry === import.meta.url) {
  process.exitCode = await runFiles(process.argv.slice(2), {
    caller: process.env.INIT_CWD ?? process.cwd(),
    canLock: lockAvailable,
    holder: () => lockHolder(),
    spawn: (command) => spawnInherited(command, { cwd: web, env: process.env }),
    write: (text) => process.stdout.write(text),
  })
}
