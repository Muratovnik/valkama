/**
 * `npm run test:unit:files`: the files named run, those and no other, and a list that came out
 * empty starts nothing, where Vitest given no file would run the whole suite. Vitest and the gate
 * are stood in for: what is checked is the command started, or that none was.
 */

import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { runFiles } from './unitFiles.ts'

const vitest = [
  process.execPath,
  fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run',
  '--config',
  'vitest.config.ts',
]
const unitRunTest = fileURLToPath(new URL('unitRun.test.ts', import.meta.url))
const allowedRunTest = fileURLToPath(new URL('allowedRun.test.ts', import.meta.url))
const repository = fileURLToPath(new URL('../..', import.meta.url))
const web = fileURLToPath(new URL('..', import.meta.url))

/** A run started from `caller`, the commands it started and what it said. */
function run(caller = web) {
  const started: (readonly string[])[] = []
  const said: string[] = []
  const canLock = vi.fn(() => true)
  const io = {
    caller,
    canLock,
    holder: () => '',
    spawn: (command: readonly string[]) => {
      started.push(command)
      return Promise.resolve(0)
    },
    write: (text: string) => said.push(text),
  }
  return { canLock, io, said, started }
}

describe('the Vitest files a run names', () => {
  it('runs exactly the files named from web/, without a lease', async () => {
    const { canLock, io, said, started } = run()
    expect(await runFiles(['tests/unitRun.test.ts', 'tests/allowedRun.test.ts'], io)).toBe(0)
    expect(started).toEqual([[...vitest, unitRunTest, allowedRunTest]])
    expect(canLock).not.toHaveBeenCalled()
    expect(said).toEqual([])
  })

  it('finds a name from the directory the command started in', async () => {
    const { io, started } = run(repository)
    expect(await runFiles(['web/tests/unitRun.test.ts'], io)).toBe(0)
    expect(started).toEqual([[...vitest, unitRunTest]])
  })

  it('reads one word of several lines, as a quoted search output, as one name a line', async () => {
    const { io, started } = run()
    expect(await runFiles(['tests/unitRun.test.ts\ntests/allowedRun.test.ts\n'], io)).toBe(0)
    expect(started).toEqual([[...vitest, unitRunTest, allowedRunTest]])
  })

  it('passes an option to Vitest after the files', async () => {
    const { io, started } = run()
    expect(await runFiles(['--reporter=dot', 'tests/unitRun.test.ts'], io)).toBe(0)
    expect(started).toEqual([[...vitest, unitRunTest, '--reporter=dot']])
  })
})

describe('a list of files that came out empty', () => {
  it.each([[[]], [['']], [['  ']], [['\n', ' \t ']], [['--reporter=dot']]])(
    'refuses %j and starts no Vitest',
    async (args) => {
      const { io, said, started } = run()
      expect(await runFiles(args, io)).not.toBe(0)
      expect(started).toEqual([])
      expect(said).toHaveLength(1)
      expect(said[0]).toMatch(/no test ran: no test file was given/)
    },
  )

  it.each([[['tests/noSuchFile.test.ts']], [['--reporter', 'dot', 'tests/unitRun.test.ts']]])(
    'refuses %j, which names something that is no file, and starts no Vitest',
    async (args) => {
      const { io, said, started } = run()
      expect(await runFiles(args, io)).not.toBe(0)
      expect(started).toEqual([])
      expect(said.join('')).toMatch(/no test ran: no such file: (tests\/noSuchFile\.test\.ts|dot);/)
    },
  )
})
