"""Owner alerts: telling the person at this machine that an agent is waiting on them.

The word "notify" already names the other direction -- a person's action reported
to an agent -- so this channel is called alerts throughout. The package holds the
rule and its data: the owner's settings (`settings`) and what a toast says
(`messages`). Showing one belongs to `ops.toast`, which builds no text.
"""
