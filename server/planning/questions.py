"""What a question to the owner is, stated once for every reader that must agree.

A request asks either the owner or an agent session (its `addressee`). A list on a
comment asks nobody: nobody waits for it. Only a question to the owner raises the
owner's alert, holds an item up and stands in what waits for a person; a request
asked of a session waits for that session alone, and the session hears it.

The conditions read a request row named `r`. The module imports nothing of the
planning domain, so any reader can take them, below the service as well as above.
"""

from __future__ import annotations

#: A request row `r` that asks the owner, open or closed: neither a list on a
#: comment nor a request asked of an agent session.
OWNER_ASKED = "r.comment_id IS NULL AND r.addressee IS NULL"
#: A request row `r` that is a question to the owner while nobody has answered it.
#: A row can still have lapsed although nothing wrote that down; a reader of what
#: is open reads its effective expiry beside this.
OWNER_QUESTION = "r.status = 'pending' AND " + OWNER_ASKED
