export interface Snapshot {
    id: number;
    name: string | null;
    summary: string;
    context: string;
    next_steps: string | null;
    continuation_prompt: string;
    created_at: string;
}
export interface SaveSnapshotInput {
    name?: string;
    summary: string;
    context: string | StructuredContext;
    next_steps?: string;
}
export interface StructuredContext {
    files?: string[];
    decisions?: string[];
    blockers?: string[];
    code_state?: Record<string, any>;
    [key: string]: any;
}
export interface ImportResult {
    imported: number;
    skipped: number;
    errors: string[];
}
export declare class SnapshotDatabase {
    private db;
    constructor(dbPath: string);
    private initializeSchema;
    private formatStructuredContext;
    private generateContinuationPrompt;
    saveSnapshot(input: SaveSnapshotInput): Snapshot;
    getSnapshotById(id: number): Snapshot | undefined;
    getSnapshotByName(name: string): Snapshot | undefined;
    getLatestSnapshot(): Snapshot | undefined;
    listSnapshots(limit?: number): Snapshot[];
    deleteSnapshot(id: number): boolean;
    /**
     * Import snapshots from an external database (e.g., Claude Desktop's snapshots.db).
     * Opens the external DB in read-only mode to avoid WAL/locking issues on /mnt/c/.
     * Deduplicates on created_at + summary to make imports idempotent.
     */
    importFromExternal(externalDbPath: string): ImportResult;
    close(): void;
}
//# sourceMappingURL=database.d.ts.map