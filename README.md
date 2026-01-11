# Momentum

**Instant context recovery for Claude Code** - Save snapshots as you work, restore in <5ms after `/clear`.

## The Problem

When Claude Code context gets full, you lose valuable context. Traditional compaction takes 30-60 seconds.

## The Solution

Save incremental snapshots as you work. After `/clear`, restore instantly.

```
Traditional:  [context full] → LLM compaction → 30-60 seconds
Momentum:     [/clear] → restore_context → <5ms
```

## Performance

| Stored Tokens | Restore Time | vs LLM Compaction |
|---------------|--------------|-------------------|
| 10,000        | **0.64ms**   | 46,875x faster    |
| 50,000        | **0.91ms**   | 32,967x faster    |
| 100,000       | **1.37ms**   | 21,898x faster    |
| 150,000       | **2.60ms**   | 11,538x faster    |

## Installation

### Via Plugin Marketplace (Recommended)

```
/plugin install momentum@whenmoon-afk
```

### From GitHub

```bash
git clone https://github.com/whenmoon-afk/momentum.git
cd momentum
./scripts/setup.sh
```

### Manual Setup

```bash
bun install && bun run build
```

Then add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "momentum": {
      "command": "node",
      "args": ["/path/to/momentum/cli/mcp-server-wrapper.js"]
    }
  }
}
```

## Workflow

### 1. Start a Session
```
start_session(project_path: "/path/to/project")
```

### 2. Save Snapshots as You Work

Claude saves snapshots at natural breakpoints:
- Task completion
- Before risky changes
- Key decisions made
- End of work session

```
save_snapshot(
  summary: "Implemented user auth",
  context: "JWT with refresh tokens, bcrypt hashing",
  files_touched: ["src/auth.ts"],
  decisions: ["RS256 signing", "30min expiry"],
  importance: "important"
)
```

### 3. When Context Gets Full

Run `/clear` to reset context, then:
```
restore_context()
```

Claude instantly recovers saved context and continues where you left off.

### 4. Search Past Context

Find specific information:
```
get_context_about(query: "authentication")
```

## Importance Levels

- `critical` - Must preserve (breaking changes, architecture decisions)
- `important` - High value (major features, significant fixes)
- `normal` - Standard progress (default)
- `reference` - Background info (research, notes)

## Tools

| Tool | Purpose |
|------|---------|
| `save_snapshot` | Save work progress |
| `restore_context` | Restore after /clear |
| `get_context_about` | Search past context |
| `start_session` | Begin new session |
| `resume_session` | Resume previous session |
| `list_snapshots` | View saved snapshots |
| `list_sessions` | View all sessions |
| `health_check` | Database status |

## Verify Installation

```bash
./scripts/validate.sh
# or
bun run validate
```

## Development

```bash
bun install           # Install dependencies
bun run build         # Compile TypeScript
bun run test          # Run tests (67 total)
bun run test:benchmark # Run benchmarks
bun run validate      # Verify installation
```

## Context Efficiency

Momentum is designed for minimal context overhead:

| MCP Server | Tool Tokens |
|------------|-------------|
| Linear (official) | 19,659 |
| Momentum | **~700** |

Inspired by [obra's Streamlinear approach](https://blog.fsck.com/2025/12/27/streamlinear/).

## Storage

SQLite database at `~/.local/share/momentum/momentum.db`

Override with `MOMENTUM_DB_PATH` environment variable.

## License

MIT
