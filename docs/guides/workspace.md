# The workspace

Valkama's interface is a local web app, served by the listener and shown in a
browser or in the [desktop app](desktop-and-tray.md). Work brings board, list,
and graph views over one Planning read model; Analytics is where you read the
usage and quota of agent work; Settings holds preferences and the installation's
health checks. Memory and session references stay with the work item they
support.

## The live local UI

The UI lives at `http://127.0.0.1:8642/`, in English or Russian, updated over
Server-Sent Events. The question inbox also refreshes every 30 seconds while
visible and when the window regains focus. What the board shows and how it is
worked is in [Kanban planning](planning.md).

## Task finder

Ctrl/Cmd+K finds a task across mapped projects. Results retain their exact store
and space; unavailable sources and truncated results stay visible.

## Colours for task types

Epics are purple by default, bugs rose, improvements turquoise and tasks
grey-blue, on a type's icon and word only: state colours stay as they are. Change
them under Settings → General → Task type colors; a change applies at once. The
choice is kept in `localStorage`, on the device, so a browser and the desktop app
each remember their own.

## Names for accounts

The usage records hold only the id of the organization work was billed to. Under
Settings → General → Accounts, each account the past year saw is listed with its
id and its share of agent time, and you can give it a name or clear one.
Analytics then labels the account by that name, and
quota alerts say it. In the quota panel, the menu beside an account's name renames
it, adds it to the page's filter and copies its id. Names are kept in Valkama's store, so every browser and the
desktop app say the same one; names a device kept on its own before are moved
there once.

## Memory on a work item

Memory points rather than copies. Each project's knowledge is searched through
whichever provider answers for it, and what is attached to a work item is a
pointer with a stored label — so it still reads when the source behind it cannot
be reached. How a provider answers is in [the product model](../product-model.md).
