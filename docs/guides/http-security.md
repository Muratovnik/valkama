# Local HTTP security

Valkama's listener serves the UI and its API on the loopback interface only. This
guide says what it serves, which requests it accepts, and what that boundary
protects and does not.

## What the listener serves

The Python side serves `web/dist` plus the module and Planning APIs.
`GET /api/modules` is the module list this build declares in code, and
`GET /api/platform/context` the store's identity and the project directory with
each project's binding state, which the shell reads before any module renders.
No endpoint serves integration definitions or loads third-party browser code.

## Browser writes and the installation token

The listener accepts only the exact authority `127.0.0.1:<bound-port>`. Browser
writes bootstrap a fresh process-scoped session credential and send it in
`X-Valkama-Session`; the UI keeps it only in memory and retries one write after
a server restart. The bootstrap and every write with that credential must carry
`Sec-Fetch-Site: same-origin`, which a browser adds to its own same-origin
requests and a plain HTTP client does not, so a local script that just asks is
refused (`fetch_metadata_refused`); the trust boundary is stated in
[the connection contract](../connection-contract.md#call-identity). Originless `/api/ingest` adapters instead read the persistent
installation bearer from `~/.valkama/installation-token`. These credentials are
not interchangeable, never belong in URLs, cookies, browser storage, argv, or
environment variables, and every write must be an explicitly framed UTF-8 JSON
object. Vite development is the only extra browser origin and must be enabled by
the exact `--development-origin http://127.0.0.1:5173` flag shown in
[Building the web UI](development.md#building-the-web-ui).

## Pictures

A picture is sent with `POST /api/images?item=<reference>` as the bytes of the
file, under the same browser credential as any write, and read back with
`GET /api/images/<sha256>`, which, like the bootstrap, answers only a request with
`Sec-Fetch-Site: same-origin`. The server decides by the first bytes whether it is
a PNG, JPEG, WebP or GIF, refuses anything else (415) and anything over 10 MB
(413), and answers a read with that type, `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: default-src 'none'; sandbox`. The server neither logs
the bytes nor sends them anywhere by itself; an agent that reads a picture with
`read_work_item_image` hands it to its client and so to its model provider (see
[the connection contract](../connection-contract.md#pictures-on-an-item)).

## Frames

Every page the listener answers, the app's own and the document page alike, carries
`Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`: no
site, Valkama included, may show one in a frame, where another page could be laid
over a click.

## The display hook

`POST /api/hooks/message-display`, Claude Code's display hook, writes nothing and
takes neither credential: it answers a local process, and refuses any request with
`Origin` or `Sec-Fetch-Site`, which a browser cannot leave out. See
[the hook contract](../hook-contract.md#work-item-numbers-as-links-on-the-screen).

## Whose write it is

A Planning write that passes the browser credential is the owner's: its call is
recorded as `confirmed` with source `browser` and no agent session, and when the
request names no `author` it is signed `user`, so a claim, a checklist tick or a
comment made by hand reads as the owner's. `/api/ingest` is not such a write.
How agent calls are identified is in
[the connection contract](../connection-contract.md#call-identity).

## What the boundary protects

The token file is atomically created with the restrictive file mode supported
by the Python standard library. This boundary protects the loopback web surface
from hostile sites and DNS rebinding; it does not isolate malicious native code
already running as the same OS user, which can read the same user-owned runtime
files and process memory.
