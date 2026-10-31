"""`valkama hook`: what a client hook process does, without the server running.

`normalize` turns one hook input into the allowlisted fields Valkama keeps, and
builds the Claude `PreToolUse` identity output; it imports nothing from the
store. `ingest` writes a normalized event through a light open of the current
schema, `spool` keeps what could not be written, and `entry` is the command.

This package stays free of imports at package level on purpose: the identity
transform runs on every Valkama tool call and must not load the store.
"""
