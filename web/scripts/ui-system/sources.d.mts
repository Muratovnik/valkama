/** One file a UI-system rule reads: its path below the source root, with `/`, and its text. */
export interface UiSource {
  readonly file: string
  readonly source: string
}

export declare const defaultSourceRoot: string

export declare function collectVueSources(root?: string): UiSource[]
