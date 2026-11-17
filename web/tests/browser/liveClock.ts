/**
 * The live double's clock: the moment the page starts at, and the moments of that day the
 * work is put at.
 */

/** Wednesday afternoon, five seconds into a minute: the live hour runs from 13:31. */
export const NOW = new Date(2026, 10, 11, 14, 30, 5)
export const at = (hour: number, minute: number, second = 0) =>
  new Date(2026, 10, 11, hour, minute, second)
