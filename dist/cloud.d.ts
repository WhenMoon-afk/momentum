/**
 * Momentum Cloud Sync
 * Syncs local snapshots to Substratia Cloud via Convex HTTP API
 */
import { Snapshot } from './types.js';
interface SyncResult {
    success: boolean;
    snapshotId?: string;
    error?: string;
}
interface BulkSyncResult {
    success: boolean;
    synced: number;
    total: number;
    error?: string;
}
export interface CloudConfig {
    apiKey: string | null;
    apiUrl: string;
    enabled: boolean;
}
/**
 * Save API key to config file
 */
export declare function saveApiKey(apiKey: string): {
    success: boolean;
    error?: string;
};
/**
 * Get config file path (for display to user)
 */
export declare function getConfigPath(): string;
/**
 * Get cloud configuration from config file or environment
 * Priority: config file > environment variable
 */
export declare function getCloudConfig(): CloudConfig;
/**
 * Check if cloud sync is enabled
 */
export declare function isCloudEnabled(): boolean;
/**
 * Sync a single snapshot to cloud
 */
export declare function syncSnapshot(snapshot: Snapshot, projectPath: string, config?: CloudConfig): Promise<SyncResult>;
/**
 * Bulk sync multiple snapshots to cloud
 */
export declare function bulkSyncSnapshots(snapshots: Array<{
    snapshot: Snapshot;
    projectPath: string;
}>, config?: CloudConfig): Promise<BulkSyncResult>;
/**
 * Check cloud API health
 */
export declare function checkCloudHealth(config?: CloudConfig): Promise<{
    ok: boolean;
    error?: string;
}>;
export {};
//# sourceMappingURL=cloud.d.ts.map