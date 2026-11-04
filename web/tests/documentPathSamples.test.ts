/**
 * What a text becomes on the page, read from the table the page's parser, the
 * document layer and the server's check all work from.
 *
 * `where: option-row` is left to the layer that draws an option, which claims
 * every candidate as text: the parser reads a path the same wherever it stands.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseRichText, plainText } from '@/shared/lib/richText.ts'
import type { RichBlock, RichInline, RichListItem } from '@/shared/lib/richText.ts'
import { documentParts } from '@/shared/lib/textReferences.ts'
import type { DocumentReference } from '@/shared/lib/textReferences.ts'

interface Row {
  candidate: string | null
  caption: string | null
  copy: string | null
  form: string
  paths: string[]
  suffix: string
  text: string
  where: string
}

const { rows } = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('fixtures/document-path-samples.json', import.meta.url)),
    'utf8',
  ),
) as { rows: Row[] }

/** Paths the table's row does not speak of, because a row names one candidate. */
const ALSO_FOUND: Record<string, string[]> = {
  // In prose the path ends at the space, and what follows it has a shape of its own.
  [String.raw`D:\x y\z.txt`]: [String.raw`y\z.txt`],
  // A tag between two paths ends the first and starts the second.
  'docs/a.md<br>docs/b.md': ['docs/b.md'],
  '| Read | docs/a.md<br>docs/b.md |\n| --- | --- |': ['docs/b.md'],
}

function inlineDocuments(nodes: readonly RichInline[]): DocumentReference[] {
  return nodes.flatMap((node): DocumentReference[] => {
    if (node.kind === 'reference') return node.reference.kind === 'document' ? [node.reference] : []
    return 'children' in node ? inlineDocuments(node.children) : []
  })
}

function blockDocuments(block: RichBlock): DocumentReference[] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph': {
      return inlineDocuments(block.children)
    }
    case 'quote': {
      return block.children.flatMap((child) => blockDocuments(child))
    }
    case 'list': {
      return block.items.flatMap((item: RichListItem) =>
        item.children.flatMap((child) => blockDocuments(child)),
      )
    }
    case 'table': {
      return [block.header, ...block.rows].flat().flatMap((cell) => inlineDocuments(cell))
    }
    default: {
      return []
    }
  }
}

const documentsIn = (text: string) => parseRichText(text).flatMap((block) => blockDocuments(block))

describe('the shared sample table', () => {
  const read = rows.filter((row) => row.where !== 'option-row')

  it('has the rows it promises, so a broken read of the file cannot pass as no rows', () => {
    expect(read.length).toBeGreaterThanOrEqual(60)
  })

  it.each(read.map((row) => [row.text, row] as const))('%s', (text, row) => {
    const documents = documentsIn(text)
    if (row.form === 'none') {
      expect(documents).toEqual([])
      return
    }
    expect(documents.map((document) => document.value)).toEqual([
      row.candidate,
      ...(ALSO_FOUND[text] ?? []),
    ])
    const [document] = documents as [DocumentReference]
    expect(document.strength).toBe(row.form)
    expect(documentParts(document)).toEqual({
      copy: row.copy,
      paths: row.paths,
      suffix: row.suffix,
    })
    if (row.caption !== null) expect(plainText(text)).toBe(row.caption)
  })
})
