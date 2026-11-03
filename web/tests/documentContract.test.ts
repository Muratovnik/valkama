import assert from 'node:assert/strict'

import { afterEach, describe, test, vi } from 'vitest'

import {
  DocumentRefusal,
  nextResolveBatch,
  readDocument,
  resolveDocuments,
} from '@/shared/api/documentApi.ts'

afterEach(() => vi.unstubAllGlobals())

function respond(payload: unknown, status = 200) {
  const fetcher = vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => payload,
  }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

function address(paths: readonly string[]) {
  const parameters = new URLSearchParams({ space: 'id' })
  for (const path of paths) parameters.append('path', path)
  return `/api/documents/resolve?${parameters.toString()}`
}

/** All the requests it takes to ask about these paths. */
function asked(paths: readonly string[]) {
  const batches: (readonly string[])[] = []
  for (let rest = paths; rest.length > 0; rest = rest.slice(batches.at(-1)?.length)) {
    batches.push(nextResolveBatch({ space: 'id' }, rest))
  }
  return batches
}

describe('how many paths one resolve takes', () => {
  test('no more than 64, whatever their length', () => {
    const short = Array.from({ length: 200 }, (_, index) => `docs/p${index}.md`)
    assert.deepEqual(
      asked(short).map((batch) => batch.length),
      [64, 64, 64, 8],
    )
    assert.deepEqual(asked(short).flat(), short)
  })

  // Each is 1024 Cyrillic letters, the longest candidate there is, at 6 bytes a letter when encoded.
  test('fewer than 64 when long paths would pass the 64 KiB a request line may have', () => {
    const long = Array.from({ length: 64 }, (_, index) => `${'я'.repeat(1020)}${index}.md`)
    assert.ok(address(long).length > 65_536)
    const batches = asked(long)
    assert.ok(batches.length > 1)
    assert.deepEqual(batches.flat(), long)
    for (const batch of batches) assert.ok(address(batch).length <= 65_000)
  })

  test('the path that would pass the limit goes first in the next request', () => {
    // 64 paths whose address is exactly at the limit, then one letter past it.
    const room = 65_000 - address([]).length
    const each = Math.floor(room / 64) - '&path='.length
    const paths = Array.from({ length: 64 }, () => 'a'.repeat(each))
    const atLimit = [...paths.slice(0, 63), 'a'.repeat(room - 64 * '&path='.length - 63 * each)]
    assert.equal(address(atLimit).length, 65_000)
    assert.equal(nextResolveBatch({ space: 'id' }, atLimit).length, 64)
    const past = [...atLimit.slice(0, 63), `${atLimit[63]}a`]
    assert.equal(address(past).length, 65_001)
    assert.equal(nextResolveBatch({ space: 'id' }, past).length, 63)
  })

  test('always one, so a path that alone is too long still gets its answer', () => {
    const huge = 'a'.repeat(70_000)
    assert.deepEqual(nextResolveBatch({ space: 'id' }, [huge, 'b']), [huge])
  })
})

describe('the resolve answer', () => {
  const answer = {
    paths: [
      { path: 'a.md', status: 'file', project: 'p', relative: 'a.md', markdown: true },
      { path: 'b', status: 'directory', project: 'p', relative: 'b' },
      { path: 'c', status: 'missing' },
      { path: 'd', status: 'ambiguous' },
      { path: 'e', status: 'space_unbound' },
      { path: 'f', status: 'refused', code: 'outside_root' },
      { path: 'g', status: 'refused', code: 'unreadable' },
    ],
  }
  const asked = ['a.md', 'b', 'c', 'd', 'e', 'f', 'g']

  test('reads every status the contract names', async () => {
    respond(answer)
    assert.deepEqual(await resolveDocuments({ space: 's' }, asked), answer.paths)
  })

  test('sends each path as written, with the base it is taken from', async () => {
    const fetcher = respond({ paths: [{ path: 'C:/a b/é#1', status: 'missing' }] })
    await resolveDocuments({ space: 'id=1' }, ['C:/a b/é#1'])
    const [input] = fetcher.mock.calls[0] as unknown as [string]
    const url = new URL(input, 'http://page.test')
    assert.equal(url.pathname, '/api/documents/resolve')
    assert.deepEqual(url.searchParams.getAll('path'), ['C:/a b/é#1'])
    assert.equal(url.searchParams.get('space'), 'id=1')
    assert.equal(url.hash, '')
  })

  test('names a project instead of a space under an open document, and no base when it has none', async () => {
    const fetcher = respond({ paths: [{ path: 'x', status: 'missing' }] })
    await resolveDocuments({ project: 'p' }, ['x'])
    await resolveDocuments({}, ['x'])
    const urls = (fetcher.mock.calls as unknown as [string][]).map(
      ([input]) => new URL(input, 'http://page.test').searchParams,
    )
    assert.equal(urls[0]?.get('project'), 'p')
    assert.equal(urls[0]?.has('space'), false)
    assert.equal(urls[1]?.has('project'), false)
    assert.equal(urls[1]?.has('space'), false)
  })

  test('refuses an unknown status, an extra field and an answer to other paths', async () => {
    respond({ paths: [{ path: 'a', status: 'gone' }] })
    await assert.rejects(resolveDocuments({}, ['a']), /documents\.resolve/)
    respond({ paths: [{ path: 'a', status: 'missing', absolute: 'C:/x' }] })
    await assert.rejects(resolveDocuments({}, ['a']), /documents\.resolve/)
    respond({ paths: [{ path: 'b', status: 'missing' }] })
    await assert.rejects(resolveDocuments({}, ['a']), /does not answer the paths asked/)
  })

  test('carries a refusal by its code and status, or by status alone when it is not one', async () => {
    respond({ error: { code: 'fetch_metadata_refused' } }, 403)
    const refused = await resolveDocuments({}, ['a']).catch((error: unknown) => error)
    assert.ok(refused instanceof DocumentRefusal)
    assert.equal(refused.code, 'fetch_metadata_refused')
    assert.equal(refused.status, 403)
    respond(null, 414)
    const bare = await resolveDocuments({}, ['a']).catch((error: unknown) => error)
    assert.ok(bare instanceof DocumentRefusal)
    assert.equal(bare.code, null)
    assert.equal(bare.status, 414)
  })
})

describe('the read answer', () => {
  const document = {
    project: 'p',
    path: 'docs/a.md',
    markdown: '# a',
    size: 3,
    modified_at: '2026-11-03T15:12:09Z',
    revision: '9f2c41d0a7b3e655',
  }

  test('reads what it asked for', async () => {
    const fetcher = respond(document)
    assert.deepEqual(await readDocument('p', 'docs/a.md'), document)
    const [input] = fetcher.mock.calls[0] as unknown as [string]
    assert.equal(input, '/api/documents/read?project=p&path=docs%2Fa.md')
  })

  test('refuses another document and a revision of the wrong shape', async () => {
    respond(document)
    await assert.rejects(readDocument('p', 'docs/b.md'), /does not answer the document asked/)
    respond({ ...document, revision: 'abc' })
    await assert.rejects(readDocument('p', 'docs/a.md'), /documents\.read\.revision/)
  })

  test('says how large a file over the limit is', async () => {
    respond({ error: { code: 'too_large', size: 600_000, limit: 524_288 } }, 413)
    const refused = await readDocument('p', 'a.md').catch((error: unknown) => error)
    assert.ok(refused instanceof DocumentRefusal)
    assert.equal(refused.code, 'too_large')
    assert.equal(refused.size, 600_000)
    assert.equal(refused.limit, 524_288)
  })
})
