import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Where a browser check against the real server keeps everything that server reads and
 * writes: its database, its project registry and the home it looks under. A store named
 * by VALKAMA_BROWSER_STORE takes the place of every one of them, so the checks never
 * reach the owner's board, registry or desktop; the owner's own database is named as the
 * one path the server must refuse to open, as the Python suite does.
 */
export function serverStore(): string | null {
  const named = process.env.VALKAMA_BROWSER_STORE
  if (!named) return null
  if (!isAbsolute(named)) throw new Error('VALKAMA_BROWSER_STORE must be an absolute path')
  const store = resolve(named)
  if (store === resolve(homedir()) || store.startsWith(resolve(homedir(), '.valkama')))
    throw new Error('VALKAMA_BROWSER_STORE must not be the home or its Valkama store')
  return store
}

/** The interpreter the real server and its command line run with. */
export const python = process.env.VALKAMA_PYTHON ?? 'python'

/** The environment the server and its command line see for a store. */
export function storeEnvironment(store: string): Record<string, string> {
  return {
    VALKAMA_DB: join(store, 'valkama.sqlite3'),
    VALKAMA_PROTECTED_STORE: join(homedir(), '.valkama', 'valkama.sqlite3'),
    HOME: store,
    USERPROFILE: store,
    LOCALAPPDATA: join(store, 'AppData', 'Local'),
    APPDATA: join(store, 'AppData', 'Roaming'),
    VALKAMA_NO_TRAY: '1',
    VALKAMA_NO_ALERTS: '1',
  }
}
