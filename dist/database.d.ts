/**
 * Momentum - SQLite database layer
 * Stores incremental snapshots for fast context compacting
 * Using better-sqlite3 for cross-platform Node.js compatibility
 */
import { Snapshot, SaveSnapshotInput, CompactResult, SessionStats } from './types.js';
export declare class MomentumDatabase {
    private db;
    constructor(dbPath: string);
    /**
     * Configure SQLite for robustness and performance
     */
    private configurePragmas;
    private initializeSchema;
    /**
     * Run schema migrations for existing databases
     */
    private runMigrations;
    /**
     * Get or create a session ID based on current context
     */
    getOrCreateSession(sessionId?: string, projectPath?: string): string;
    private generateSessionId;
    /**
     * Find the most recent session for a project path
     */
    findSessionByProject(projectPath: string): string | null;
    /**
     * Health check - verify database is accessible and valid
     */
    healthCheck(): {
        ok: boolean;
        details: Record<string, unknown>;
    };
    /**
     * Get next sequence number for a session (atomic with INSERT)
     * Note: This is called within saveSnapshot's transaction for safety
     */
    private getNextSequence;
    /**
     * Format structured context into string
     */
    private formatContext;
    /**
     * Estimate token count (rough: ~4 chars per token)
     */
    private estimateTokens;
    /**
     * Save a new snapshot (wrapped in transaction for atomicity)
     */
    saveSnapshot(input: SaveSnapshotInput): Snapshot;
    /**
     * Get snapshot by ID
     */
    getSnapshotById(id: number): Snapshot | undefined;
    /**
     * List snapshots for a session
     */
    listSnapshots(sessionId?: string, limit?: number): Snapshot[];
    /**
     * Get importance weight for sorting
     */
    private getImportanceWeight;
    /**
     * Get compacted context by concatenating snapshots
     * Uses importance-weighted, newest-first ordering to prioritize valuable context
     * This is the key function that enables fast compacting!
     */
    getCompactedContext(sessionId?: string, maxTokens?: number): CompactResult;
    /**
     * Format a single snapshot for inclusion in compacted context
     */
    private formatSnapshotForCompact;
    /**
     * Get icon for importance level
     */
    private getImportanceIcon;
    /**
     * Get human-readable time ago string
     */
    private getTimeAgo;
    /**
     * Get session statistics
     */
    getSessionStats(sessionId: string): SessionStats | undefined;
    /**
     * Delete old snapshots to free space
     */
    deleteSnapshots(sessionId?: string, beforeId?: number, keepRecent?: number): number;
    /**
     * Clear all snapshots for a session
     */
    clearSession(sessionId: string): number;
    /**
     * Escape LIKE wildcards to prevent pattern manipulation
     */
    private escapeLikePattern;
    /**
     * Get context for injection - filters by topic and prioritizes critical snapshots
     */
    getContextForInjection(sessionId?: string, options?: {
        topic?: string;
        includeCritical?: boolean;
        maxTokens?: number;
    }): CompactResult;
    /**
     * Format snapshot for injection - more concise than compacted format
     */
    private formatSnapshotForInjection;
    /**
     * List all sessions with statistics
     */
    listSessions(limit?: number): Array<{
        session_id: string;
        project_path: string | null;
        started_at: string;
        last_snapshot_at: string | null;
        snapshot_count: number;
        total_tokens: number;
    }>;
    /**
     * Get unsynced snapshots for cloud sync
     */
    getUnsyncedSnapshots(limit?: number): Array<{
        snapshot: Snapshot;
        projectPath: string | null;
    }>;
    /**
     * Mark a snapshot as synced to cloud
     */
    markSynced(snapshotId: number, cloudId?: string): void;
    /**
     * Mark multiple snapshots as synced
     */
    markMultipleSynced(snapshotIds: number[]): void;
    /**
     * Get count of unsynced snapshots
     */
    getUnsyncedCount(): number;
    /**
     * Mark a snapshot sync as failed with retry tracking
     */
    markSyncFailed(snapshotId: number, error: string): void;
    /**
     * Get snapshots ready for retry (exponential backoff)
     * Backoff: 1min, 2min, 4min, 8min, 16min, then give up (5 retries max)
     */
    getRetryableSnapshots(limit?: number): Array<{
        snapshot: Snapshot;
        projectPath: string | null;
        retries: number;
    }>;
    /**
     * Get count of failed syncs (exceeded max retries)
     */
    getFailedSyncCount(): number;
    /**
     * Reset sync status for failed snapshots (allow manual retry)
     */
    resetFailedSyncs(): number;
    close(): void;
}
//# sourceMappingURL=database.d.ts.map