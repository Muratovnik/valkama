/**
 * Which paths in a text are real, and what pressing one does.
 *
 * A path's shape makes it a candidate; the server decides what it is. A strong
 * form is always a control: it opens what the server confirmed and otherwise
 * copies the path as written, so no press goes unanswered. A weak form looks as
 * much like prose, so it is a control only once confirmed and text otherwise.
 *
 * Who opens things stands above both the card and the question list, so `app`
 * provides the opener. An action it does not offer yet means the path is copied.
 */
import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

import { pathMemory } from '@/entities/project-document/pathMemory.ts'
import type { Confirmed } from '@/entities/project-document/pathMemory.ts'

import type { DocumentBase } from '@/shared/api/documentApi.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { ReferenceLink } from '@/shared/lib/referenceLinks.ts'
import { documentParts, suffixTarget } from '@/shared/lib/textReferences.ts'
import type { DocumentParts, DocumentReference } from '@/shared/lib/textReferences.ts'

/** What an opener is told to open: the server's own names for it, and where in it. */
export interface DocumentTarget {
  line: number | null
  path: string
  project: string
  suffix: string
}

/** Whether it opened. False means the page copies the path and says so. */
type OpenAttempt = (target: DocumentTarget) => boolean | Promise<boolean>

export interface DocumentOpener {
  /** The editor's name for a link's tooltip, once `openFile` or `openFolder` exist. */
  editor?: string
  openDocument?: OpenAttempt
  openFile?: OpenAttempt
  openFolder?: OpenAttempt
  /** Says the result in the status region its host keeps, which announces a repeat again. */
  say: (message: string) => void
}

const OPENER: InjectionKey<DocumentOpener> = Symbol('document-opener')

export function provideDocumentOpener(opener: DocumentOpener): void {
  provide(OPENER, opener)
}

/** The opener in force here, for a host that opens documents itself and passes the rest on. */
export function useDocumentOpener(): DocumentOpener {
  return inject(OPENER, { say: () => {} })
}

/** The written run without a tail of prose punctuation, which a weak form has no `copy` for. */
const leadOf = (query: DocumentParts) => query.copy ?? `${query.paths[0] ?? ''}${query.suffix}`

/** The line a suffix names, for an editor to open on. */
function lineOf(suffix: string): number | null {
  const target = suffixTarget(suffix)
  return target?.kind === 'lines' ? target.first : null
}

/** A refused or thrown attempt comes to the same: it did not open. */
async function opens(attempt: OpenAttempt, target: DocumentTarget): Promise<boolean> {
  try {
    return await attempt(target)
  } catch {
    return false
  }
}

/** The run a confirmed path covers: the variant that exists, as it was written. */
function writtenFor(answer: Confirmed, query: DocumentParts, value: string): string {
  return answer.path === query.paths[0] ? leadOf(query) : value
}

/** Where the control ends: a tail that is prose stays outside it, as prose. */
function runs(reference: DocumentReference, covered: string) {
  return { label: covered, after: reference.value.slice(covered.length) }
}

/**
 * The resolver for document references under one base.
 *
 * A component that already provides a layer composes this into it, because a
 * second `provide` in one component would replace the first; one that provides
 * nothing else uses `provideDocumentLinks`.
 */
export function useDocumentLinks(base: (reference: DocumentReference) => DocumentBase) {
  const { t } = useI18n()
  const opener = useDocumentOpener()
  const memories = new Map<string, ReturnType<typeof pathMemory>>()
  /** Written runs being acted on, so a second press while waiting does not act twice. */
  const pressing = new Set<string>()

  function memory(reference: DocumentReference) {
    const current = base(reference)
    const key = JSON.stringify(current)
    const known = memories.get(key)
    if (known) return known
    const created = pathMemory(current)
    memories.set(key, created)
    return created
  }

  async function copy(text: string, done = t('documentLinks.copied')) {
    try {
      await navigator.clipboard.writeText(text)
      opener.say(done)
    } catch {
      opener.say(t('documentLinks.copyFailed'))
    }
  }

  function attemptFor(answer: Confirmed): OpenAttempt | undefined {
    if (answer.status === 'directory') return opener.openFolder
    return answer.markdown ? opener.openDocument : opener.openFile
  }

  async function act(answer: Confirmed, query: DocumentParts, value: string) {
    const written = writtenFor(answer, query, value)
    const attempt = attemptFor(answer)
    if (!attempt) {
      await copy(written)
      return
    }
    const target = {
      project: answer.project,
      path: answer.relative,
      suffix: query.suffix,
      line: lineOf(query.suffix),
    }
    if (!(await opens(attempt, target))) await copy(written, t('documentLinks.openFailed'))
  }

  async function press(reference: DocumentReference, query: DocumentParts) {
    if (pressing.has(reference.value)) return
    pressing.add(reference.value)
    try {
      const current = memory(reference)
      const decision = await current.decided(query)
      if (decision.state === 'confirmed') {
        await act(decision.answer, query, reference.value)
        return
      }
      // Asked again beside the copy, not before it: the clipboard wants the press still warm.
      if (decision.state === 'unconfirmed' && decision.reason === 'unreachable')
        for (const path of query.paths) current.ask(path, true)
      await copy(leadOf(query))
    } finally {
      pressing.delete(reference.value)
    }
  }

  function openTitle(answer: Confirmed, query: DocumentParts, written: string): string | null {
    if (!attemptFor(answer)) return null
    if (answer.status === 'file' && answer.markdown)
      return t('documentLinks.openDocument', { path: written })
    const path = written.slice(0, written.length - query.suffix.length)
    const editor = opener.editor ?? 'VS Code'
    if (answer.status === 'directory') return t('documentLinks.openFolder', { editor, path })
    const line = lineOf(query.suffix)
    return line === null
      ? t('documentLinks.openFile', { editor, path })
      : t('documentLinks.openFileLine', { editor, path, line })
  }

  return (reference: DocumentReference): ReferenceLink | null => {
    const current = memory(reference)
    const query = documentParts(reference)
    for (const path of query.paths) current.ask(path)
    const decision = current.decide(query)
    const open = () => void press(reference, query)
    if (decision.state === 'confirmed') {
      const covered = runs(reference, writtenFor(decision.answer, query, reference.value))
      const title = openTitle(decision.answer, query, covered.label)
      return title
        ? { ...covered, title, open }
        : {
            ...covered,
            copies: true,
            title: t('documentLinks.copy.noOpener', { path: covered.label }),
            open,
          }
    }
    if (reference.strength === 'weak') return null
    const words = decision.state === 'pending' ? 'checking' : decision.reason
    return {
      ...runs(reference, leadOf(query)),
      busy: decision.state === 'pending',
      copies: true,
      title: t(`documentLinks.copy.${words}`, { path: leadOf(query) }),
      open,
    }
  }
}

/** Add a layer of document links for everything rendered below this component. */
export function provideDocumentLinks(base: (reference: DocumentReference) => DocumentBase): void {
  const documents = useDocumentLinks(base)
  provideReferenceLinks((reference, parent) =>
    reference.kind === 'document' ? documents(reference) : parent(reference),
  )
}
