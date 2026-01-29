# CLAUDE.md

## Project Overview

Momentum is a snapshot MCP server for Claude Code. Save conversation snapshots, restore them after `/clear`, and import snapshots from Claude Desktop.

## Development Commands

```bash
npm install            # Install dependencies (compiles better-sqlite3)
npm run build          # Build TypeScript
npm start              # Start MCP server
```

## Project Structure

```
momentum/
├── src/
│   ├── index.ts       # MCP server - 5 tools
│   └── database.ts    # SQLite layer (better-sqlite3)
├── .claude-plugin/
│   └── plugin.json    # Plugin manifest
├── cli/
│   └── mcp-server-wrapper.js  # Auto-install wrapper
├── hooks/
│   └── hooks.json     # SessionStart hook
└── dist/              # Compiled output
```

## Tools

- `save_snapshot` - Save current conversation state (summary, context, optional name/next_steps)
- `load_snapshot` - Load by ID, name, or latest. Returns pre-generated continuation prompt.
- `list_snapshots` - List all snapshots (optional limit)
- `delete_snapshot` - Delete by ID
- `import_snapshots` - Import from external DB (e.g., Claude Desktop's snapshots.db)

## Database

- Single `snapshots` table, 7 columns
- Path: `SNAPSHOT_DB_PATH` env var or `~/.local/share/momentum/snapshots.db`
- Desktop import: set `SNAPSHOT_DESKTOP_DB` env var to the Windows snapshot DB path

## Constraints

- MCP uses stdout - all logging via `console.error`
- Node.js 18+ required
- Import opens external DB read-only (safe for /mnt/c/ in WSL)
