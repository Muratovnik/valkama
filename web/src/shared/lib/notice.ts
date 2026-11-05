/**
 * The two kinds of thing the shell's corner says. What was done goes by itself once it has
 * been seen. A refusal is why something did not happen, which the person may still have to
 * act on, so it stays until they put it away. Every writer names which it is saying.
 */
export type NoticeKind = 'done' | 'refused'

export type SayNotice = (message: string, kind: NoticeKind) => void
