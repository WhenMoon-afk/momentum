# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Momentum provides instant context recovery for Claude Code. Save snapshots as you work, restore in <5ms after `/clear`.

```
Traditional:  [context full] → LLM compaction → 30-60 seconds
Momentum:     [/clear] → restore_context → <5ms
```

## Development Commands

```bash
bun install            # Install dependencies
bun run build          # Compile TypeScript
bun run test           # Run tests (67 total)
bun run test:benchmark # Run benchmarks
bun run test:harness   # Run integration tests
```

## Project Structure

```
momentum/
├── src/
│   ├── index.ts       # MCP server - 13 tools
│   ├── database.ts    # SQLite layer (WAL mode)
│   └── types.ts       # TypeScript interfaces
├── .claude-plugin/
│   └── plugin.json    # Plugin manifest
├── cli/
│   └── mcp-server-wrapper.js  # Auto-install wrapper
├── skills/
│   └── context-management/
│       ├── SKILL.md   # Instructions for Claude
│       └── MCP-TOOLS.md
├── hooks/
│   └── hooks.json     # SessionStart hook
├── agents/
│   └── restore-context.md
├── tests/             # Vitest tests (40)
└── tools/             # Integration tests (27)
```

## Key Architecture Decisions

1. **No PreCompact hooks** - Manual workflow is more reliable
2. **Skills-based guidance** - Claude learns when to save/restore
3. **SessionStart hook** - Notification on startup
4. **SQLite + WAL** - Reliable, concurrent access

## Workflow

1. **Save snapshots** at task boundaries (guided by skill)
2. **User runs `/clear`** when context is full
3. **Claude calls `restore_context`** to recover
4. **Continue work** seamlessly

## Constraints

- **MCP uses stdout** - All logging via `console.error`
- **better-sqlite3** native module - May need rebuild on Node upgrade
- **Database**: `~/.local/share/momentum/momentum.db`

## Testing

```bash
# Run single test file
bun run vitest run tests/database.test.ts

# Run test by name
bun run vitest run -t "saves a snapshot"

# Manual MCP test
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```
