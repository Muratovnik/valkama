/**
 * Where `vue-tsc --build` keeps each project's `.tsbuildinfo`: inside the checkout, never under
 * `node_modules`. A worktree's `node_modules` may be a link to the main checkout's, and `--build`
 * reads an input again only when it is newer than the buildinfo, so a buildinfo every checkout
 * shares lets a build in one checkout count a type error written earlier in another as up to
 * date, and `npm run typecheck` passes there with no output.
 *
 * The projects and their options come from TypeScript's own reading of `tsconfig.json`, with
 * `extends` followed and paths resolved, so a project added to the solution is checked as well.
 */

import { basename, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const web = fileURLToPath(new URL('..', import.meta.url))
const checkout = resolve(web, '..')

function parsed(configFile: string): ts.ParsedCommandLine {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    },
  }
  const result = ts.getParsedCommandLineOfConfigFile(configFile, undefined, host)
  if (result === undefined) throw new Error(`${configFile} was not read`)
  return result
}

/** Every project `--build` builds from the solution file, in the order it names them. */
function solutionProjects(): string[] {
  const references = parsed(resolve(web, 'tsconfig.json')).projectReferences ?? []
  return references.map((reference) => ts.resolveProjectReferencePath(reference))
}

/** Why a buildinfo at this path is shared with other checkouts, or `null` when it is this one's. */
function sharedPlace(buildInfo: string): string | null {
  const inside = relative(checkout, buildInfo)
  if (inside.startsWith('..') || isAbsolute(inside)) return 'outside the checkout'
  if (inside.split(/[\\/]/).includes('node_modules')) return 'under node_modules'
  return null
}

describe("the type check's build information", () => {
  it('is read for each project the solution builds', () => {
    expect(solutionProjects().map((project) => basename(project))).toEqual([
      'tsconfig.app.json',
      'tsconfig.node.json',
      'tsconfig.tests.json',
    ])
  })

  it('stays in the checkout and out of node_modules for every project', () => {
    // A project that is not incremental writes no buildinfo, so it shares none.
    const places = solutionProjects().flatMap((project) => {
      const buildInfo = ts.getTsBuildInfoEmitOutputFilePath(parsed(project).options)
      return buildInfo === undefined
        ? []
        : [{ project: basename(project), shared: sharedPlace(buildInfo) }]
    })
    expect(places.length).toBeGreaterThan(0)
    expect(places).toEqual(places.map(({ project }) => ({ project, shared: null })))
  })

  it("refuses a place another checkout writes and takes the checkout's own cache", () => {
    expect(sharedPlace(resolve(web, 'node_modules/.tmp/tsconfig.tests.tsbuildinfo'))).toBe(
      'under node_modules',
    )
    expect(sharedPlace(resolve(checkout, '../tsconfig.tests.tsbuildinfo'))).toBe(
      'outside the checkout',
    )
    expect(
      sharedPlace(resolve(checkout, '.cache/tsbuildinfo/tsconfig.tests.tsbuildinfo')),
    ).toBeNull()
  })
})
