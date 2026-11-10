"""Analytics: what agent work spent, read from the usage rows the telemetry reader wrote.

A domain package like Planning's: it reads `telemetry`'s usage tables, Planning's items
and spaces and the projects registry, and collects nothing of its own. `usage` is the
read model and `api` the transport-free boundary the HTTP surface serves.
"""
