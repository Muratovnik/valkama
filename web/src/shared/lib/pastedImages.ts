/**
 * A picture pasted into a text: what counts as one, how large it may be, the address the
 * server keeps it at, and the Markdown that names it.
 *
 * The server decides the same three things again and has the last word; these are here
 * so the editor can refuse at once, without sending ten megabytes it knows will come back.
 * A picture is told by its first bytes, as the server tells it, never by a file's name or
 * the type a clipboard declares for it.
 */

/** The largest picture the server keeps, in bytes. */
export const IMAGE_LIMIT = 10 * 1024 * 1024

export type ImageKind = 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp'

const starts = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte)

const ascii = (text: string) => Array.from(new TextEncoder().encode(text))

/** What the first bytes say the file is, or null when it is no picture taken here. */
export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts(bytes, ascii('GIF87a')) || starts(bytes, ascii('GIF89a'))) return 'image/gif'
  if (starts(bytes, ascii('RIFF')) && starts(bytes, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

/** How many of a file's first bytes `imageKind` reads. */
export const SIGNATURE_BYTES = 12

const SERVED = /^\/api\/images\/([0-9a-f]{64})$/u

/** The hash a served address names, or null for any other address. */
export function servedImage(href: string): string | null {
  return SERVED.exec(href)?.[1] ?? null
}

/** Where the server serves the picture with this hash. */
export const servedImagePath = (sha256: string) => `/api/images/${sha256}`

/**
 * The Markdown that shows a picture: its name as the words a reader hears, kept to one
 * line and without the brackets that would end them early.
 */
export function imageMarkdown(name: string, path: string): string {
  const words = name
    .replaceAll(/[[\]\\\s]+/gu, ' ')
    .trim()
    .slice(0, 80)
  return `![${words}](<${path}>)`
}
