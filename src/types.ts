/**
 * Momentum - Fast context compacting for Claude Code
 * Type definitions
 */

// Snapshot storage types
export interface Snapshot {
  id: number;
  session_id: string;
  sequence: number;
  summary: string;
  context: string;
  files_touched: string | null;
  decisions: string | null;
  next_steps: string | null;
  token_estimate: number;
  importance: string; // 'critical' | 'important' | 'normal' | 'reference'
  created_at: string;
}

// Importance levels for snapshots
export type SnapshotImportance = 'critical' | 'important' | 'normal' | 'reference';

export interface SaveSnapshotInput {
  session_id?: string;
  summary: string;
  context: string | StructuredContext;
  files_touched?: string[];
  decisions?: string[];
  next_steps?: string;
  token_estimate?: number;
  importance?: SnapshotImportance;
}

export interface StructuredContext {
  description?: string;
  files?: string[];
  decisions?: string[];
  blockers?: string[];
  code_state?: Record<string, unknown>;
  errors_fixed?: string[];
  tests?: { passing: number; failing: number };
  [key: string]: unknown;
}

// Compact-related types
export interface CompactResult {
  combined_context: string;
  snapshots_used: number;
  total_tokens: number;
  oldest_snapshot: string;
  newest_snapshot: string;
}

export interface SessionStats {
  session_id: string;
  snapshot_count: number;
  total_tokens: number;
  first_snapshot: string;
  last_snapshot: string;
}

// Hook integration types
export interface PreCompactHookInput {
  trigger: 'auto' | 'manual';
  custom_instructions?: string;
  current_token_count?: number;
}

export interface PreCompactHookOutput {
  // If provided, use this as the compacted context instead of LLM summarization
  override_context?: string;
  // If true, proceed with normal compacting
  proceed?: boolean;
  // Optional message to log
  message?: string;
}

// MCP tool argument types
export interface ListSnapshotsArgs {
  session_id?: string;
  limit?: number;
}

export interface GetCompactedContextArgs {
  session_id?: string;
  max_tokens?: number;
}

export interface DeleteSnapshotsArgs {
  session_id?: string;
  before_id?: number;
  keep_recent?: number;
}

export interface TriggerSnapshotArgs {
  summary: string;
  context: string | StructuredContext;
  files_touched?: string[];
  decisions?: string[];
  next_steps?: string;
  importance?: SnapshotImportance;
}

// Configuration
export interface MomentumConfig {
  db_path: string;
  auto_snapshot_threshold: number; // tokens before suggesting snapshot
  max_snapshot_tokens: number; // target max tokens per snapshot
  compact_concatenation_limit: number; // max snapshots to concatenate
}

export const DEFAULT_CONFIG: MomentumConfig = {
  db_path: '', // Set at runtime based on platform
  auto_snapshot_threshold: 30000,
  max_snapshot_tokens: 2000,
  compact_concatenation_limit: 10,
};

// Context injection types
export interface RestoreContextArgs {
  session_id?: string;
  importance_level?: 'critical' | 'important' | 'all';
  max_snapshots?: number;
  include_summary?: boolean;
}

export interface GetContextAboutArgs {
  query: string;
  session_id?: string;
  importance_level?: 'critical' | 'important' | 'normal' | 'any';
  max_snapshots?: number;
  detailed?: boolean;
}

export interface ScoredSnapshot {
  snapshot: Snapshot;
  score: number;
  relevance_percent: number;
}
