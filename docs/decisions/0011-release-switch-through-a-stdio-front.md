---
status: draft
card: 1260
---

# ADR 0011: A release switch reaches a running session through a stdio front

## Context

A client starts Valkama through the stable launcher command, which runs one
pinned release. The client owns that process for the whole session, and its
stdin and stdout are the transport. After `launcher install` pins another
release, every running session keeps the process it has. Until this decision
that process could only say so: it appended "restart this client session" to a
few tool results, and a tool the new release added stayed invisible until the
owner restarted every session.

What the protocol and the two clients offer, as read on 2026-10-31:

- **MCP 2026-07-28.** A server that declares `capabilities.tools.listChanged`
  SHOULD send `notifications/tools/list_changed` when its tool list changes,
  but only to a client that opened a `subscriptions/listen` stream with
  `toolsListChanged: true`. The server first sends
  `notifications/subscriptions/acknowledged`, and that message and every
  notification on the stream carry the listen request's JSON-RPC id in
  `_meta["io.modelcontextprotocol/subscriptionId"]`; on stdio that id is how
  the client tells streams apart. The client ends the stream with
  `notifications/cancelled`. A notification invalidates a cached `tools/list`
  that is still fresh. Sources: the specification's
  [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
  [subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)
  and [caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching)
  pages.
- **MCP 2025-11-25**, the newest handshake revision: a server that declared
  `listChanged` in its `initialize` result SHOULD send the notification; there
  is no subscription.
- **stdio.** The client launches the server; stdout carries nothing but MCP
  messages, stderr is for logs, and closing stdin is the shutdown signal. A
  server that exits unexpectedly SHOULD be restarted by the client, and its
  in-flight requests are lost
  ([stdio binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)).
- **Claude Code 2.1.304** (the installed build; its bundle was read, and the
  public changelog and issue tracker). It has acted on `list_changed` since
  2.1.0, but only for a server that declares `capabilities.tools.listChanged`:
  without the declaration the notification is dropped, which a maintainer
  reproduced on 2.1.233 in
  [anthropics/claude-code#66084](https://github.com/anthropics/claude-code/issues/66084)
  (2026-08-15). On a 2026-07-28 connection, which local stdio servers get by
  default since 2.1.292, it opens `subscriptions/listen` with
  `toolsListChanged: true` itself when the discovery result declares the
  capability, and on the notification it lists the tools again past its cache.
  The same issue records two limits: the Desktop app's host path did not
  refresh on 2.1.237, and a tool schema the model has already loaded can stay
  pinned for the rest of the conversation. A server-delivered denylist can also
  switch listen streams off for a connection.
- **Codex CLI 0.166.0** (source at tag `rust-v0.166.0`, 2026-10-29). It speaks
  the handshake revisions unless the `mcp_2026_07_28` feature is on. Its
  default handler only logs `list_changed`; the `mcp_tool_list_changed`
  feature, under development and off by default, re-lists the tools at the
  next catalog read after one arrived.

So a running session can learn about new tools mid-session in Claude Code's
CLI, and in Codex only behind a feature flag. Every client, though, keeps the
pipe, and anything behind the pipe can change.

## Decision

`valkama.py mcp`, when the launcher started it and the launcher still names
this release, runs a **front** (`server/mcp_front.py`) instead of the server.
The front owns the client's pipes for the session and runs the server itself
as a **backend**: a child process, `<interpreter> <release>/valkama.py mcp`,
for the release the launcher names now. Any other start of `valkama.py mcp` —
a checkout run, a test — serves in-process as before.

The front and the backend speak plain MCP over stdio. That is what lets a
front drive a backend from any release, older ones included: a release that
predates the front is simply a server.

- **Requests pass through as bytes.** A client line reaches the backend
  unchanged, so `_meta`, `_identity` and the request id arrive exactly as the
  client wrote them. The front parses an answer to find its id, and rewrites
  three kinds of answer and no others: it adds `tools.listChanged: true` to the
  capabilities of an `initialize` and a `server/discover` result, and it
  appends a warning to a tool result when one is due.
- **The front keeps the protocol state.** It records the `initialize` the
  client sent and whether `notifications/initialized` followed, and replays
  both to every later backend, so the new one knows the client's era and
  `clientInfo`. It answers `subscriptions/listen` itself, acknowledging only
  `toolsListChanged`, and holds each stream until the client cancels it.
- **A switch happens between requests.** One lock covers a request's whole
  round trip and a switch. The front looks at the launcher manifest before
  every request it forwards, and a watcher looks every two seconds, so an idle
  session switches too. An in-flight request therefore finishes on the backend
  that received it, and nothing is sent twice.
- **The order of a switch is the store's guard.** The new release is first
  asked for `capabilities`, which reads no user data. Only when that succeeds
  is the old backend stopped — stdin closed, then its process tree killed if it
  has not exited — and the new one started and asked `server/discover`. Two
  backends of one session never run at once, because a backend migrates the
  store in `connect()` before it answers anything, and an old backend's
  maintenance thread writes without a request.
- **The tool list is compared, not assumed.** After a switch the front asks
  the new backend for its tools and compares them with the last list the
  client received. Only when they differ, and only when the client can receive
  it — a handshake client, or a subscription with `toolsListChanged` — does it
  send `notifications/tools/list_changed`.
- **A failed release leaves the session where it was.** A release whose
  `capabilities` fails is never started, and the old backend keeps serving. A
  release that fails after the old backend stopped — a store it refuses, a
  crash while it starts — is stopped, and the previous release is started
  again. Either way the next tool result carries one warning naming the
  release and why, and that release is tried again only when the launcher
  names another one. If the previous release cannot start either, the front
  answers with an error and exits: what remains is a store no available
  release accepts, and the store's own refusal is the message.
- **A backend that dies mid-session ends the session's server.** The request it
  held is answered with an error, never resent, and the front exits non-zero;
  the client's restart logic does the rest, as it would for any server.
- **Windows.** Every pipe is bytes, and stdout carries only the frames the
  front checked: a backend line that is not a JSON-RPC frame is reported on
  stderr and dropped. A backend gets `VALKAMA_NO_TRAY`, so the tray icon the
  front holds does not flicker on a switch, and loses `VALKAMA_LAUNCHER_DIR`,
  so it cannot become a front of its own or warn about a pin the front
  follows. It is started without a console window and stopped through
  `processes.stop_process_tree`. The `capabilities` run gets no stdin: on
  Windows a Python child handed the front's stdin pipe does not finish starting
  while the front's main thread has a read pending on it, so a switch begun
  while the client was idle would have waited for its next message.

The front's own code is the one part a switch does not replace: a session
keeps the front it started with.

## Alternatives rejected

- **Reload the server inside its process.** `importlib.reload` re-executes a
  module, but instances keep their old class definitions and names bound by
  `from X import Y` keep the old objects
  ([Python documentation](https://docs.python.org/3/library/importlib.html#importlib.reload)).
  This server keeps an open store connection, a maintenance thread, the tray
  handles and module singletons, and a release may need another interpreter.
  A release that failed to import would take the client's only process with
  it.
- **Keep the warning and make it actionable.** It already named its one fix,
  restarting the session, and that is the cost the owner wants gone. It
  remains for a process with no front: a checkout run whose sources changed.
- **Exit and let the client restart the server.** The stdio binding only says
  a client SHOULD restart a server that exited, and a reconnect does not
  reliably refresh Claude Code's tool index (#66084). It would also lose the
  subscription and whatever request arrived during the exit.
- **Start the new backend before stopping the old one.** It would save the
  start-up time of a switch, and it would let a new release migrate the store
  under an old one that is still writing.

## Consequences

- In Claude Code's CLI a tool added by a release appears in a running session
  within seconds of `launcher install`, and a tool removed disappears.
- In Codex, by default, every call reaches the new release, but a tool the new
  release added stays invisible until the session restarts or
  `mcp_tool_list_changed` is enabled.
- A changed schema of a tool the model already loaded may stay in its context;
  the new release refuses an argument it does not take and names the ones it
  does.
- A session runs two Python processes, and a switch costs one release start
  plus a `capabilities` run. On Windows 11 with Python 3.15.2 and a throwaway
  store, a session's first answer through the launcher took a median of 0.29
  seconds against 0.21 without the front, and the notification arrived 2.4 to
  4.6 seconds after `launcher install` returned
  ([the connection contract](../connection-contract.md#a-release-switch-under-a-running-session)).
- An old release that a running session still serves cannot be made to
  refuse a store a newer one migrated while its request was in flight; that
  window is one request long per session.
- A process killed from outside leaves its backend to see stdin close and exit
  on its own; nothing else holds the backend to the front's lifetime.
