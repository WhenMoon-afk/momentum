---
name: save
description: Save current context snapshot to avoid losing work before compaction
allowed-tools:
  - mcp__plugin_momentum_momentum__save
argument-hint: "[optional: summary of what to save]"
---

# Save Context Snapshot

Save the current conversation context to momentum before it gets compacted or cleared.

## Instructions

1. If the user provided a summary in the arguments, use it
2. Otherwise, synthesize a summary of recent work (last 2-3 significant actions)
3. Call `save` with:
   - `summary`: Brief description (1 sentence)
   - `context`: Key details, decisions, file changes
   - `files_touched`: Any files modified recently (if known)
   - `decisions`: Important choices made
   - `next_steps`: What was about to happen next
   - `importance`: "normal" unless user specifies otherwise

4. Confirm to user what was saved

## Example

User runs: `/save implementing auth middleware`

You call:
```
save(
  summary: "Implementing auth middleware",
  context: "Added JWT validation to Express routes, configured token expiry",
  files_touched: ["src/middleware/auth.ts"],
  importance: "normal"
)
```

Then respond: "Saved snapshot: Implementing auth middleware (42 tokens)"
