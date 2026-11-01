import type { WorkItem } from '@/shared/api/planningModel.ts'

type Link = WorkItem['links'][number]

/**
 * The items that still stop this one: incoming `blocks` links whose other end
 * is not finished. A closed item is neither blocked nor waiting, so it has none.
 *
 * The link names the other end's state. Only a known terminal state takes a
 * blocker off the list: a link whose state the server could not read, or a
 * server too old to say, keeps it, because a blocker hidden by a guess is worse
 * than one shown that has already closed.
 */
export function openBlockers(item: WorkItem): Link[] {
  return item.state.is_terminal
    ? []
    : item.links.filter(
        (link) =>
          link.kind === 'blocks' && link.direction === 'incoming' && link.is_terminal !== true,
      )
}
