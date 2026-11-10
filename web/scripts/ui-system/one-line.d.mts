import type { UiSource } from './sources.mjs'

/** The stylesheet that owns the one-line label and the trimmed word. */
export declare const ONE_LINE_OWNER: string

/** The places registered as real exceptions to the shared one-line rule, each with its reason. */
export declare const ONE_LINE_COPIES: ReadonlyMap<string, string>

/** Every rule outside the owner that ends text in an ellipsis or clips one line of it. */
export declare function scanOneLineCopies(
  sources: readonly UiSource[],
  register?: ReadonlyMap<string, string>,
): string[]
