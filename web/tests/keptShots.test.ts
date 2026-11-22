/**
 * What a browser run keeps past the next run: every file a test wrote into its output
 * directory and every attachment it gave as a body, named by its spec, in one directory per
 * run, the ten newest runs of a port kept.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  attachmentFile,
  isPlaywrightArtifact,
  keepTestOutput,
  keptName,
  removeStaleRuns,
  runName,
  staleRuns,
} from './browser/keptShots.ts'

describe('the name a kept file goes by', () => {
  it('starts with its spec, so two specs shooting the same screen never share one', () => {
    const one = keptName(
      'C:\\web\\tests\\browser\\production-list-project.spec.ts',
      'list-1280.png',
    )
    const other = keptName('/web/tests/browser/production-work-groupings.spec.ts', 'list-1280.png')
    expect(one).toBe('production-list-project__list-1280.png')
    expect(other).toBe('production-work-groupings__list-1280.png')
  })

  it('folds the folders a test wrote into into the name', () => {
    expect(keptName('a.spec.ts', 'board/lane-390.png')).toBe('a__board__lane-390.png')
  })

  it("keeps an attachment's own extension, else takes its type's", () => {
    expect(attachmentFile('scrollbar-390.png', 'image/png')).toBe('scrollbar-390.png')
    expect(attachmentFile('measurements-390', 'application/json')).toBe('measurements-390.json')
    expect(attachmentFile('renderer-exit', 'text/plain')).toBe('renderer-exit.txt')
    expect(attachmentFile('blob', 'application/x-unknown')).toBe('blob.bin')
  })
})

describe('what Playwright writes itself', () => {
  it('is left to the run results, and what a test writes is not', () => {
    for (const path of [
      'trace.zip',
      'test-failed-1.png',
      'test-finished-2.png',
      'video.webm',
      'error-context.md',
      'attachments/scrollbar-390-4f1e.png',
    ])
      expect(isPlaywrightArtifact(path), path).toBe(true)
    for (const path of ['list-project-1280.png', 'timings.txt', 'board/trace.zip'])
      expect(isPlaywrightArtifact(path), path).toBe(false)
  })
})

describe('the runs a port keeps', () => {
  const runs = Array.from({ length: 12 }, (_, hour) =>
    runName(new Date(Date.UTC(2026, 10, 22, hour, 5, 26, 123))),
  )

  it('removes the oldest past the newest ones kept, and nothing that is not a run', () => {
    expect(runs[0]).toBe('2026-11-22T00-05-26.123Z')
    const stale = staleRuns(['notes', ...runs.toReversed()], 10)
    expect(stale).toEqual(runs.slice(0, 2))
    expect(staleRuns(runs, 12)).toEqual([])
  })
})

describe('keeping one test', () => {
  function scratch() {
    const root = mkdtempSync(join(tmpdir(), 'valkama-kept-'))
    const outputDir = join(root, 'results', 'production-list-a-row-production')
    mkdirSync(join(outputDir, 'attachments'), { recursive: true })
    writeFileSync(join(outputDir, 'list-1280.png'), 'shot')
    writeFileSync(join(outputDir, 'trace.zip'), 'trace')
    writeFileSync(join(outputDir, 'attachments', 'copy-1a2b.png'), 'copy')
    return { outputDir, root, run: join(root, 'shots', runs) }
  }
  const runs = runName(new Date(Date.UTC(2026, 10, 22, 13, 5, 26, 123)))
  const file = '/web/tests/browser/production-list.spec.ts'
  const attachments = [
    { body: Buffer.from('png'), contentType: 'image/png', name: 'scrollbar-390.png' },
    { body: Buffer.from('{}'), contentType: 'application/json', name: 'measurements-390' },
    { contentType: 'application/zip', name: 'trace', path: '/elsewhere/trace.zip' },
  ]

  it('copies what it wrote and its body attachments, not what Playwright wrote', () => {
    const { outputDir, root, run } = scratch()
    try {
      expect(keepTestOutput({ attachments, file, outputDir }, run)).toBe(3)
      expect(readdirSync(run).toSorted()).toEqual([
        'production-list__list-1280.png',
        'production-list__measurements-390.json',
        'production-list__scrollbar-390.png',
      ])
      expect(readFileSync(join(run, 'production-list__scrollbar-390.png'), 'utf8')).toBe('png')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('takes a second name rather than overwrite a file the run already kept', () => {
    const { outputDir, root, run } = scratch()
    try {
      keepTestOutput({ attachments: [], file, outputDir }, run)
      writeFileSync(join(outputDir, 'list-1280.png'), 'second')
      keepTestOutput({ attachments: [], file, outputDir }, run)
      expect(readFileSync(join(run, 'production-list__list-1280.png'), 'utf8')).toBe('shot')
      expect(readFileSync(join(run, 'production-list__list-1280~2.png'), 'utf8')).toBe('second')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('makes no directory for a test that wrote and attached nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'valkama-kept-'))
    try {
      const run = join(root, 'shots', runs)
      expect(keepTestOutput({ attachments: [], file, outputDir: join(root, 'none') }, run)).toBe(0)
      expect(readdirSync(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes stale runs from the disk and leaves the rest', () => {
    const root = mkdtempSync(join(tmpdir(), 'valkama-kept-'))
    try {
      const names = Array.from({ length: 3 }, (_, minute) =>
        runName(new Date(Date.UTC(2026, 10, 22, 13, minute))),
      )
      for (const name of [...names, 'notes']) mkdirSync(join(root, name))
      removeStaleRuns(root, 2)
      expect(readdirSync(root).toSorted()).toEqual([...names.slice(1), 'notes'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
