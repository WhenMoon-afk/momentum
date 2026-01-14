---
name: momentum:load
description: Load context (default: most recent snapshot)
argument-hint: "[query or snapshot ID]"
allowed-tools:
  - mcp__plugin_momentum_momentum__restore
---

Call `restore` with importance_level: "important". If args provided, use as search query. Present the restored context summary to user.
