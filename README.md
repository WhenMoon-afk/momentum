# Momentum

[![CI](https://github.com/WhenMoon-afk/momentum/actions/workflows/ci.yml/badge.svg)](https://github.com/WhenMoon-afk/momentum/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Instant context recovery for Claude Code** - Save snapshots as you work, restore in <5ms after `/clear`.

> *Part of the [Substratia](https://substratia.io) memory infrastructure ecosystem.*

## The Problem

When Claude Code context gets full, you lose valuable context. Traditional compaction takes 30-60 seconds.

## The Solution

Save incremental snapshots as you work. After `/clear`, restore instantly.

```
Traditional:  [context full] → LLM compaction → 30-60 seconds
Momentum:     [/clear] → restore_context → <5ms
```

## Performance

| Stored Tokens | Restore Time | vs 30s LLM Compaction |
|---------------|--------------|----------------------|
| 10,000        | **~1ms**     | ~26,000x faster      |
| 50,000        | **~2.5ms**   | ~12,000x faster      |
| 100,000       | **~4ms**     | ~7,000x faster       |
| 150,000       | **~5ms**     | ~6,000x faster       |

*Run `bun test:benchmark` to see results on your hardware.*

## Installation

### Via Plugin Marketplace (Recommended)

```
/plugin install momentum@substratia-marketplace
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

## Cloud Sync

Momentum v0.7.0+ supports syncing snapshots to **[Substratia Cloud](https://substratia.io/cloud)**:

1. **Get API key** from [substratia.io/dashboard](https://substratia.io/dashboard)
2. **Set environment variable:**
   ```bash
   export SUBSTRATIA_API_KEY=sk_your_key_here
   ```
3. **Snapshots auto-sync** on save

### Manual Sync

```
momentum(action: "sync")      # Sync all unsynced snapshots
momentum(action: "health")    # Check cloud connection status
```

### Benefits
- Access snapshots across all devices
- Browse snapshots in the web dashboard
- Automatic backups
- Team sharing (coming soon)

## Related Projects

Part of the **Substratia** memory infrastructure ecosystem:

- **[memory-mcp](https://github.com/WhenMoon-afk/claude-memory-mcp)** - Persistent memory across sessions (npm: `@whenmoon-afk/memory-mcp`)
- **[AgentForge](https://substratia.io/builder)** - Visual drag-and-drop agent config builder
- **[Substratia](https://substratia.io)** - Memory infrastructure for AI

## Support

- [GitHub Issues](https://github.com/WhenMoon-afk/momentum/issues) - Bug reports & feature requests
- [GitHub Sponsors](https://github.com/sponsors/WhenMoon-afk) - Support development
- [Ko-fi](https://ko-fi.com/substratia) - One-time contributions

## License

MIT
