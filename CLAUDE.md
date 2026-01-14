# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Momentum provides instant context recovery for Claude Code. Save snapshots as you work, restore in <5ms after `/clear`.

**v0.6.0**: Node.js runtime with better-sqlite3 - works without Bun!

```
Traditional:  [context full] → LLM compaction → 30-60 seconds
Momentum:     [/clear] → restore_context → <5ms
```

## Development Commands

```bash
npm install            # Install dependencies (first run: compiles better-sqlite3)
npm run build          # Build TypeScript
npm start              # Start MCP server directly
npm test               # Run tests
```

## Project Structure

```
momentum/
├── src/
│   ├── index.ts       # MCP server - 3 tools (save, restore, momentum)
│   ├── database.ts    # SQLite layer (better-sqlite3, WAL mode)
│   └── types.ts       # TypeScript interfaces
├── .claude-plugin/
│   └── plugin.json    # Plugin manifest
├── cli/
│   └── mcp-server-wrapper.js  # Auto-install wrapper
├── skills/
│   └── context-management/
│       └── SKILL.md   # Instructions for Claude
├── hooks/
│   └── hooks.json     # SessionStart hook
├── commands/
│   ├── momentum-save.md
│   ├── momentum-load.md
│   └── momentum-status.md
└── tests/
```

## Key Architecture Decisions

1. **Node.js runtime** - More portable than Bun (works everywhere Node exists)
2. **better-sqlite3** - Fast native SQLite bindings for Node.js
3. **Auto-install wrapper** - First run installs deps, then instant startup
4. **Namespaced commands** - `/momentum:*` avoids conflicts with native commands
5. **3-tool consolidation** - save, restore, momentum (meta tool)

## Commands

- `/momentum:save` - Save current context snapshot
- `/momentum:load` - Load context (default: most recent)
- `/momentum:status` - Show session info and recent snapshots

## Workflow

1. **Save snapshots** at task boundaries (guided by skill)
2. **User runs `/clear`** when context is full
3. **Run `/momentum:load`** to recover context
4. **Continue work** seamlessly

## Constraints

- **MCP uses stdout** - All logging via `console.error`
- **Node.js 18+** required
- **Database**: `~/.local/share/momentum/momentum.db`
- **WSL note**: Use `MOMENTUM_DB_PATH` env var to share DB with Windows

## Testing

```bash
# Build and test MCP server
npm run build
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js

# Test wrapper script
node cli/mcp-server-wrapper.js
```
