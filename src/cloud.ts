/**
 * Momentum Cloud Sync
 * Syncs local snapshots to Substratia Cloud via Convex HTTP API
 */

import { Snapshot } from './types.js';

// Default cloud API endpoint (Convex HTTP actions)
const DEFAULT_API_URL = 'https://agreeable-chameleon-83.convex.site';

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

interface CloudConfig {
  apiKey: string | null;
  apiUrl: string;
  enabled: boolean;
}

/**
 * Get cloud configuration from environment
 */
export function getCloudConfig(): CloudConfig {
  const apiKey = process.env.SUBSTRATIA_API_KEY || null;
  const apiUrl = process.env.SUBSTRATIA_API_URL || DEFAULT_API_URL;

  return {
    apiKey,
    apiUrl,
    enabled: !!apiKey,
  };
}

/**
 * Check if cloud sync is enabled
 */
export function isCloudEnabled(): boolean {
  return !!process.env.SUBSTRATIA_API_KEY;
}

/**
 * Sync a single snapshot to cloud
 */
export async function syncSnapshot(
  snapshot: Snapshot,
  projectPath: string,
  config?: CloudConfig
): Promise<SyncResult> {
  const cfg = config || getCloudConfig();

  if (!cfg.enabled || !cfg.apiKey) {
    return { success: false, error: 'Cloud sync not configured' };
  }

  try {
    const response = await fetch(`${cfg.apiUrl}/api/snapshots/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        projectPath,
        summary: snapshot.summary,
        context: snapshot.context,
        decisions: snapshot.decisions ? JSON.parse(snapshot.decisions) : undefined,
        nextSteps: snapshot.next_steps || undefined,
        filesTouched: snapshot.files_touched ? JSON.parse(snapshot.files_touched) : undefined,
        importance: snapshot.importance || 'normal',
        createdAt: new Date(snapshot.created_at + 'Z').getTime(),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || `HTTP ${response.status}`
      };
    }

    const data = await response.json();
    return {
      success: true,
      snapshotId: data.snapshotId
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error'
    };
  }
}

/**
 * Bulk sync multiple snapshots to cloud
 */
export async function bulkSyncSnapshots(
  snapshots: Array<{ snapshot: Snapshot; projectPath: string }>,
  config?: CloudConfig
): Promise<BulkSyncResult> {
  const cfg = config || getCloudConfig();

  if (!cfg.enabled || !cfg.apiKey) {
    return { success: false, synced: 0, total: snapshots.length, error: 'Cloud sync not configured' };
  }

  if (snapshots.length === 0) {
    return { success: true, synced: 0, total: 0 };
  }

  // Limit to 100 per request (API limit)
  const batch = snapshots.slice(0, 100);

  try {
    const response = await fetch(`${cfg.apiUrl}/api/snapshots/bulk-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        snapshots: batch.map(({ snapshot, projectPath }) => ({
          projectPath,
          summary: snapshot.summary,
          context: snapshot.context,
          decisions: snapshot.decisions ? JSON.parse(snapshot.decisions) : undefined,
          nextSteps: snapshot.next_steps || undefined,
          filesTouched: snapshot.files_touched ? JSON.parse(snapshot.files_touched) : undefined,
          importance: snapshot.importance || 'normal',
          createdAt: new Date(snapshot.created_at + 'Z').getTime(),
        })),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        synced: 0,
        total: batch.length,
        error: errorData.error || `HTTP ${response.status}`
      };
    }

    const data = await response.json();
    return {
      success: true,
      synced: data.synced,
      total: data.total
    };
  } catch (error) {
    return {
      success: false,
      synced: 0,
      total: batch.length,
      error: error instanceof Error ? error.message : 'Network error'
    };
  }
}

/**
 * Check cloud API health
 */
export async function checkCloudHealth(config?: CloudConfig): Promise<{ ok: boolean; error?: string }> {
  const cfg = config || getCloudConfig();

  try {
    const response = await fetch(`${cfg.apiUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { ok: data.status === 'ok' };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Network error'
    };
  }
}
