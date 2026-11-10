"""Analytics: what agent work spent, read from the usage rows the telemetry reader wrote.

A domain package like Planning's: it reads `telemetry`'s usage tables, Planning's items
and spaces and the projects registry. `usage` is the read model and `api` the
transport-free boundary the HTTP surface serves. The one thing it keeps of its own is
how often each of its surfaces is opened: `uses` counts that, in the table `store`
declares.
"""
