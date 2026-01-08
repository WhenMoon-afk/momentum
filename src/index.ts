#!/usr/bin/env node
/**
 * Momentum - Fast context compacting for Claude Code
 *
 * MCP server that provides incremental snapshot storage for instant compacting.
 * Instead of waiting for Claude to summarize 190k tokens, concatenate pre-computed snapshots.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { homedir } from 'os';
import { join } from 'path';
import { MomentumDatabase } from './database.js';
import {
  SaveSnapshotInput,
  ListSnapshotsArgs,
  GetCompactedContextArgs,
  DeleteSnapshotsArgs,
  TriggerSnapshotArgs,
  RestoreContextArgs,
  GetContextAboutArgs,
  Snapshot,
} from './types.js';

// Determine database path
function getDefaultDbPath(): string {
  const base = process.env.MOMENTUM_DB_PATH;
  if (base) return base;

  // Platform-specific defaults
  const platform = process.platform;
  if (platform === 'darwin') {
    return join(homedir(), '.local', 'share', 'momentum', 'momentum.db');
  } else if (platform === 'win32') {
    return join(process.env.APPDATA || homedir(), 'momentum', 'momentum.db');
  } else {
    return join(homedir(), '.local', 'share', 'momentum', 'momentum.db');
  }
}

class MomentumServer {
  private server: Server;
  private db: MomentumDatabase;
  private currentSessionId: string | null = null;

  constructor() {
    const dbPath = getDefaultDbPath();
    this.db = new MomentumDatabase(dbPath);

    this.server = new Server(
      {
        name: 'momentum',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();

    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  private cleanup(): void {
    this.db.close();
    process.exit(0);
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'save_snapshot',
          description:
            'Save a snapshot of current work progress. Call this at natural breakpoints (task completion, before risky changes, end of session). Snapshots enable instant compacting later.',
          inputSchema: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'Brief summary of what was accomplished (1-2 sentences)',
              },
              context: {
                oneOf: [
                  { type: 'string', description: 'Free-form context description' },
                  {
                    type: 'object',
                    description: 'Structured context',
                    properties: {
                      description: { type: 'string' },
                      files: { type: 'array', items: { type: 'string' } },
                      decisions: { type: 'array', items: { type: 'string' } },
                      blockers: { type: 'array', items: { type: 'string' } },
                      errors_fixed: { type: 'array', items: { type: 'string' } },
                    },
                  },
                ],
              },
              files_touched: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of files modified',
              },
              decisions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Key decisions made',
              },
              next_steps: {
                type: 'string',
                description: 'What should happen next',
              },
              importance: {
                type: 'string',
                enum: ['critical', 'important', 'normal', 'reference'],
                description: 'How important is this snapshot? critical=must preserve, important=high value, normal=standard, reference=background info',
              },
            },
            required: ['summary', 'context'],
          },
        },
        {
          name: 'get_compacted_context',
          description:
            'Get combined context from all snapshots. Use this for instant compacting instead of LLM summarization. Returns concatenated snapshots within token limit.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Session ID (uses current session if not specified)',
              },
              max_tokens: {
                type: 'number',
                description: 'Maximum tokens to return (default: 15000)',
              },
            },
          },
        },
        {
          name: 'list_snapshots',
          description: 'List saved snapshots for current or specified session',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Session ID (lists all if not specified)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of snapshots to return (default: 50)',
              },
            },
          },
        },
        {
          name: 'start_session',
          description:
            'Start a new snapshot session. Call at the beginning of a work session to group related snapshots.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: {
                type: 'string',
                description: 'Path to the project being worked on',
              },
            },
          },
        },
        {
          name: 'get_session_stats',
          description: 'Get statistics about the current or specified session',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Session ID (uses current session if not specified)',
              },
            },
          },
        },
        {
          name: 'cleanup_snapshots',
          description:
            'Delete old snapshots to free space. Keeps most recent snapshots by default.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Session ID to clean up',
              },
              keep_recent: {
                type: 'number',
                description: 'Number of recent snapshots to keep (default: 5)',
              },
            },
          },
        },
        {
          name: 'clear_session',
          description: 'Delete all snapshots for a session. Use when starting fresh.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Session ID to clear (uses current if not specified)',
              },
            },
          },
        },
        {
          name: 'resume_session',
          description:
            'Resume a previous session for the current project. Useful after restarting Claude Code to continue where you left off.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: {
                type: 'string',
                description: 'Path to the project to find session for',
              },
              session_id: {
                type: 'string',
                description: 'Specific session ID to resume (optional)',
              },
            },
          },
        },
        {
          name: 'health_check',
          description:
            'Check the health of the Momentum database and service. Returns integrity status and statistics.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'inject_context',
          description:
            'Inject relevant context from snapshots into the conversation. Use this AFTER compacting has occurred to restore important context that was lost. Returns a curated summary of key information.',
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'Topic or keyword to search for relevant snapshots (optional)',
              },
              include_critical: {
                type: 'boolean',
                description: 'Always include critical snapshots (default: true)',
              },
              max_tokens: {
                type: 'number',
                description: 'Maximum tokens to inject (default: 5000)',
              },
            },
          },
        },
        {
          name: 'restore_context',
          description:
            'Restore snapshot context after compacting. Use this when you\'ve lost context and need to re-orient. Returns a focused, formatted context injection with summaries and key decisions. More comprehensive than inject_context.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Session ID (uses current session if not specified)',
              },
              importance_level: {
                type: 'string',
                enum: ['critical', 'important', 'all'],
                description: 'Filter snapshots by importance (default: important)',
              },
              max_snapshots: {
                type: 'number',
                description: 'Maximum number of snapshots to include (default: 10)',
              },
              include_summary: {
                type: 'boolean',
                description: 'Include condensed timeline summary (default: true)',
              },
            },
          },
        },
        {
          name: 'get_context_about',
          description:
            'Search snapshots for context about a specific topic. Useful when you need details about a past decision or implementation. Returns matching snapshots ranked by relevance.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'What do you want context about? E.g., "user authentication", "database schema", "error handling"',
              },
              session_id: {
                type: 'string',
                description: 'Session ID (searches current session if not specified)',
              },
              importance_level: {
                type: 'string',
                enum: ['critical', 'important', 'normal', 'any'],
                description: 'Minimum importance level (default: any)',
              },
              max_snapshots: {
                type: 'number',
                description: 'Maximum snapshots to return (default: 5)',
              },
              detailed: {
                type: 'boolean',
                description: 'Include full snapshot text (true) or just summaries (false, default)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_sessions',
          description:
            'List all saved sessions with their statistics. Useful for finding sessions across projects or seeing your session history.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of sessions to return (default: 20, max: 100)',
              },
            },
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'save_snapshot':
            return this.handleSaveSnapshot(args as unknown as TriggerSnapshotArgs);

          case 'get_compacted_context':
            return this.handleGetCompactedContext(args as unknown as GetCompactedContextArgs);

          case 'list_snapshots':
            return this.handleListSnapshots(args as unknown as ListSnapshotsArgs);

          case 'start_session':
            return this.handleStartSession(args as unknown as { project_path?: string });

          case 'get_session_stats':
            return this.handleGetSessionStats(args as unknown as { session_id?: string });

          case 'cleanup_snapshots':
            return this.handleCleanupSnapshots(args as unknown as DeleteSnapshotsArgs);

          case 'clear_session':
            return this.handleClearSession(args as unknown as { session_id?: string });

          case 'resume_session':
            return this.handleResumeSession(args as unknown as { project_path?: string; session_id?: string });

          case 'health_check':
            return this.handleHealthCheck();

          case 'inject_context':
            return this.handleInjectContext(args as unknown as { topic?: string; include_critical?: boolean; max_tokens?: number });

          case 'restore_context':
            return this.handleRestoreContext(args as unknown as RestoreContextArgs);

          case 'get_context_about':
            return this.handleGetContextAbout(args as unknown as GetContextAboutArgs);

          case 'list_sessions':
            return this.handleListSessions(args as unknown as { limit?: number });

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
        };
      }
    });
  }

  private async handleSaveSnapshot(args: TriggerSnapshotArgs) {
    // Validate required fields - check for undefined/null and empty strings
    if (!args.summary || args.summary.trim() === '') {
      throw new Error('summary is required and cannot be empty');
    }
    if (args.context === undefined || args.context === null ||
        (typeof args.context === 'string' && args.context.trim() === '')) {
      throw new Error('context is required and cannot be empty');
    }

    const input: SaveSnapshotInput = {
      session_id: this.currentSessionId || undefined,
      summary: args.summary,
      context: args.context,
      files_touched: args.files_touched,
      decisions: args.decisions,
      next_steps: args.next_steps,
      importance: args.importance,
    };

    const snapshot = this.db.saveSnapshot(input);
    this.currentSessionId = snapshot.session_id;

    return {
      content: [
        {
          type: 'text',
          text: `Snapshot #${snapshot.id} saved (${snapshot.token_estimate} tokens est.)\nSession: ${snapshot.session_id}\nSequence: ${snapshot.sequence}`,
        },
      ],
    };
  }

  private async handleGetCompactedContext(args: GetCompactedContextArgs) {
    const sessionId = args.session_id || this.currentSessionId || undefined;
    const maxTokens = args.max_tokens || 15000;

    const result = this.db.getCompactedContext(sessionId, maxTokens);

    if (result.snapshots_used === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No snapshots found. Save snapshots during your work session to enable fast compacting.',
          },
        ],
      };
    }

    // Return in a format suitable for replacing compacted context
    return {
      content: [
        {
          type: 'text',
          text: `# Session Context (${result.snapshots_used} snapshots, ~${result.total_tokens} tokens)\n\n${result.combined_context}`,
        },
      ],
    };
  }

  private async handleListSnapshots(args: ListSnapshotsArgs) {
    const snapshots = this.db.listSnapshots(args.session_id, args.limit);

    if (snapshots.length === 0) {
      return {
        content: [{ type: 'text', text: 'No snapshots found.' }],
      };
    }

    const lines = snapshots.map(
      (s) =>
        `#${s.id} [${s.created_at}] (${s.token_estimate} tokens)\n  ${s.summary}`
    );

    return {
      content: [
        {
          type: 'text',
          text: `Found ${snapshots.length} snapshots:\n\n${lines.join('\n\n')}`,
        },
      ],
    };
  }

  private async handleStartSession(args: { project_path?: string }) {
    this.currentSessionId = this.db.getOrCreateSession(undefined, args.project_path);

    return {
      content: [
        {
          type: 'text',
          text: `Started session: ${this.currentSessionId}${args.project_path ? `\nProject: ${args.project_path}` : ''}`,
        },
      ],
    };
  }

  private async handleGetSessionStats(args: { session_id?: string }) {
    const sessionId = args.session_id || this.currentSessionId;

    if (!sessionId) {
      return {
        content: [{ type: 'text', text: 'No active session. Start a session or specify session_id.' }],
      };
    }

    const stats = this.db.getSessionStats(sessionId);

    if (!stats) {
      return {
        content: [{ type: 'text', text: `No snapshots found for session: ${sessionId}` }],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Session: ${stats.session_id}\nSnapshots: ${stats.snapshot_count}\nTotal tokens: ~${stats.total_tokens}\nFirst: ${stats.first_snapshot}\nLast: ${stats.last_snapshot}`,
        },
      ],
    };
  }

  private async handleCleanupSnapshots(args: DeleteSnapshotsArgs) {
    const deleted = this.db.deleteSnapshots(
      args.session_id || this.currentSessionId || undefined,
      args.before_id,
      args.keep_recent ?? 5
    );

    return {
      content: [
        {
          type: 'text',
          text: `Deleted ${deleted} old snapshots.`,
        },
      ],
    };
  }

  private async handleClearSession(args: { session_id?: string }) {
    const sessionId = args.session_id || this.currentSessionId;

    if (!sessionId) {
      return {
        content: [{ type: 'text', text: 'No active session to clear.' }],
      };
    }

    const deleted = this.db.clearSession(sessionId);

    if (sessionId === this.currentSessionId) {
      this.currentSessionId = null;
    }

    return {
      content: [
        {
          type: 'text',
          text: `Cleared session ${sessionId} (${deleted} snapshots deleted).`,
        },
      ],
    };
  }

  private async handleResumeSession(args: { project_path?: string; session_id?: string }) {
    // If specific session ID provided, use it directly
    if (args.session_id) {
      this.currentSessionId = args.session_id;
      const stats = this.db.getSessionStats(args.session_id);
      if (stats) {
        return {
          content: [
            {
              type: 'text',
              text: `Resumed session: ${args.session_id}\nSnapshots: ${stats.snapshot_count}\nLast activity: ${stats.last_snapshot}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Resumed session: ${args.session_id} (no existing snapshots)`,
          },
        ],
      };
    }

    // Find session by project path
    if (args.project_path) {
      const existingSessionId = this.db.findSessionByProject(args.project_path);
      if (existingSessionId) {
        this.currentSessionId = existingSessionId;
        const stats = this.db.getSessionStats(existingSessionId);
        return {
          content: [
            {
              type: 'text',
              text: `Resumed session for ${args.project_path}\nSession: ${existingSessionId}\nSnapshots: ${stats?.snapshot_count || 0}\nLast activity: ${stats?.last_snapshot || 'never'}`,
            },
          ],
        };
      }
      // No existing session, create new one
      this.currentSessionId = this.db.getOrCreateSession(undefined, args.project_path);
      return {
        content: [
          {
            type: 'text',
            text: `No existing session found for ${args.project_path}. Created new session: ${this.currentSessionId}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: 'Please provide project_path or session_id to resume a session.',
        },
      ],
    };
  }

  private async handleHealthCheck() {
    const health = this.db.healthCheck();

    const status = health.ok ? '✓ Healthy' : '✗ Issues detected';
    const details = Object.entries(health.details)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Momentum Health Check\n${status}\n\n${details}`,
        },
      ],
    };
  }

  private async handleInjectContext(args: { topic?: string; include_critical?: boolean; max_tokens?: number }) {
    const sessionId = this.currentSessionId || undefined;
    const maxTokens = args.max_tokens || 5000;
    const includeCritical = args.include_critical !== false; // default true

    // Get relevant context from database
    const result = this.db.getContextForInjection(sessionId, {
      topic: args.topic,
      includeCritical,
      maxTokens,
    });

    if (result.snapshots_used === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No relevant context found to inject. Save snapshots during your work to enable context recovery.',
          },
        ],
      };
    }

    // Format for injection - more concise than full compacted context
    const header = args.topic
      ? `## 📥 Context Injection: "${args.topic}"`
      : '## 📥 Context Injection';

    return {
      content: [
        {
          type: 'text',
          text: `${header}\n_Recovered ${result.snapshots_used} snapshots (~${result.total_tokens} tokens)_\n\n${result.combined_context}\n\n---\n_Use this context to continue your work. Key decisions and progress have been restored._`,
        },
      ],
    };
  }

  private async handleRestoreContext(args: RestoreContextArgs) {
    const sessionId = args.session_id || this.currentSessionId;
    const importanceLevel = args.importance_level || 'important';
    const maxSnapshots = args.max_snapshots || 10;
    const includeSummary = args.include_summary !== false;

    if (!sessionId) {
      return {
        content: [{
          type: 'text',
          text: 'No active session. Start a session with start_session or specify session_id to restore context.'
        }],
      };
    }

    // Get snapshots filtered by importance
    const snapshots = this.db.listSnapshots(sessionId, 100);

    if (snapshots.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No snapshots found to restore. Save snapshots during your work to enable context recovery.'
        }],
      };
    }

    // Filter by importance level
    const importanceOrder: Record<string, number> = { critical: 4, important: 3, normal: 2, reference: 1 };
    const minImportance = importanceLevel === 'all' ? 0 : (importanceOrder[importanceLevel] || 2);

    const filtered = snapshots.filter(
      s => (importanceOrder[s.importance] || 2) >= minImportance
    ).slice(0, maxSnapshots);

    if (filtered.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No ${importanceLevel} snapshots found. Try importance_level: "all" to see all snapshots.`
        }],
      };
    }

    // Build restoration output
    const parts: string[] = [];

    // Header
    parts.push('═══════════════════════════════════════════════════════════════════════════');
    parts.push('📥 MOMENTUM CONTEXT RESTORATION');
    parts.push(`Generated: ${new Date().toISOString()}`);
    parts.push(`Session: ${sessionId}`);
    parts.push(`Snapshots: ${filtered.length} (filtered by ${importanceLevel})`);
    parts.push('═══════════════════════════════════════════════════════════════════════════');
    parts.push('');

    // Summary section
    if (includeSummary && filtered.length > 0) {
      parts.push('## 📋 Quick Summary');
      parts.push('');
      parts.push(`**Most Recent:** ${filtered[0].summary}`);
      parts.push(`_${this.getTimeAgo(filtered[0].created_at)}_`);
      parts.push('');

      // Extract unique decisions
      const allDecisions = new Set<string>();
      for (const snap of filtered) {
        if (snap.decisions) {
          try {
            const decisions = JSON.parse(snap.decisions);
            if (Array.isArray(decisions)) {
              decisions.forEach(d => allDecisions.add(d));
            }
          } catch {}
        }
      }

      if (allDecisions.size > 0) {
        parts.push('**Key Decisions Made:**');
        Array.from(allDecisions).slice(0, 5).forEach(d => {
          parts.push(`  • ${d}`);
        });
        parts.push('');
      }

      // Next steps from most recent
      if (filtered[0].next_steps) {
        parts.push(`**Planned Next:** ${filtered[0].next_steps}`);
        parts.push('');
      }
    }

    // Full snapshots
    parts.push('## 📚 Restored Snapshots');
    parts.push('');

    for (let i = 0; i < filtered.length; i++) {
      const snap = filtered[i];
      const icon = this.getImportanceIcon(snap.importance);
      const marker = i === 0 ? ' [LATEST]' : '';

      parts.push(`### ${icon} ${snap.summary}${marker}`);
      parts.push(`_${this.getTimeAgo(snap.created_at)}_`);
      parts.push('');
      parts.push(snap.context);

      if (snap.next_steps) {
        parts.push('');
        parts.push(`**Next:** ${snap.next_steps}`);
      }

      parts.push('');
      parts.push('---');
      parts.push('');
    }

    // Footer
    parts.push('═══════════════════════════════════════════════════════════════════════════');
    parts.push('END: MOMENTUM CONTEXT RESTORATION');
    parts.push('Your context has been restored. Resume work as planned.');
    parts.push('═══════════════════════════════════════════════════════════════════════════');

    return {
      content: [{
        type: 'text',
        text: parts.join('\n'),
      }],
    };
  }

  private async handleGetContextAbout(args: GetContextAboutArgs) {
    const query = args.query.toLowerCase().trim();
    const sessionId = args.session_id || this.currentSessionId || undefined;
    const importanceLevel = args.importance_level || 'any';
    const maxSnapshots = args.max_snapshots || 5;
    const detailed = args.detailed === true;

    if (!query) {
      return {
        content: [{
          type: 'text',
          text: 'Please provide a query to search for. Example: "database", "authentication", "error handling"'
        }],
      };
    }

    // Get snapshots for search
    const snapshots = this.db.listSnapshots(sessionId, 100);

    if (snapshots.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No snapshots found to search. Save snapshots during your work to build searchable context.'
        }],
      };
    }

    // Score snapshots by relevance
    const scored = snapshots.map(snap => {
      let score = 0;
      const queryTerms = query.split(/\s+/);

      // Search in summary (highest weight)
      const summaryLower = snap.summary.toLowerCase();
      for (const term of queryTerms) {
        if (summaryLower.includes(term)) score += 3;
      }

      // Search in context
      const contextLower = snap.context.toLowerCase();
      for (const term of queryTerms) {
        if (contextLower.includes(term)) score += 2;
      }

      // Search in decisions
      if (snap.decisions) {
        try {
          const decisions = JSON.parse(snap.decisions);
          if (Array.isArray(decisions)) {
            const decisionsText = decisions.join(' ').toLowerCase();
            for (const term of queryTerms) {
              if (decisionsText.includes(term)) score += 2;
            }
          }
        } catch {}
      }

      // Search in next_steps
      if (snap.next_steps) {
        const nextLower = snap.next_steps.toLowerCase();
        for (const term of queryTerms) {
          if (nextLower.includes(term)) score += 1;
        }
      }

      // Search in files_touched
      if (snap.files_touched) {
        try {
          const files = JSON.parse(snap.files_touched);
          if (Array.isArray(files)) {
            const filesText = files.join(' ').toLowerCase();
            for (const term of queryTerms) {
              if (filesText.includes(term)) score += 1;
            }
          }
        } catch {}
      }

      // Importance boost
      const importanceBoost: Record<string, number> = {
        critical: 2,
        important: 1.5,
        normal: 1,
        reference: 0.5,
      };
      score *= (importanceBoost[snap.importance] || 1);

      // Recency boost (recent snapshots score higher)
      const ageHours = (Date.now() - new Date(snap.created_at + 'Z').getTime()) / (1000 * 60 * 60);
      const recencyBoost = Math.max(0.5, 2 - ageHours / 24);
      score *= recencyBoost;

      return { snap, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

    // Filter by importance level
    const importanceOrder: Record<string, number> = { critical: 4, important: 3, normal: 2, reference: 1 };
    const minImportance = importanceLevel === 'any' ? 0 : (importanceOrder[importanceLevel] || 0);

    const filtered = scored.filter(
      ({ snap }) => (importanceOrder[snap.importance] || 2) >= minImportance
    ).slice(0, maxSnapshots);

    if (filtered.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No snapshots found matching "${args.query}". Try a different query or use list_snapshots to see what's available.`
        }],
      };
    }

    // Calculate max score for percentage
    const maxScore = filtered[0]?.score || 1;

    // Format response
    const parts: string[] = [];
    parts.push(`# 🔍 Context About: "${args.query}"`);
    parts.push(`Found ${filtered.length} matching snapshot(s)`);
    parts.push('');

    for (const { snap, score } of filtered) {
      const relevance = Math.round((score / maxScore) * 100);
      const icon = this.getImportanceIcon(snap.importance);

      if (detailed) {
        parts.push(`## ${icon} Snapshot #${snap.id} [${this.getTimeAgo(snap.created_at)}]`);
        parts.push(`**Relevance:** ${relevance}%`);
        parts.push('');
        parts.push(`**Summary:** ${snap.summary}`);
        parts.push('');
        parts.push(snap.context);

        if (snap.decisions) {
          try {
            const decisions = JSON.parse(snap.decisions);
            if (Array.isArray(decisions) && decisions.length > 0) {
              parts.push('');
              parts.push('**Decisions:**');
              decisions.forEach(d => parts.push(`  • ${d}`));
            }
          } catch {}
        }

        if (snap.next_steps) {
          parts.push('');
          parts.push(`**Next:** ${snap.next_steps}`);
        }

        parts.push('');
        parts.push('---');
        parts.push('');
      } else {
        parts.push(`${icon} **#${snap.id}** [${this.getTimeAgo(snap.created_at)}] - ${snap.summary}`);
        parts.push(`   Relevance: ${relevance}%`);
        parts.push('');
      }
    }

    if (!detailed) {
      parts.push('_Use detailed: true for full snapshot content_');
    }

    return {
      content: [{
        type: 'text',
        text: parts.join('\n'),
      }],
    };
  }

  private async handleListSessions(args: { limit?: number }) {
    const limit = args.limit || 20;
    const sessions = this.db.listSessions(limit);

    if (sessions.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No sessions found. Use start_session or save a snapshot to create your first session.'
        }],
      };
    }

    const parts: string[] = [];
    parts.push('# 📂 Sessions');
    parts.push(`Found ${sessions.length} session(s)`);
    parts.push('');

    for (const session of sessions) {
      const projectDisplay = session.project_path
        ? session.project_path.replace(/^\/home\/[^/]+\//, '~/')
        : 'No project path';

      const lastActivity = session.last_snapshot_at
        ? this.getTimeAgo(session.last_snapshot_at)
        : 'No snapshots yet';

      const isActive = this.currentSessionId === session.session_id ? ' [ACTIVE]' : '';

      parts.push(`## ${projectDisplay}${isActive}`);
      parts.push(`Session: \`${session.session_id}\``);
      parts.push(`Snapshots: ${session.snapshot_count} (~${session.total_tokens} tokens)`);
      parts.push(`Last activity: ${lastActivity}`);
      parts.push(`Started: ${session.started_at}`);
      parts.push('');
    }

    return {
      content: [{
        type: 'text',
        text: parts.join('\n'),
      }],
    };
  }

  // Helper methods
  private getImportanceIcon(importance: string): string {
    switch (importance) {
      case 'critical': return '🔴';
      case 'important': return '🟡';
      case 'reference': return '📎';
      default: return '○';
    }
  }

  private getTimeAgo(timestamp: string): string {
    const now = new Date();
    const then = new Date(timestamp + 'Z');
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return then.toLocaleDateString();
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Momentum MCP Server running');
    console.error(`Database: ${getDefaultDbPath()}`);
  }
}

const server = new MomentumServer();
server.run().catch(console.error);
