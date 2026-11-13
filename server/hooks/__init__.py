"""`valkama hook`: what a client hook process does, without the server running.

`normalize` turns one hook input into the allowlisted fields Valkama keeps, and
reads the Claude `PreToolUse` call pair; it imports nothing from the store.
`ingest` writes a normalized event through a light open of the current schema,
`spool` keeps what could not be written, `pairs` keeps the call pairs the server
reads, and `entry` is the command.

This package stays free of imports at package level on purpose: the call pair
is written on every Valkama tool call and must not load the store.
"""
