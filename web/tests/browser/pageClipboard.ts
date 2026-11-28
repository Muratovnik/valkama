import type { BrowserContext, Page } from '@playwright/test'

/**
 * The page's clipboard: what a browser spec off the clipboard list (`clipboardSpecs.ts`) copies
 * to and reads from in place of the system's. The suite's `test` puts it into every context such
 * a spec opens, before the context has a page, so a page's first script already meets it, in
 * every frame of every page of that context.
 *
 * A page reaches the system clipboard two ways, and both end in the page:
 *
 * - The asynchronous clipboard: the four methods of `Clipboard.prototype` are replaced, so
 *   `navigator.clipboard` writes into the page and reads back what was written there last.
 * - The browser's own copy, cut and paste, from the keys (Ctrl or ⌘ with C, X, V or Insert,
 *   Shift with Delete or Insert) or from `document.execCommand`: the key's default is cancelled
 *   before the browser acts on it, and `execCommand` no longer reaches the browser for those
 *   three, so the browser's command, the one thing that writes or reads the system clipboard on
 *   this path, never starts. In its place the page gets the clipboard event the browser would have
 *   sent, carrying a `DataTransfer` the script made: what the page set on it, or the selection
 *   where the page set nothing, is recorded, and a paste carries what was copied last.
 *
 * A test reads what was copied with `pageCopies` or `copiedTexts` and makes the clipboard refuse
 * with `refuseClipboard`. A spec on the list has none of this: there a page meets the browser's
 * own clipboard, and these helpers fail.
 */

/** One write the page made to its clipboard. */
export interface PageCopy {
  /** What was written, by type: a text as it is, anything else as its size. */
  data: Record<string, string>
  /** How it was written: one of the clipboard's methods, or the browser's copy or cut. */
  via: 'writeText' | 'write' | 'copy' | 'cut'
}

/** The page's clipboard as the page holds it, under `Symbol.for(storeKey)` on `window`. */
interface PageStore {
  copies: PageCopy[]
  refusing: boolean
}

const storeKey = 'valkama.pageClipboard'

/** Runs in the page, before its own scripts: see the module's description. */
function installPageClipboard(key: string) {
  const scope = window as unknown as Record<symbol, PageStore | undefined>
  if (scope[Symbol.for(key)]) return
  const store: PageStore = { copies: [], refusing: false }
  Object.defineProperty(window, Symbol.for(key), { value: store })

  // eslint-disable-next-line unicorn/consistent-function-scoping -- this function runs in the page, where nothing outside it reaches
  const refusal = () =>
    new DOMException('the page clipboard refuses, as the test asked', 'NotAllowedError')
  const held = () => store.copies.at(-1)?.data ?? {}
  const record = (via: PageCopy['via'], data: Record<string, string>) => {
    store.copies.push({ via, data })
  }

  const methods = {
    writeText(text: string) {
      if (store.refusing) return Promise.reject(refusal())
      record('writeText', { 'text/plain': String(text) })
      return Promise.resolve()
    },
    async write(items: ClipboardItem[]) {
      if (store.refusing) throw refusal()
      const data: Record<string, string> = {}
      for (const item of items)
        for (const type of item.types) {
          const blob = await item.getType(type)
          data[type] = type.startsWith('text/') ? await blob.text() : `${blob.size} bytes`
        }
      record('write', data)
    },
    readText() {
      return store.refusing
        ? Promise.reject(refusal())
        : Promise.resolve(held()['text/plain'] ?? '')
    },
    read() {
      if (store.refusing) return Promise.reject(refusal())
      const texts = Object.entries(held()).filter(([type]) => type.startsWith('text/'))
      const parts = texts.map(([type, text]) => [type, new Blob([text], { type })] as const)
      return Promise.resolve(parts.length > 0 ? [new ClipboardItem(Object.fromEntries(parts))] : [])
    },
  }
  if (typeof Clipboard === 'function')
    for (const [name, value] of Object.entries(methods))
      Object.defineProperty(Clipboard.prototype, name, {
        configurable: true,
        writable: true,
        value,
      })
  else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: methods })

  // The browser's own `execCommand`, for every command but the clipboard's three.
  const command = Document.prototype.execCommand.bind(document)
  type Act = 'copy' | 'cut' | 'paste'

  /** The selected text: a text field's own selection when one has focus, else the page's. */
  const selected = () => {
    const field = document.activeElement
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const { selectionStart: start, selectionEnd: end, value } = field
      if (start !== null && end !== null) return value.slice(start, end)
    }
    return document.getSelection()?.toString() ?? ''
  }

  /** Where the browser sends a clipboard event: a text field with focus, the selection's start. */
  const targetOf = (): Element => {
    const field = document.activeElement
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field
    const selection = document.getSelection()
    const start =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null
    const element = start instanceof Element ? start : start?.parentElement
    return element ?? document.activeElement ?? document.body ?? document.documentElement
  }

  /** What the browser's copy, cut or paste does, with the page's clipboard for the system's. */
  const act = (kind: Act) => {
    const transfer = new DataTransfer()
    if (kind === 'paste')
      for (const [type, text] of Object.entries(held()))
        if (type.startsWith('text/')) transfer.setData(type, text)
    const event = new ClipboardEvent(kind, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: transfer,
    })
    const handled = !targetOf().dispatchEvent(event)
    if (kind === 'paste') {
      const text = transfer.getData('text/plain')
      if (!handled && text) command('insertText', false, text)
      return
    }
    if (handled) {
      const types = transfer.types.filter((type) => type !== 'Files')
      record(kind, Object.fromEntries(types.map((type) => [type, transfer.getData(type)])))
      return
    }
    const text = selected()
    if (!text) return
    record(kind, { 'text/plain': text })
    if (kind === 'cut') command('delete', false)
  }

  Document.prototype.execCommand = (commandId: string, showUI?: boolean, value?: string) => {
    const name = String(commandId).toLowerCase()
    if (name === 'copy' || name === 'cut') {
      act(name)
      return true
    }
    // A page may not paste by command in a browser either.
    return name === 'paste' ? false : command(commandId, showUI, value)
  }

  /** The keys of the browser's clipboard commands by `keyCode`, which a raw event may carry alone. */
  const byKeyCode: Record<number, string> = {
    45: 'insert',
    46: 'delete',
    67: 'c',
    86: 'v',
    88: 'x',
  }

  /**
   * The browser's clipboard command a key press starts, if any. The key is told by any of its
   * names: the physical key (`code`), the key it types (`key`) and the virtual key (`keyCode`), as
   * the browser may pick its command by any of them, so a press caught by one name too many stays
   * in the page rather than one caught by too few reaching the system.
   */
  const keyed = (event: KeyboardEvent): Act | undefined => {
    if (event.altKey) return undefined
    // eslint-disable-next-line unicorn/prefer-keyboard-event-key -- a raw event may carry its virtual key alone, and the browser picks its command by it
    const virtual = byKeyCode[event.keyCode]
    const names = new Set(
      [/^Key([A-Z])$/u.exec(event.code)?.[1], event.code, event.key, virtual]
        .filter((name): name is string => Boolean(name))
        .map((name) => name.toLowerCase()),
    )
    if (event.ctrlKey || event.metaKey) {
      if (names.has('c') || names.has('insert')) return 'copy'
      if (names.has('x')) return 'cut'
      if (names.has('v')) return 'paste'
      return undefined
    }
    if (event.shiftKey && names.has('delete')) return 'cut'
    if (event.shiftKey && names.has('insert')) return 'paste'
    return undefined
  }

  // First of all the page's listeners, since this script runs before the page's own.
  window.addEventListener(
    'keydown',
    (event) => {
      const kind = keyed(event)
      if (!kind || !event.isTrusted) return
      // The browser's own command is what would reach the system clipboard: it never starts.
      event.preventDefault()
      // The page's listeners still decide whether the command runs, as they would have.
      let declined = false
      Object.defineProperties(event, {
        preventDefault: {
          configurable: true,
          value: () => {
            declined = true
          },
        },
        defaultPrevented: { configurable: true, get: () => declined },
        returnValue: {
          configurable: true,
          get: () => !declined,
          set: (value: boolean) => {
            if (!value) declined = true
          },
        },
      })
      let done = false
      const after = () => {
        if (done) return
        done = true
        window.removeEventListener('keydown', after)
        if (!declined) act(kind)
      }
      // Last on the event's way back up, after the page's own listeners, where the browser's
      // command would come; a listener that stops the event keeps that one from running, and
      // then the task after this one acts.
      window.addEventListener('keydown', after)
      setTimeout(after, 0)
    },
    true,
  )
}

/**
 * Fails when `spec`, off the clipboard list, asks for the system clipboard's permissions: they
 * are what lets a page reach it, and such a spec reads its copies from the page.
 */
export function refuseClipboardGrant(spec: string, permissions: readonly string[] = []): void {
  const asked = permissions.filter((name) => name.startsWith('clipboard'))
  if (asked.length > 0)
    throw new Error(
      `${spec} asks for ${asked.join(' and ')}, which only a spec on the clipboard list ` +
        '(clipboardSpecs.ts) is granted: read what a page copied with copiedTexts (pageClipboard.ts), ' +
        'or move the test that needs the system clipboard into a listed spec of its own',
    )
}

/** The contexts whose grants already fail for the system clipboard. */
const guarded = new WeakSet<BrowserContext>()

/**
 * Puts the page's clipboard into `context`, a context of `spec`'s, for every page it opens, and
 * fails each grant of the system clipboard to it. The context has no page yet, or only the empty
 * one Playwright keeps when it reuses a context between tests (`PW_TEST_REUSE_CONTEXT`), which gets
 * the page's clipboard at once.
 *
 * The script goes in each time, even into a context this has seen: a reused context loses the
 * scripts the previous test added when that test ends, and two of them in one page install once.
 */
export async function keepClipboardInPage(context: BrowserContext, spec: string): Promise<void> {
  const pages = context.pages()
  if (pages.some((page) => page.url() !== 'about:blank'))
    throw new Error('the page clipboard goes into a context before its first page, not after')
  if (!guarded.has(context)) {
    guarded.add(context)
    const grant = context.grantPermissions.bind(context)
    context.grantPermissions = async (permissions, options) => {
      refuseClipboardGrant(spec, permissions)
      return grant(permissions, options)
    }
  }
  await context.addInitScript(installPageClipboard, storeKey)
  await Promise.all(pages.map((page) => page.evaluate(installPageClipboard, storeKey)))
}

/** Every write the page made to its clipboard in the document it shows, oldest first. */
export function pageCopies(page: Page): Promise<PageCopy[]> {
  return page.evaluate((key) => {
    const store = (window as unknown as Record<symbol, PageStore | undefined>)[Symbol.for(key)]
    if (!store)
      throw new Error(
        'this page has no page clipboard: its spec is on the clipboard list (clipboardSpecs.ts)',
      )
    return store.copies
  }, storeKey)
}

/** The text of each write the page made to its clipboard, oldest first. */
export async function copiedTexts(page: Page): Promise<string[]> {
  const copies = await pageCopies(page)
  return copies.map(({ data }) => data['text/plain'] ?? '')
}

/** The text of the page's last write to its clipboard, which a paste would give: none before one. */
export async function lastCopiedText(page: Page): Promise<string | undefined> {
  const texts = await copiedTexts(page)
  return texts.at(-1)
}

/** Runs in the page: its clipboard refuses from now on. */
function refusePageClipboard(key: string) {
  const store = (window as unknown as Record<symbol, PageStore | undefined>)[Symbol.for(key)]
  if (store) store.refusing = true
}

/**
 * From now on the clipboard of every page of `page`'s context refuses each write and read through
 * `navigator.clipboard` with `NotAllowedError`, as a browser that withholds it does: in the
 * documents those pages show and in every document they load after.
 */
export async function refuseClipboard(page: Page): Promise<void> {
  const context = page.context()
  await context.addInitScript(refusePageClipboard, storeKey)
  await Promise.all(context.pages().map((one) => one.evaluate(refusePageClipboard, storeKey)))
}
