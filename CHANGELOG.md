# Changelog

All notable changes to Momentum will be documented in this file.

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
