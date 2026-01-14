---
name: context-management
description: Save work snapshots proactively. Restore context instantly after /clear. <5ms vs 30+ second LLM compaction.
---

# Context Management with Momentum

**Core principle:** Save early, save often. Restoring saved snapshots takes <5ms. Losing context costs everything.

## Commands

- `/momentum:save` - Save current context snapshot
- `/momentum:load` - Restore context after /clear
- `/momentum:status` - View session info and recent snapshots

## When to Save

**PROACTIVELY save at:**
1. Task completion - After finishing discrete work
2. Before risky changes - Before refactoring or experiments
3. Key decisions made - Architecture/design finalized
4. Before context gets full - When conversation is long
5. End of work session - Before user leaves

**Importance levels:**
- `critical` - Breaking changes, architecture decisions
- `important` - Major features, significant fixes
- `normal` - Standard progress (default)
- `reference` - Research, background info

## MCP Tools (Direct Use)

**save** - Save snapshot
```
save(summary, context, files_touched?, decisions?, next_steps?, importance?)
```

**restore** - Load context
```
restore(importance_level?, max_snapshots?, project_path?)
```

**momentum** - Meta operations
```
momentum(action: "list" | "search" | "sessions" | "health" | "help", ...)
```

## After /clear

1. Call `restore` with importance_level: "important"
2. Review restored context
3. Continue work

## Performance

| Operation | Time |
|-----------|------|
| Save | <1ms |
| Restore | <5ms |
