# External adapters

An adapter is a service written to be reached by Valkama. It answers three
calls, over HTTP under a namespaced prefix so it stays free to serve anything
else on the same port:

```text
GET  {base}/valkama/v1/manifest   its own manifest, which is how discovery finds it
GET  {base}/valkama/v1/health     {"status": "ready" | "degraded" | "unavailable"}
POST {base}/valkama/v1/invoke     {"capability_id": ..., "payload": {...}}
```

or as a process, one JSON request on stdin and one answer on stdout:

```text
{"call": "manifest"}
{"call": "health"}
{"call": "invoke", "capability_id": ..., "payload": {...}}
```

or, if it is already an MCP server, as tools — `valkama.manifest`,
`valkama.health`, and one named for each capability it declares. There is no
second protocol to implement: a tool is how an MCP server offers anything, and
a tool whose name is not a Valkama capability is simply not one, so a
general-purpose server can serve Valkama without becoming only that. Valkama
opens a session per call and owns no process between them.

Nothing goes on the command line, because argv is readable by every process on
the machine. An answer carrying `{"error": "..."}` is a refusal on either
transport: stdin and stdout have no status line, and a refusal only one
transport could make is one the conformance tool would miss.

No module calls an installed adapter yet: today the contract is what an adapter
is checked, declared and health-reported against.

## The manifest

**A manifest names the adapter and nothing else.** It has exactly four fields,
all required:

```json
{
  "contract_version": "valkama-adapter",
  "adapter_id": "example-notes",
  "version": "1.0.0",
  "capabilities": ["notes.search", "notes.open"]
}
```

`version` is a semantic version, and each capability is a dotted lowercase id
the adapter chooses for an operation it answers. A manifest carrying any other
field is refused with that field's name rather than read in part, and so is a
path or an argv anywhere in it. Where an adapter lives is therefore something
you supply — which is also the only order that works, since the destination is
how the manifest gets fetched. Installing pairs the two in a record under
`~/.valkama/adapters/`.

## Adapters and backends

This is not what a *backend* does. Phoenix, Langfuse and Jaeger are other
people's products with their own APIs; Valkama reaches one through a provider
written on this side that knows that product's shape. Asking a backend to
answer the three calls above would be asking it to become a Valkama plugin.

## Checking and installing an adapter

`adapter check` needs a destination: `--at`, `--command`, `--mcp`, or an installed
record supplied with `--record`. It fetches and validates the manifest, then
probes the running adapter for calls it should refuse, such as an undeclared
capability or a payload that is not an object. It also checks that the manifest
still identifies the adapter at that destination. A record describing one
adapter while its destination runs another cannot establish a valid connection.

Check a maintained adapter at the destination its owner documents, then install
that same destination only after the check passes:

```
python valkama.py adapter check --at http://127.0.0.1:8770
python valkama.py adapter install --at http://127.0.0.1:8770
```

Process and MCP adapters use their owner-supplied command directly:

```
python valkama.py adapter check --command ADAPTER_COMMAND ARG...
python valkama.py adapter install --command ADAPTER_COMMAND ARG...
python valkama.py adapter check --mcp MCP_COMMAND ARG...
python valkama.py adapter install --mcp MCP_COMMAND ARG...
```

Installing writes a record to `~/.valkama/adapters/`, one file per adapter,
holding the manifest and the transport and nothing else. That file is the whole
declaration: no table holds an installed adapter, so `adapter remove` deletes
the file and nothing else. Installing an adapter whose check failed is refused;
`--force` overrides and says so.

## Listing installed adapters

`adapter list` reads the records back and names every file it refuses, with the
reason, and `doctor` asks each installed adapter for its health under
Connections. A record written for the earlier, longer manifest is refused with
the names of the fields this contract does not have; check and install that
adapter again.
