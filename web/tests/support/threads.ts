/**
 * The thread keys every comment carries: a root, with no resolved mark, written
 * by no call the server could name. Spread into a fixture that is not about
 * threads, so it says only what it is about.
 */
export const asRoot = {
  reply_to: null,
  reply_to_request: null,
  by_person: null,
  resolution: null,
} as const
