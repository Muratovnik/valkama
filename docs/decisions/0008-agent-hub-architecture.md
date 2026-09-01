---
status: adopted
card: 199
---

# ADR 0008: The agent hub grows around the kanban core

Status: accepted on 2026-08-06 by owner direction.

## Context

The kanban MCP was built to visualize agent work state. An alternatives study
(`docs/research/2026-08-06-kanban-replacement-analysis.md`) rejected replacing
it with kandev, Backlog.md, vibe-kanban, or beads: none covers the workspace's
combination of atomic card and checklist-item claims, cross-repository boards,
AgentMemory refs, and plan anchors. A three-round owner interview on
2026-08-06 (recorded in `docs/plans/2026-08-06-agent-hub.md`) established the
target: a coordination hub for the owner and agents equally — live observation
of all agent sessions across clients, task-scoped knowledge, launching tasks
onto agents, and per-scope storage isolation. The owner declared stored data
and existing contracts untouchable and everything else negotiable.

## Decision

1. **The existing store and MCP contracts are the fixed core.** The SQLite
   schema evolves only additively; claims, checklist-item claims, refs,
   kb-anchors, and event history migrate nowhere. Agents keep the current MCP
   tool surface without retraining. The hub is new capability built around
   this core, not a rewrite and not an adopted external tool.
2. **The serve process becomes a persistent local hub service.** The
   "no service to keep alive" principle is consciously abandoned for the hub
   role: monitor ingest, SSE, runner supervision, notifications, and search
   live in one long-running process bound to 127.0.0.1 only. The MCP stdio
   path for agents stays daemon-free. Work-scope data may fall under NDA or
   contain personal data (152-ФЗ): it stays in local detachable files and the
   hub performs no external egress.
3. **Session observation uses a two-layer event model.** Normalized
   `analytics` events (client, tool, MCP server, call outcome) are long-lived
   and support usage analysis; `stream` events (current step, activity feed)
   are purgeable. Ingest goes through per-client adapters — the existing
   client-owned event adapters for Claude Code and Codex — against a published
   normalized event
   contract, so further clients attach without core changes.
4. **Runner boundaries refine, not amend, ADR 0007.** A launch whose model the
   owner picked explicitly with the default `executor` role is direct
   assignment, not delegation: `route-subagents` is out of scope and subagent
   spawning is disabled mechanically (e.g. `--disallowedTools "Agent"`), not
   by prompt. The `orchestrator` role exists only by explicit owner selection;
   the spawned session itself invokes `route-subagents` for downstream
   routing. The board stores routing outcomes; it never owns selection policy.
5. **Storage federates across attachable SQLite files.** Boards live in
   per-scope database files (personal, work, per-project beside its
   repository) listed in a registry; the UI federates attached scopes with
   source labels, and detaching a file removes its scope from every view.
   Each card lives in exactly one file. The current database becomes the
   first attached scope unchanged.
6. **The desktop shell is the primary surface.** The existing Electron app
   carries tray presence, Windows notifications, and the attention inbox; the
   browser view remains a byproduct of the same HTTP surface.

## Consequences

- Claude Code event capture changes touch pinned `.claude/settings.json`
  files and follow the established re-pinning migration across all three
  roots; `tools/test_claude_settings.py` stays the gate.
- The mandatory completion-summary guard changes the done-transition
  contract; the root `AGENTS.md` Kanban contract is amended when that guard
  lands (plan phase 2), not before.
- The kanban MCP tool surface is already flagged for review; hub features
  prefer the HTTP API and add MCP tools sparingly.
- Schema work keeps the mcp/ repository rules: tested backup and rollback,
  never validated against the live board.
- Rejecting external adoption is recorded with its evidence; revisiting it
  requires new facts, not re-litigation.
