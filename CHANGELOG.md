# Changelog

All notable changes to Momentum will be documented in this file.

## [0.7.0] - 2026-01-15

### Added
- **Substratia Cloud Sync** - Snapshots automatically sync to cloud when API key configured
  - Auto-sync on save (non-blocking)
  - Manual bulk sync via `momentum` tool with `action: sync`
  - Offline-first: saves locally, syncs when connected
- **Cloud health monitoring** - `action: health` now shows cloud connection status
- **Unsynced tracking** - Database tracks which snapshots need cloud sync

### Configuration
To enable cloud sync:
1. Get API key from https://substratia.io/dashboard
2. Set environment variable: `export SUBSTRATIA_API_KEY=sk_your_key`

### Technical
- New `cloud.ts` module for Convex HTTP API integration
- Database migration adds `synced` and `cloud_id` columns
- API endpoints: `/api/snapshots/sync`, `/api/snapshots/bulk-sync`

## [0.6.0] - 2026-01-14

### Changed
- **BREAKING: Node.js Runtime** - Switched from Bun to Node.js for wider compatibility
  - No longer requires Bun pre-installed
  - Uses `better-sqlite3` instead of `bun:sqlite`
  - Auto-install wrapper handles first-run dependency installation (30-60s once)
- **Namespaced Commands** - Commands now use `momentum:` prefix to avoid conflicts
  - `/momentum:save` - Save current context snapshot
  - `/momentum:load` - Load context (default: most recent snapshot)
  - `/momentum:status` - Show session status and recent snapshots

### Removed
- **restore-context agent** - Redundant with MCP `restore` tool
- **Bun runtime requirement** - Now works with Node.js 18+

### Fixed
- Command name conflicts with native Claude Code commands (`/restore` vs `/resume`)
- Base-level command pollution (was `/save`, now `/momentum:save`)
- First-time user experience - no pre-installed runtime required

### Technical
- Runtime: `node` (was `bun`)
- SQLite: `better-sqlite3` (was `bun:sqlite`)
- Entry point: `cli/mcp-server-wrapper.js` with auto-install
- Requires: Node.js v18.0.0+

## [0.5.0] - 2026-01-14

### Changed
- **BREAKING: 3-Tool Consolidation** - Reduced from 13 tools to 3 following obra's Streamlinear pattern
  - `save` - Save work progress snapshot
  - `restore` - Restore context after /clear (auto-starts session)
  - `momentum` - Meta tool for list, search, sessions, health, help
- **~77% token reduction** - Tool definitions now ~900 tokens (down from ~5,200)

### Added
- `/save` command for manual snapshot triggers
- `scripts/release.sh` for automated releases
- Self-documenting `momentum` meta tool with help action

### Fixed
- Version sync between package.json and plugin.json

## [0.4.1] - 2026-01-11

### Fixed
- Plugin.json removed CLAUDE_DATA_DIR dependency
- Fixed duplicate hooks in plugin configuration
- Default database paths now work correctly

## [0.3.0] - 2026-01-11

### Added
- **Bun support** - Migrated from npm to bun for faster installs and builds
- **Comprehensive test suite** - 67 tests (40 vitest + 27 integration)
- **Performance benchmarks** - Documented <5ms retrieval at all token sizes
- **One-command setup** - `./scripts/setup.sh` for easy installation
- **Plugin marketplace support** - Updated plugin.json for marketplace compatibility
- **Importance levels** - Snapshots can be marked critical/important/normal/reference
- **Context search** - `get_context_about` tool for keyword-based search
- **Session management** - `list_sessions`, `resume_session` tools
- **Health check** - Database integrity verification

### Performance
- 10,000 tokens: 0.63ms retrieval (47,619x faster than LLM compaction)
- 50,000 tokens: 1.10ms retrieval (27,273x faster)
- 100,000 tokens: 1.57ms retrieval (19,108x faster)
- 150,000 tokens: 2.86ms retrieval (10,490x faster)

### Technical
- SQLite with WAL mode for concurrent access
- 15% token safety margin on retrieval limits
- Importance-weighted snapshot prioritization
- **Minimal context footprint** - Tool definitions use ~700 tokens (96% smaller than comparable MCPs)

## [0.2.0] - 2026-01-08

### Added
- Initial MCP server implementation
- Core snapshot storage and retrieval
- Session-based organization
- SQLite database layer

## [0.1.0] - 2026-01-08

### Added
- Project scaffolding
- TypeScript configuration
- Basic plugin manifest
