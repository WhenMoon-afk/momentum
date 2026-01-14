/**
 * Momentum - SQLite database layer
 * Stores incremental snapshots for fast context compacting
 * Using better-sqlite3 for cross-platform Node.js compatibility
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
// Token estimation safety margin (15%)
const TOKEN_SAFETY_MARGIN = 0.85;
export class MomentumDatabase {
    db;
    constructor(dbPath) {
        const dir = dirname(dbPath);
        if (dir && !existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        this.db = new Database(dbPath);
        this.configurePragmas();
        this.initializeSchema();
    }
    /**
     * Configure SQLite for robustness and performance
     */
    configurePragmas() {
        // WAL mode for better concurrency and crash recovery
        this.db.exec('PRAGMA journal_mode = WAL');
        // Wait up to 5 seconds if database is locked
        this.db.exec('PRAGMA busy_timeout = 5000');
        // Enable foreign keys
        this.db.exec('PRAGMA foreign_keys = ON');
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        summary TEXT NOT NULL,
        context TEXT NOT NULL,
        files_touched TEXT,
        decisions TEXT,
        next_steps TEXT,
        token_estimate INTEGER DEFAULT 0,
        importance TEXT DEFAULT 'normal',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_session
        ON snapshots(session_id, sequence DESC);

      CREATE INDEX IF NOT EXISTS idx_snapshots_created
        ON snapshots(created_at DESC);

      -- Track session metadata
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        project_path TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_snapshot_at TEXT
      );

      -- Schema version for migrations
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO schema_version (version) VALUES (1);
    `);
        // Run migrations for existing databases
        this.runMigrations();
    }
    /**
     * Run schema migrations for existing databases
     */
    runMigrations() {
        // Check current schema version
        const currentVersion = this.db.prepare('SELECT MAX(version) as ver FROM schema_version').get();
        // Migration 2: Add importance column
        if (currentVersion.ver < 2) {
            try {
                this.db.exec(`
          ALTER TABLE snapshots ADD COLUMN importance TEXT DEFAULT 'normal';
        `);
            }
            catch {
                // Column might already exist, ignore
            }
            this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(2);
        }
    }
    /**
     * Get or create a session ID based on current context
     */
    getOrCreateSession(sessionId, projectPath) {
        const id = sessionId || this.generateSessionId();
        const existing = this.db.prepare('SELECT session_id FROM sessions WHERE session_id = ?').get(id);
        if (!existing) {
            this.db.prepare('INSERT INTO sessions (session_id, project_path) VALUES (?, ?)').run(id, projectPath || null);
        }
        return id;
    }
    generateSessionId() {
        // Use UUID for guaranteed uniqueness
        return `session-${randomUUID()}`;
    }
    /**
     * Find the most recent session for a project path
     */
    findSessionByProject(projectPath) {
        const result = this.db.prepare(`
      SELECT session_id FROM sessions
      WHERE project_path = ?
      ORDER BY last_snapshot_at DESC, started_at DESC
      LIMIT 1
    `).get(projectPath);
        return result?.session_id || null;
    }
    /**
     * Health check - verify database is accessible and valid
     */
    healthCheck() {
        try {
            const integrityResult = this.db.prepare('PRAGMA integrity_check').all();
            const isOk = integrityResult[0]?.integrity_check === 'ok';
            const stats = this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM sessions) as session_count,
          (SELECT COUNT(*) FROM snapshots) as snapshot_count,
          (SELECT SUM(token_estimate) FROM snapshots) as total_tokens
      `).get();
            return {
                ok: isOk,
                details: {
                    integrity: integrityResult[0]?.integrity_check,
                    sessions: stats.session_count,
                    snapshots: stats.snapshot_count,
                    total_tokens: stats.total_tokens || 0,
                },
            };
        }
        catch (error) {
            return {
                ok: false,
                details: {
                    error: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }
    /**
     * Get next sequence number for a session (atomic with INSERT)
     * Note: This is called within saveSnapshot's transaction for safety
     */
    getNextSequence(sessionId) {
        const result = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM snapshots WHERE session_id = ?').get(sessionId);
        return result.next_seq;
    }
    /**
     * Format structured context into string
     */
    formatContext(context) {
        if (typeof context === 'string') {
            return context;
        }
        const parts = [];
        if (context.description) {
            parts.push(context.description, '');
        }
        if (context.files && context.files.length > 0) {
            parts.push('Files:', ...context.files.map(f => `  - ${f}`), '');
        }
        if (context.decisions && context.decisions.length > 0) {
            parts.push('Decisions:', ...context.decisions.map(d => `  - ${d}`), '');
        }
        if (context.blockers && context.blockers.length > 0) {
            parts.push('Blockers:', ...context.blockers.map(b => `  - ${b}`), '');
        }
        if (context.errors_fixed && context.errors_fixed.length > 0) {
            parts.push('Errors Fixed:', ...context.errors_fixed.map(e => `  - ${e}`), '');
        }
        if (context.tests) {
            parts.push(`Tests: ${context.tests.passing} passing, ${context.tests.failing} failing`, '');
        }
        if (context.code_state && Object.keys(context.code_state).length > 0) {
            parts.push('Code State:', JSON.stringify(context.code_state, null, 2), '');
        }
        // Handle any additional custom fields
        const knownFields = ['description', 'files', 'decisions', 'blockers', 'errors_fixed', 'tests', 'code_state'];
        for (const [key, value] of Object.entries(context)) {
            if (!knownFields.includes(key) && value !== undefined) {
                parts.push(`${key}:`, typeof value === 'string' ? value : JSON.stringify(value, null, 2), '');
            }
        }
        return parts.join('\n').trim();
    }
    /**
     * Estimate token count (rough: ~4 chars per token)
     */
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
    /**
     * Save a new snapshot (wrapped in transaction for atomicity)
     */
    saveSnapshot(input) {
        // Validate input lengths to prevent DoS
        const MAX_SUMMARY_LENGTH = 10000;
        const MAX_CONTEXT_LENGTH = 100000;
        const MAX_NEXT_STEPS_LENGTH = 5000;
        if (input.summary && input.summary.length > MAX_SUMMARY_LENGTH) {
            throw new Error(`summary exceeds maximum length of ${MAX_SUMMARY_LENGTH} characters`);
        }
        const formattedContext = this.formatContext(input.context);
        if (formattedContext.length > MAX_CONTEXT_LENGTH) {
            throw new Error(`context exceeds maximum length of ${MAX_CONTEXT_LENGTH} characters`);
        }
        if (input.next_steps && input.next_steps.length > MAX_NEXT_STEPS_LENGTH) {
            throw new Error(`next_steps exceeds maximum length of ${MAX_NEXT_STEPS_LENGTH} characters`);
        }
        // Validate importance level
        const validImportance = ['critical', 'important', 'normal', 'reference'];
        const importance = validImportance.includes(input.importance || '')
            ? input.importance
            : 'normal';
        const tokenEstimate = input.token_estimate ||
            this.estimateTokens(input.summary + formattedContext + (input.next_steps || ''));
        // Use transaction for atomicity (prevents race condition in sequence assignment)
        const insertSnapshot = this.db.transaction(() => {
            const sessionId = this.getOrCreateSession(input.session_id);
            const sequence = this.getNextSequence(sessionId);
            this.db.prepare(`
        INSERT INTO snapshots (
          session_id, sequence, summary, context,
          files_touched, decisions, next_steps, token_estimate, importance
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, sequence, input.summary, formattedContext, input.files_touched ? JSON.stringify(input.files_touched) : null, input.decisions ? JSON.stringify(input.decisions) : null, input.next_steps || null, tokenEstimate, importance);
            // Get the last inserted row ID
            const lastId = this.db.prepare('SELECT last_insert_rowid() as id').get();
            // Update session last_snapshot_at
            this.db.prepare("UPDATE sessions SET last_snapshot_at = datetime('now') WHERE session_id = ?").run(sessionId);
            return lastId.id;
        });
        const snapshotId = insertSnapshot();
        return this.getSnapshotById(snapshotId);
    }
    /**
     * Get snapshot by ID
     */
    getSnapshotById(id) {
        const result = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id);
        return result ?? undefined;
    }
    /**
     * List snapshots for a session
     */
    listSnapshots(sessionId, limit = 50) {
        if (sessionId) {
            return this.db.prepare('SELECT * FROM snapshots WHERE session_id = ? ORDER BY sequence DESC LIMIT ?').all(sessionId, limit);
        }
        return this.db.prepare('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT ?').all(limit);
    }
    /**
     * Get importance weight for sorting
     */
    getImportanceWeight(importance) {
        switch (importance) {
            case 'critical': return 4;
            case 'important': return 3;
            case 'normal': return 2;
            case 'reference': return 1;
            default: return 2;
        }
    }
    /**
     * Get compacted context by concatenating snapshots
     * Uses importance-weighted, newest-first ordering to prioritize valuable context
     * This is the key function that enables fast compacting!
     */
    getCompactedContext(sessionId, maxTokens = 15000) {
        // Apply safety margin to prevent overflow
        const effectiveMaxTokens = Math.floor(maxTokens * TOKEN_SAFETY_MARGIN);
        // Get snapshots - order by importance then recency
        // Critical/important snapshots are prioritized even if older
        const snapshots = sessionId
            ? this.db.prepare(`
          SELECT * FROM snapshots WHERE session_id = ?
          ORDER BY
            CASE importance
              WHEN 'critical' THEN 4
              WHEN 'important' THEN 3
              WHEN 'normal' THEN 2
              WHEN 'reference' THEN 1
              ELSE 2
            END DESC,
            sequence DESC
        `).all(sessionId)
            : this.db.prepare(`
          SELECT * FROM snapshots
          ORDER BY
            CASE importance
              WHEN 'critical' THEN 4
              WHEN 'important' THEN 3
              WHEN 'normal' THEN 2
              WHEN 'reference' THEN 1
              ELSE 2
            END DESC,
            created_at DESC
        `).all();
        if (snapshots.length === 0) {
            return {
                combined_context: '',
                snapshots_used: 0,
                total_tokens: 0,
                oldest_snapshot: '',
                newest_snapshot: '',
            };
        }
        // Build combined context from newest to oldest, respecting token limit
        const parts = [];
        let totalTokens = 0;
        let snapshotsUsed = 0;
        let oldestUsedIdx = 0;
        for (let i = 0; i < snapshots.length; i++) {
            const snap = snapshots[i];
            const snapText = this.formatSnapshotForCompact(snap, i === 0);
            const snapTokens = this.estimateTokens(snapText);
            if (totalTokens + snapTokens > effectiveMaxTokens && snapshotsUsed > 0) {
                // Would exceed limit, stop here
                break;
            }
            parts.push(snapText);
            totalTokens += snapTokens;
            snapshotsUsed++;
            oldestUsedIdx = i;
        }
        // Reverse to chronological order for readability
        parts.reverse();
        return {
            combined_context: parts.join('\n\n---\n\n'),
            snapshots_used: snapshotsUsed,
            total_tokens: totalTokens,
            oldest_snapshot: snapshots[oldestUsedIdx].created_at,
            newest_snapshot: snapshots[0].created_at,
        };
    }
    /**
     * Format a single snapshot for inclusion in compacted context
     */
    formatSnapshotForCompact(snapshot, isNewest = false) {
        const timeAgo = this.getTimeAgo(snapshot.created_at);
        const marker = isNewest ? ' [LATEST]' : '';
        const importanceIcon = this.getImportanceIcon(snapshot.importance);
        const parts = [
            `## ${importanceIcon} ${snapshot.summary}${marker}`,
            `_${timeAgo}_`,
            '',
            snapshot.context,
        ];
        if (snapshot.next_steps) {
            parts.push('', `**Next:** ${snapshot.next_steps}`);
        }
        return parts.join('\n');
    }
    /**
     * Get icon for importance level
     */
    getImportanceIcon(importance) {
        switch (importance) {
            case 'critical': return '🔴';
            case 'important': return '🟡';
            case 'reference': return '📎';
            default: return '○';
        }
    }
    /**
     * Get human-readable time ago string
     */
    getTimeAgo(timestamp) {
        const now = new Date();
        const then = new Date(timestamp + 'Z'); // SQLite stores UTC
        const diffMs = now.getTime() - then.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        if (diffMins < 1)
            return 'just now';
        if (diffMins < 60)
            return `${diffMins}m ago`;
        if (diffHours < 24)
            return `${diffHours}h ago`;
        if (diffDays < 7)
            return `${diffDays}d ago`;
        return then.toLocaleDateString();
    }
    /**
     * Get session statistics
     */
    getSessionStats(sessionId) {
        const result = this.db.prepare(`
      SELECT
        session_id,
        COUNT(*) as snapshot_count,
        SUM(token_estimate) as total_tokens,
        MIN(created_at) as first_snapshot,
        MAX(created_at) as last_snapshot
      FROM snapshots
      WHERE session_id = ?
      GROUP BY session_id
    `).get(sessionId);
        return result ?? undefined;
    }
    /**
     * Delete old snapshots to free space
     */
    deleteSnapshots(sessionId, beforeId, keepRecent = 5) {
        if (sessionId && keepRecent > 0) {
            // Keep N most recent for session, delete rest
            const result = this.db.prepare(`
        DELETE FROM snapshots
        WHERE session_id = ?
        AND id NOT IN (
          SELECT id FROM snapshots
          WHERE session_id = ?
          ORDER BY sequence DESC
          LIMIT ?
        )
      `).run(sessionId, sessionId, keepRecent);
            return result.changes;
        }
        if (beforeId) {
            const result = this.db.prepare('DELETE FROM snapshots WHERE id < ?').run(beforeId);
            return result.changes;
        }
        return 0;
    }
    /**
     * Clear all snapshots for a session
     */
    clearSession(sessionId) {
        const result = this.db.prepare('DELETE FROM snapshots WHERE session_id = ?').run(sessionId);
        this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
        return result.changes;
    }
    /**
     * Escape LIKE wildcards to prevent pattern manipulation
     */
    escapeLikePattern(input) {
        return input.replace(/[%_\\]/g, '\\$&');
    }
    /**
     * Get context for injection - filters by topic and prioritizes critical snapshots
     */
    getContextForInjection(sessionId, options = {}) {
        const { topic, includeCritical = true, maxTokens = 5000 } = options;
        const effectiveMaxTokens = Math.floor(maxTokens * TOKEN_SAFETY_MARGIN);
        let snapshots;
        if (topic) {
            // Search for topic in summary and context (escape wildcards)
            const escapedTopic = this.escapeLikePattern(topic);
            const searchPattern = `%${escapedTopic}%`;
            snapshots = sessionId
                ? this.db.prepare(`
            SELECT * FROM snapshots
            WHERE session_id = ?
              AND (summary LIKE ? ESCAPE '\\' OR context LIKE ? ESCAPE '\\' OR importance = 'critical')
            ORDER BY
              CASE importance WHEN 'critical' THEN 4 WHEN 'important' THEN 3 ELSE 2 END DESC,
              sequence DESC
          `).all(sessionId, searchPattern, searchPattern)
                : this.db.prepare(`
            SELECT * FROM snapshots
            WHERE summary LIKE ? ESCAPE '\\' OR context LIKE ? ESCAPE '\\' OR importance = 'critical'
            ORDER BY
              CASE importance WHEN 'critical' THEN 4 WHEN 'important' THEN 3 ELSE 2 END DESC,
              created_at DESC
          `).all(searchPattern, searchPattern);
        }
        else if (includeCritical) {
            // Get critical/important snapshots only
            snapshots = sessionId
                ? this.db.prepare(`
            SELECT * FROM snapshots
            WHERE session_id = ? AND importance IN ('critical', 'important')
            ORDER BY
              CASE importance WHEN 'critical' THEN 4 ELSE 3 END DESC,
              sequence DESC
          `).all(sessionId)
                : this.db.prepare(`
            SELECT * FROM snapshots
            WHERE importance IN ('critical', 'important')
            ORDER BY
              CASE importance WHEN 'critical' THEN 4 ELSE 3 END DESC,
              created_at DESC
          `).all();
        }
        else {
            // Just get recent snapshots
            return this.getCompactedContext(sessionId, maxTokens);
        }
        if (snapshots.length === 0) {
            return {
                combined_context: '',
                snapshots_used: 0,
                total_tokens: 0,
                oldest_snapshot: '',
                newest_snapshot: '',
            };
        }
        // Build combined context respecting token limit
        const parts = [];
        let totalTokens = 0;
        let snapshotsUsed = 0;
        let oldestIdx = 0;
        for (let i = 0; i < snapshots.length; i++) {
            const snap = snapshots[i];
            const snapText = this.formatSnapshotForInjection(snap);
            const snapTokens = this.estimateTokens(snapText);
            if (totalTokens + snapTokens > effectiveMaxTokens && snapshotsUsed > 0) {
                break;
            }
            parts.push(snapText);
            totalTokens += snapTokens;
            snapshotsUsed++;
            oldestIdx = i;
        }
        return {
            combined_context: parts.join('\n\n'),
            snapshots_used: snapshotsUsed,
            total_tokens: totalTokens,
            oldest_snapshot: snapshots[oldestIdx].created_at,
            newest_snapshot: snapshots[0].created_at,
        };
    }
    /**
     * Format snapshot for injection - more concise than compacted format
     */
    formatSnapshotForInjection(snapshot) {
        const icon = this.getImportanceIcon(snapshot.importance);
        const parts = [`### ${icon} ${snapshot.summary}`, snapshot.context];
        if (snapshot.next_steps) {
            parts.push(`→ Next: ${snapshot.next_steps}`);
        }
        return parts.join('\n');
    }
    /**
     * List all sessions with statistics
     */
    listSessions(limit = 20) {
        const safeLimit = Math.min(Math.max(1, limit), 100);
        return this.db.prepare(`
      SELECT
        s.session_id,
        s.project_path,
        s.started_at,
        s.last_snapshot_at,
        COALESCE(stats.snapshot_count, 0) as snapshot_count,
        COALESCE(stats.total_tokens, 0) as total_tokens
      FROM sessions s
      LEFT JOIN (
        SELECT
          session_id,
          COUNT(*) as snapshot_count,
          SUM(token_estimate) as total_tokens
        FROM snapshots
        GROUP BY session_id
      ) stats ON s.session_id = stats.session_id
      ORDER BY s.last_snapshot_at DESC NULLS LAST, s.started_at DESC
      LIMIT ?
    `).all(safeLimit);
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=database.js.map