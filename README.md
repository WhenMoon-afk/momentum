# Momentum

Fast context recovery for Claude Code.

## Problem

Claude Code's compacting runs LLM inference on ~190k tokens, taking 30+ seconds and breaking workflow.

## Solution

Save structured snapshots as you work. Restore instantly after clearing context.

## Install

```
/plugin install momentum@substratia-marketplace
```

Or directly:

```
/plugin install github:whenmoon-afk/momentum
```

## Usage

Save snapshots at task boundaries:

```
save_snapshot(summary: "Implemented auth", context: "JWT with refresh tokens...")
```

After `/clear`, restore context:

```
restore_context()
```

Search for specific topics:

```
get_context_about(keywords: ["auth", "JWT"])
```

## Tools

| Tool | Purpose |
|------|---------|
| `save_snapshot` | Save work state |
| `restore_context` | Recover context after clear |
| `get_context_about` | Search by keyword |
| `inject_context` | Quick topic-filtered injection |
| `list_snapshots` | View snapshots |
| `list_sessions` | View sessions |
| `start_session` | Begin session |
| `resume_session` | Resume session |
| `get_session_stats` | Session stats |
| `cleanup_snapshots` | Prune old data |
| `clear_session` | Delete session |
| `health_check` | Database status |

## Storage

SQLite database at:
- Linux/macOS: `~/.local/share/momentum/momentum.db`
- Windows: `%APPDATA%/momentum/momentum.db`

Override with `MOMENTUM_DB_PATH` env var.

## License

MIT
