# Project documents

A path in a work item's text opens in Valkama's document viewer or in your editor
when it lies inside a registered project; registering one is described under
[Project registry](configuration.md#project-registry). This guide says what
opens and where, then gives the routes the page uses for it.

## Opening a path from a work item

A path to a project's file or folder in a work item's text, or a Markdown link to
one, can be pressed. A Markdown file opens in Valkama's document viewer, read-only and
at the `#kb:…` anchor, heading or `:42` line the path names: beside the card or the
panel of open questions where the window has room for both, over them where it does
not. Beside them, F6 moves between the two and the first Escape closes the document.
A link in it to another Markdown file opens in the same place, and Back returns. The
viewer's head opens the file in your editor at the line you are reading, and moves the
document to a window of its own at `/doc?project=<id>&path=<relative>`, a browser tab
or a second window of the desktop app, where a reload keeps your place. Any other file
opens in the editor Settings names, at its line, and a folder in that editor, through
the open plan described below. A path that cannot be opened is copied, and the notice
says why. A work item's `source`, its plan anchor, opens in
the viewer at the anchor, from the mark in the card's head and from its row in
Relations, in a browser and in the desktop app alike.

## Which paths open

A path in a work item's text is a candidate on the page, and the server says
what it is. `web/tests/fixtures/document-path-samples.json` is the table of what
a text becomes: strong, weak, copy-only or nothing, and what a click copies when
the path cannot be opened. Three shapes stay text: a run holding a character no
Windows name can hold (`tmp/<task>/`, `docs/*.md`) is a template, neither it nor
any part of it a path, though a tag the path does not go on through (`docs/a.md<br>`)
only ends it; a drive's root alone (`C:\`) names nothing; and two
backslashes are a network path only before a server and a share
(`\\server\share`), never in `\\n`. A path is opened only when it lies inside the root of
a registered project, after `..`, symbolic links and junctions are followed,
and the path that comes out is compared with the root as the disk spells both: in
a folder Windows keeps case-sensitive, `proj` beside `Proj` is a sibling and
outside. Anything else the page only copies, and a network path never reaches the server.

## The document routes

The three routes below are `GET`, read files and write nothing. Unlike the other reads they
require the request to come from the page itself: an `Origin`, when there is one,
must be allowed (`origin_refused`) and `Sec-Fetch-Site` must be `same-origin`
(`fetch_metadata_refused`), both 403. Every answer carries
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. A refusal is
`{"error": {"code": ...}}` from the closed list below and never carries the text
of an operating-system error.

### Resolve paths

`GET /api/documents/resolve?space=<id>&path=<p>&path=<p>...` takes up to 64 paths
and only asks the file system whether each exists; it opens no file. `space` is
the planning space's exact identity, the same value `GET /api/ref` takes, and is
only the base of a relative path. Inside a document the page shows, the base is
that document's project instead: `project=<id>` in place of `space`, the id
`resolve` answered with. Its root is the one the registry gives that id, a
project registered inside it is asked after it, as from a space, and the boundary
stays every registered root. The page has already read a link in the document
from the document's folder into a path from the project's root, so no folder is
sent, and it adds `exact=1` for those links: a project registered inside the root
is not asked for them, since their author wrote them from that folder. A `project`
the registry does not know is `project_unknown` for the whole
request, and naming both `space` and `project` is `invalid_request`. Each path is sent as written, without its
`:42` or `#...` suffix, and comes back unchanged in `path`, so an answer is matched
without parsing it. A request line may not pass 64 KiB (the listener answers 414),
so a batch of long paths is split sooner than 64:

```json
{"paths": [
  {"path": "docs/plan.md", "status": "file", "project": "example-project",
   "relative": "docs/plan.md", "markdown": true},
  {"path": "src/a.ts", "status": "file", "project": "example-project",
   "relative": "src/a.ts", "markdown": false},
  {"path": "./docs/../docs/plan.md", "status": "file", "project": "example-project",
   "relative": "docs/plan.md", "markdown": true},
  {"path": "docs/plans/", "status": "directory", "project": "example-project",
   "relative": "docs/plans"},
  {"path": "C:/projects/example/services/example-service/web", "status": "directory",
   "project": "example-service", "relative": "web"},
  {"path": "D:/outside/.valkama", "status": "refused", "code": "outside_root"},
  {"path": "../outside.md", "status": "refused", "code": "outside_root"},
  {"path": "docs/gone.md", "status": "missing"},
  {"path": "src/index.ts", "status": "ambiguous"},
  {"path": "docs/x.md", "status": "space_unbound"}
]}
```

| `status` | Meaning |
| --- | --- |
| `file`, `directory` | It exists. `project` is the deepest registered root it lies in and `relative` its path from that root, which is what `read` and the opener take. `markdown` comes with `file` |
| `missing` | Nothing there, under the space's root or under a project registered inside that root |
| `ambiguous` | A relative path found in two or more of the projects registered inside the space's root, and not under the root itself. The projects are not named |
| `space_unbound` | A relative path in a space the registry does not bind to one existing root. An absolute path in the same request still resolves |
| `refused` | `code` is `invalid_path` (not a local path Windows would take as written: a network or device path, a drive-relative path, a reserved name or character, longer than 1024 characters), `outside_root` (outside every registered root, answered the same whether anything is there), `not_a_file` (a device or a pipe) or `unreadable` (the operating system refused to say) |

A relative path is taken from the space's root first. Only when nothing is there
is it looked for in the projects registered inside that root, so a nested project
never overrides the root. The server does not send back an absolute path it
worked out; an absolute path the page sent comes back as sent. A registry that
cannot be read leaves no roots, so a relative path is `space_unbound` and an
absolute one `outside_root`.

### Read a Markdown file

`GET /api/documents/read?project=<id>&path=<relative>` reads one Markdown file,
taking `project` and `relative` from `resolve`. The path is checked again, inside
that project and no other, and once more on the file it opened, before a byte is
read: a folder on the way swapped for a junction out in between is `outside_root`.

```json
{"project": "example-project", "path": "docs/plan.md", "markdown": "...", "size": 65145,
 "modified_at": "2026-11-03T15:12:09Z", "revision": "9f2c41d0a7b3e655"}
```

`revision` is the first 16 hexadecimal digits of the SHA-256 of the bytes read.
The text is strict UTF-8 with a leading byte order mark removed and its line
endings untouched.

### Search a project's Markdown files

`GET /api/documents/search?space=<id>&q=<text>` offers the Markdown files of the
project a planning space is bound to, for the `@` list of a text being written. It
is the document search of `GET /api/search` over that project's root alone, which
also takes a file whose path from the root holds the text, case aside, at `line` 0
and ahead of the files found by a line. Each `path` is what `resolve` takes from the
same space; the root is never told. At most 20 files, one hit each; nothing typed,
or a space the registry does not bind to one existing root, offers none. A file
reached through a link or a junction out of the root is left out, and so is one the
project's Git ignores, such as scratch or private evidence: where a root lies in a
Git work tree that does not ignore it, Git lists its files, and only a root outside
any work tree is walked, past `node_modules`, `dist` and the like. No `space`, one
that is not a planning space's identity, or a text over 200 characters is
`invalid_request`.

```json
{"documents": [
  {"path": "docs/plan.md", "line": 0, "text": ""},
  {"path": "docs/notes.md", "line": 3, "text": "See the plan here."}
]}
```

### Refusal codes

| Code | HTTP | When |
| --- | --- | --- |
| `invalid_request` | 400 | Any route: no `path`, more than 64 paths, no `project` for `read`, both `space` and `project` for `resolve`, no `space` or a text over 200 characters for `search`, or a `space` that is not a planning space's identity |
| `invalid_path` | 400 | The path's form, as in `resolve` |
| `project_unknown` | 404 | `project` is not in the registry, for either route |
| `outside_root` | 403 | Outside every registered root |
| `not_found` | 404 | Nothing there |
| `directory`, `not_a_file` | 422 | Not a regular file |
| `not_markdown` | 415 | Not `.md` or `.markdown` |
| `too_large` | 413 | Over 512 KiB; the answer also carries `size` and `limit` |
| `binary`, `not_utf8` | 415 | A NUL in the bytes, or bytes that are not UTF-8 |
| `unreadable` | 503 | The operating system refused the read; its text goes to the server's log |

## Targets the opener takes

Opening a file or a folder in the editor goes through the same plan as opening a
session (`docs/connection-contract.md`, "What a click opens"), and the page names
the target only by what `resolve` answered:

```text
GET /api/open-plan?target=file&project=<id>&path=<relative>[&line=<n>]&surface=desktop|browser[&fallback=<editor>]
GET /api/open-plan?target=folder&project=<id>&path=<relative>&surface=desktop|browser[&fallback=<editor>]
```

`fallback` names the editor: `vscode`, `vscode-insiders`, `cursor` or `windsurf`,
VS Code when it is absent or names no editor. When that editor is not installed
the plan opens VS Code instead and says so in `opens.missed`; with VS Code missing
too it only explains, `explain {reason: "not-installed", host}`. The steps depend
on the surface:

| Target | In the desktop app | In a browser |
| --- | --- | --- |
| `file` | `focus-folder {ide, folder}` on the project's root, then `open-file {ide, path, line}` | `open-file {ide, path, line, link}` |
| `folder` | `focus-folder {ide, folder}` | `focus-folder {ide, folder, link}` |

The desktop app starts the editor on the folder and then on the file, so both
steps run on one click. A browser follows `link`, `vscode://file/<path>:<line>:1`
for a file and `vscode://file/<path>` for a folder, with the editor's own scheme in
place of `vscode` and the path encoded as Python's `Path.as_uri` encodes it.

The planner checks both targets with the same path check as `read`, inside the
named project, and the answer carries the absolute path it found, because a link
needs one. A folder's rule for a session (an existing absolute local folder, not
a network path, without `..`) stays as it is, and this target adds that it lies
inside a registered root.

A target that opens nothing is not an HTTP error. The plan answers 200 with one
step, `explain {reason: "path-refused", code}`, where `code` is one of `read`'s
codes or one the opener adds:

| `code` | When |
| --- | --- |
| `project_unknown` | `project` is not in the registry |
| `invalid_path`, `outside_root`, `not_found`, `not_a_file`, `unreadable` | As in `read` |
| `directory` | A `file` target that is a folder |
| `not_a_folder` | A `folder` target that is not one |

Only a request outside the closed values, such as no `project`, is refused with
HTTP 400 `invalid_request`.

