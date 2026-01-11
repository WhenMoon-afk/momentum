# Momentum MCP Tools Reference

## Primary Tools

### save_snapshot
Save current work progress. Call at natural breakpoints.

**Arguments:**
- `summary` (required): Brief description (1-2 sentences)
- `context` (required): Detailed context - string or structured object
- `files_touched`: Array of file paths modified
- `decisions`: Array of key decisions made
- `next_steps`: What should happen next
- `importance`: "critical" | "important" | "normal" | "reference"

### restore_context
Comprehensive context restoration after clearing. Returns formatted timeline with summaries and decisions.

**Arguments:**
- `session_id`: Session to restore (uses current if not specified)
- `importance_level`: "critical" | "important" | "all" (default: "important")
- `max_snapshots`: Maximum snapshots to include (default: 10)
- `include_summary`: Include condensed timeline (default: true)

### get_context_about
Search snapshots for specific topics.

**Arguments:**
- `query` (required): What to search for
- `session_id`: Session to search (uses current if not specified)
- `importance_level`: Minimum importance to include
- `max_snapshots`: Maximum results (default: 5)
- `detailed`: Include full text or just summaries (default: false)

## Session Tools

### start_session
Begin a new session for the project.

**Arguments:**
- `project_path`: Path to the project

### resume_session
Resume a previous session.

**Arguments:**
- `project_path`: Find session by project path
- `session_id`: Or specify exact session ID

### list_sessions
List all saved sessions with statistics.

**Arguments:**
- `limit`: Maximum sessions to return (default: 20)

### get_session_stats
Get statistics for current or specified session.

**Arguments:**
- `session_id`: Session to check (uses current if not specified)

## Utility Tools

### inject_context
Quick context injection for specific topics. Lighter than full restore.

**Arguments:**
- `topic`: Topic to filter for
- `include_critical`: Always include critical snapshots (default: true)
- `max_tokens`: Maximum tokens to inject (default: 5000)

### get_compacted_context
Get concatenated context from all snapshots. Used by hooks.

**Arguments:**
- `session_id`: Session (uses current if not specified)
- `max_tokens`: Maximum tokens (default: 15000)

### list_snapshots
View saved snapshots.

**Arguments:**
- `session_id`: Session to list (all if not specified)
- `limit`: Maximum to return (default: 50)

### cleanup_snapshots
Delete old snapshots, keeping recent ones.

**Arguments:**
- `session_id`: Session to clean
- `keep_recent`: Number to keep (default: 5)

### clear_session
Delete all snapshots for a session.

**Arguments:**
- `session_id`: Session to clear (uses current if not specified)

### health_check
Check database integrity and get statistics.

**Arguments:** None
