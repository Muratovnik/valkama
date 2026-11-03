/**
 * The address of one Markdown document's own page, `/doc?project=…&path=…#anchor`.
 *
 * It stands beside the canonical route grammar and not in it, since that grammar names a
 * module and refuses a fragment, and a document's place is one.
 */

/** A project's document and where in it, as a page of its own names them. */
export interface DocumentPageAddress {
  path: string
  project: string
  suffix: string
}

const DOCUMENT_PAGE = '/doc'

function decodedFragment(hash: string): string {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

/**
 * What a `/doc` address names, or null when it is not one or names no document.
 *
 * It is read and not judged: the server checks the path when the page asks for the text,
 * and the page says what it refused. A fragment is the anchor as a text writes it after
 * its `#`, decoded so that the viewer can name it to the reader as it was written.
 */
export function documentPageAddress(url: URL): DocumentPageAddress | null {
  if (url.pathname !== DOCUMENT_PAGE) return null
  const project = url.searchParams.get('project')
  const path = url.searchParams.get('path')
  return project && path ? { project, path, suffix: decodedFragment(url.hash) } : null
}

/** A fragment has no `:42` of its own, so a line takes the form a link to a file on GitHub has. */
function fragmentOf(suffix: string): string {
  const lines = /^:(\d+)(?:-(\d+))?(?::\d+)?$/u.exec(suffix)
  if (!lines) return suffix
  const [, first, last] = lines
  return last === undefined ? `#L${first}` : `#L${first}-L${last}`
}

/** The address of one document's own page on this origin; `documentPageAddress` reads it back. */
export function documentPageHref({ path, project, suffix }: DocumentPageAddress): string {
  const query = new URLSearchParams({ project, path })
  return `${DOCUMENT_PAGE}?${query.toString()}${fragmentOf(suffix)}`
}
