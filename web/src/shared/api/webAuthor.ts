/**
 * Who this web client says it is when it writes.
 *
 * The browser has no identity of its own yet, so every write it makes names one
 * author, and the claim it holds is recognised by that same value. Some writes
 * used to name it and others named nobody, which the server records as the
 * product itself — so the client could not tell its own claim from an agent's.
 * One constant, so the identity the server issues later replaces it here and
 * nowhere else.
 */
export const WEB_AUTHOR = 'user'

/** True when a recorded actor is this client's own identity, compared as written. */
export function isWebAuthor(actor: string | null | undefined): boolean {
  return actor === WEB_AUTHOR
}
