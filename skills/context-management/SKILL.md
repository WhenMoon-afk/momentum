---
name: context-management
description: Save work snapshots proactively. Restore context instantly after /clear. <5ms vs 30+ second LLM compaction.
---

# Context Management with Momentum

**Core principle:** Save early, save often. Restoring saved snapshots takes <5ms. Losing context costs everything.

## When to Save Snapshots

**PROACTIVELY save at:**
1. **Task completion** - After finishing any discrete piece of work
2. **Before risky changes** - Before refactoring, major edits, or experiments
3. **Key decisions made** - When architecture/design decisions are finalized
4. **Before context gets full** - When conversation is getting long
5. **End of work session** - Before the user leaves

**Importance levels:**
- `critical` - Breaking changes, architecture decisions (always preserved)
- `important` - Major features, significant fixes (high priority)
- `normal` - Standard progress (default)
- `reference` - Research, background info

## When NOT to Save

- Don't save trivial actions (reading a file, small edits)
- Don't save incomplete work without noting it's incomplete
- Don't save duplicate context already in recent snapshots

## How to Save

```
save_snapshot(
  summary: "Implemented JWT auth with refresh tokens",
  context: "Added auth middleware, token refresh endpoint, httpOnly cookies",
  files_touched: ["src/auth.ts", "src/middleware.ts"],
  decisions: ["RS256 signing", "30min access token expiry"],
  next_steps: "Add rate limiting to auth endpoints",
  importance: "important"
)
```

## When to Restore Context

**After `/clear` or context loss:**
1. Announce: "Restoring context from saved snapshots..."
2. Call: `restore_context(importance_level: "important")`
3. Review the restored context
4. Continue work

## Searching Past Context

For specific information about past work:
```
get_context_about(query: "authentication", detailed: true)
```

## Session Management

**At conversation start:**
- Resume existing: `resume_session(project_path: "/path/to/project")`
- Or start new: `start_session(project_path: "/path/to/project")`

## Performance

| Operation | Time | vs LLM Compaction |
|-----------|------|-------------------|
| Save | <1ms | N/A |
| Restore | <5ms | 6000-12000x faster |
