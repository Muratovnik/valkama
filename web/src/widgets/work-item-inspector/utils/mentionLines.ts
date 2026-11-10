/**
 * The records of texts on other items that named this one, as the quiet lines its
 * discussion shows (`InspectorMentionLine`) and the words its history gives a mention.
 *
 * The read brings the newest records, oldest first, and how many there are in all; a
 * record says where the words stand (`in`), on which item (`from`), when, who wrote them
 * and how they start (`quote`). A reply is a comment to the server, and so here. Once the
 * item the words stood on is deleted, `from` and `quote` are null: the record says only
 * that a deleted item named this one, and leads nowhere.
 */
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { plainText } from '@/shared/lib/richText.ts'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type MentionRecord = NonNullable<WorkItem['mentions']>[number]

/** Where the words stand: a kind of text on another item, or an item no longer there. */
type MentionPlace = MentionRecord['in'] | 'deleted'

export interface MentionLine {
  at: string
  author: string
  byPerson: boolean
  /** The item the words stand on; null once it is deleted. */
  from: string | null
  key: string
  place: MentionPlace
  /** Their first words, without their markup; empty where there are none to show. */
  quote: string
}

function placeOf(record: MentionRecord): MentionPlace {
  return record.from === null ? 'deleted' : record.in
}

/**
 * One line for each record the read brought, in the read's order. A comment names an item
 * once, but a description saved again names it again with no comment of its own, so a key
 * that is taken already gets the record's place in the list after it.
 */
export function mentionLines(records: readonly MentionRecord[]): MentionLine[] {
  const taken = new Set<string>()
  return records.map((record, index) => {
    const base = `mention-${record.in}-${record.comment_id ?? ''}-${record.at}`
    const key = taken.has(base) ? `${base}-${index}` : base
    taken.add(key)
    return {
      key,
      at: record.at,
      place: placeOf(record),
      from: record.from,
      quote: record.quote === null ? '' : plainText(record.quote),
      author: record.author,
      byPerson: record.by_person === true,
    }
  })
}

/** How many records are older than those the read brought: none when it brought them all. */
export function olderMentions(item: Pick<WorkItem, 'mentions' | 'mentions_total'>): number {
  const sent = item.mentions?.length ?? 0
  return Math.max(0, (item.mentions_total ?? sent) - sent)
}

/** The line's words: where it was mentioned and from which item, the number as written. */
export function mentionWhere(line: Pick<MentionLine, 'place' | 'from'>, t: Translate): string {
  return t(`mentions.line.${line.place}`, { from: line.from ?? '' })
}
