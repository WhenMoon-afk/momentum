#!/usr/bin/env node
/**
 * Momentum - Fast context recovery for Claude Code
 *
 * MCP server with 3 consolidated tools:
 * - save: Save work progress snapshot
 * - restore: Restore context after /clear
 * - momentum: Meta tool for list, search, sessions, health, help
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { homedir } from 'os';
import { join } from 'path';
import { MomentumDatabase } from './database.js';
import { SaveSnapshotInput } from './types.js';

const VERSION = '0.5.0';

// Determine database path
function getDefaultDbPath(): string {
  const base = process.env.MOMENTUM_DB_PATH;
  if (base) return base;

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
      { name: 'momentum', version: VERSION },
      { capabilities: { tools: {} } }
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
    // List available tools - 3 consolidated tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'save',
          description: 'Save work progress snapshot',
          inputSchema: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'Brief summary of work done' },
              context: { type: 'string', description: 'Detailed context to preserve' },
              files_touched: { type: 'array', items: { type: 'string' } },
              decisions: { type: 'array', items: { type: 'string' } },
              next_steps: { type: 'string' },
              importance: { type: 'string', enum: ['critical', 'important', 'normal', 'reference'] },
            },
            required: ['summary', 'context'],
          },
        },
        {
          name: 'restore',
          description: 'Restore context after /clear. Auto-starts session based on cwd if none exists.',
          inputSchema: {
            type: 'object',
            properties: {
              importance_level: { type: 'string', enum: ['critical', 'important', 'all'], default: 'important' },
              max_snapshots: { type: 'number', default: 10 },
              include_summary: { type: 'boolean', default: true },
              project_path: { type: 'string', description: 'Project path to find/create session' },
            },
          },
        },
        {
          name: 'momentum',
          description: 'Meta tool: list snapshots, search, manage sessions, health check, help',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'search', 'sessions', 'health', 'help'],
                description: 'list=snapshots, search=by query, sessions=list/start/resume, health=db check, help=usage',
              },
              query: { type: 'string', description: 'For search action: search query' },
              session_id: { type: 'string', description: 'Target session ID' },
              project_path: { type: 'string', description: 'For sessions action: project path' },
              limit: { type: 'number', description: 'For list/sessions: max results' },
              detailed: { type: 'boolean', description: 'For search: include full content' },
              session_action: { type: 'string', enum: ['list', 'start', 'resume'], description: 'For sessions: sub-action' },
            },
            required: ['action'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'save':
            return this.handleSave(args as SaveArgs);
          case 'restore':
            return this.handleRestore(args as RestoreArgs);
          case 'momentum':
            return this.handleMomentum(args as MomentumArgs);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error: ${message}` }] };
      }
    });
  }

  // ============ SAVE ============
  private async handleSave(args: SaveArgs) {
    if (!args.summary || args.summary.trim() === '') {
      throw new Error('summary is required');
    }
    if (!args.context || args.context.trim() === '') {
      throw new Error('context is required');
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
      content: [{
        type: 'text',
        text: `Snapshot #${snapshot.id} saved (${snapshot.token_estimate} tokens)\nSession: ${snapshot.session_id}`,
      }],
    };
  }

  // ============ RESTORE ============
  private async handleRestore(args: RestoreArgs) {
    const importanceLevel = args.importance_level || 'important';
    const maxSnapshots = args.max_snapshots || 10;
    const includeSummary = args.include_summary !== false;

    // Auto-start/resume session if project_path provided and no session
    if (args.project_path && !this.currentSessionId) {
      const existingSessionId = this.db.findSessionByProject(args.project_path);
      if (existingSessionId) {
        this.currentSessionId = existingSessionId;
      } else {
        this.currentSessionId = this.db.getOrCreateSession(undefined, args.project_path);
      }
    }

    const sessionId = this.currentSessionId;

    if (!sessionId) {
      // Try to find any recent session
      const sessions = this.db.listSessions(1);
      if (sessions.length > 0) {
        this.currentSessionId = sessions[0].session_id;
      } else {
        return {
          content: [{
            type: 'text',
            text: 'No session found. Use save to create snapshots first, or provide project_path.',
          }],
        };
      }
    }

    const snapshots = this.db.listSnapshots(this.currentSessionId!, 100);

    if (snapshots.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No snapshots found. Save snapshots during work to enable context recovery.',
        }],
      };
    }

    // Filter by importance
    const importanceOrder: Record<string, number> = { critical: 4, important: 3, normal: 2, reference: 1 };
    const minImportance = importanceLevel === 'all' ? 0 : (importanceOrder[importanceLevel] || 2);

    const filtered = snapshots
      .filter(s => (importanceOrder[s.importance] || 2) >= minImportance)
      .slice(0, maxSnapshots);

    if (filtered.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No ${importanceLevel} snapshots found. Try importance_level: "all".`,
        }],
      };
    }

    // Build restoration output
    const parts: string[] = [];
    parts.push('# MOMENTUM CONTEXT RESTORATION');
    parts.push(`Session: ${this.currentSessionId}`);
    parts.push(`Snapshots: ${filtered.length} (${importanceLevel})`);
    parts.push('');

    if (includeSummary && filtered.length > 0) {
      parts.push(`## Recent: ${filtered[0].summary}`);
      parts.push(`_${this.getTimeAgo(filtered[0].created_at)}_`);
      if (filtered[0].next_steps) {
        parts.push(`**Next:** ${filtered[0].next_steps}`);
      }
      parts.push('');
    }

    parts.push('## Snapshots');
    for (let i = 0; i < filtered.length; i++) {
      const snap = filtered[i];
      const icon = this.getImportanceIcon(snap.importance);
      const marker = i === 0 ? ' [LATEST]' : '';

      parts.push(`### ${icon} ${snap.summary}${marker}`);
      parts.push(`_${this.getTimeAgo(snap.created_at)}_`);
      parts.push(snap.context);
      if (snap.next_steps) parts.push(`**Next:** ${snap.next_steps}`);
      parts.push('---');
    }

    return { content: [{ type: 'text', text: parts.join('\n') }] };
  }

  // ============ MOMENTUM META TOOL ============
  private async handleMomentum(args: MomentumArgs) {
    switch (args.action) {
      case 'list':
        return this.actionList(args);
      case 'search':
        return this.actionSearch(args);
      case 'sessions':
        return this.actionSessions(args);
      case 'health':
        return this.actionHealth();
      case 'help':
        return this.actionHelp();
      default:
        throw new Error(`Unknown action: ${args.action}. Use: list, search, sessions, health, help`);
    }
  }

  private async actionList(args: MomentumArgs) {
    const snapshots = this.db.listSnapshots(args.session_id || this.currentSessionId || undefined, args.limit || 20);

    if (snapshots.length === 0) {
      return { content: [{ type: 'text', text: 'No snapshots found.' }] };
    }

    const lines = snapshots.map(s =>
      `#${s.id} [${this.getTimeAgo(s.created_at)}] ${this.getImportanceIcon(s.importance)} ${s.summary} (${s.token_estimate} tokens)`
    );

    return {
      content: [{
        type: 'text',
        text: `Found ${snapshots.length} snapshots:\n\n${lines.join('\n')}`,
      }],
    };
  }

  private async actionSearch(args: MomentumArgs) {
    if (!args.query) {
      return { content: [{ type: 'text', text: 'query parameter required for search' }] };
    }

    const query = args.query.toLowerCase().trim();
    const sessionId = args.session_id || this.currentSessionId || undefined;
    const maxSnapshots = args.limit || 5;
    const detailed = args.detailed === true;

    const snapshots = this.db.listSnapshots(sessionId, 100);

    if (snapshots.length === 0) {
      return { content: [{ type: 'text', text: 'No snapshots to search.' }] };
    }

    // Score snapshots by relevance
    const scored = snapshots.map(snap => {
      let score = 0;
      const queryTerms = query.split(/\s+/);

      // Search in summary (highest weight)
      for (const term of queryTerms) {
        if (snap.summary.toLowerCase().includes(term)) score += 3;
        if (snap.context.toLowerCase().includes(term)) score += 2;
      }

      // Importance boost
      const importanceBoost: Record<string, number> = { critical: 2, important: 1.5, normal: 1, reference: 0.5 };
      score *= (importanceBoost[snap.importance] || 1);

      return { snap, score };
    })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnapshots);

    if (scored.length === 0) {
      return { content: [{ type: 'text', text: `No snapshots match "${args.query}".` }] };
    }

    const maxScore = scored[0]?.score || 1;
    const parts: string[] = [`# Search: "${args.query}"`, `Found ${scored.length} match(es)`, ''];

    for (const { snap, score } of scored) {
      const relevance = Math.round((score / maxScore) * 100);
      const icon = this.getImportanceIcon(snap.importance);

      if (detailed) {
        parts.push(`## ${icon} #${snap.id} [${this.getTimeAgo(snap.created_at)}]`);
        parts.push(`Relevance: ${relevance}%`);
        parts.push(`**Summary:** ${snap.summary}`);
        parts.push(snap.context);
        if (snap.next_steps) parts.push(`**Next:** ${snap.next_steps}`);
        parts.push('---');
      } else {
        parts.push(`${icon} #${snap.id} [${this.getTimeAgo(snap.created_at)}] - ${snap.summary} (${relevance}%)`);
      }
    }

    if (!detailed) parts.push('\n_Use detailed: true for full content_');

    return { content: [{ type: 'text', text: parts.join('\n') }] };
  }

  private async actionSessions(args: MomentumArgs) {
    const subAction = args.session_action || 'list';

    if (subAction === 'start') {
      this.currentSessionId = this.db.getOrCreateSession(undefined, args.project_path);
      return {
        content: [{
          type: 'text',
          text: `Started session: ${this.currentSessionId}${args.project_path ? `\nProject: ${args.project_path}` : ''}`,
        }],
      };
    }

    if (subAction === 'resume') {
      if (args.session_id) {
        this.currentSessionId = args.session_id;
        const stats = this.db.getSessionStats(args.session_id);
        return {
          content: [{
            type: 'text',
            text: `Resumed session: ${args.session_id}\nSnapshots: ${stats?.snapshot_count || 0}`,
          }],
        };
      }
      if (args.project_path) {
        const existingId = this.db.findSessionByProject(args.project_path);
        if (existingId) {
          this.currentSessionId = existingId;
          const stats = this.db.getSessionStats(existingId);
          return {
            content: [{
              type: 'text',
              text: `Resumed session for ${args.project_path}\nSession: ${existingId}\nSnapshots: ${stats?.snapshot_count || 0}`,
            }],
          };
        }
        this.currentSessionId = this.db.getOrCreateSession(undefined, args.project_path);
        return {
          content: [{
            type: 'text',
            text: `No existing session. Created: ${this.currentSessionId}`,
          }],
        };
      }
      return { content: [{ type: 'text', text: 'Provide session_id or project_path to resume.' }] };
    }

    // Default: list sessions
    const sessions = this.db.listSessions(args.limit || 20);

    if (sessions.length === 0) {
      return { content: [{ type: 'text', text: 'No sessions found. Save a snapshot to create one.' }] };
    }

    const lines = sessions.map(s => {
      const project = s.project_path?.replace(/^\/home\/[^/]+\//, '~/') || 'No path';
      const active = this.currentSessionId === s.session_id ? ' [ACTIVE]' : '';
      return `${project}${active}\n  ID: ${s.session_id}\n  Snapshots: ${s.snapshot_count} (~${s.total_tokens} tokens)`;
    });

    return {
      content: [{
        type: 'text',
        text: `# Sessions\n\n${lines.join('\n\n')}`,
      }],
    };
  }

  private async actionHealth() {
    const health = this.db.healthCheck();
    const status = health.ok ? 'Healthy' : 'Issues detected';
    const details = Object.entries(health.details)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    return {
      content: [{
        type: 'text',
        text: `Momentum Health: ${status}\n\n${details}`,
      }],
    };
  }

  private async actionHelp() {
    return {
      content: [{
        type: 'text',
        text: `# Momentum - Fast Context Recovery

## Tools

**save** - Save work progress snapshot
  Required: summary, context
  Optional: files_touched, decisions, next_steps, importance

**restore** - Restore context after /clear
  Optional: importance_level (critical/important/all), max_snapshots, project_path

**momentum** - Meta tool for management
  action: list | search | sessions | health | help

  list: Show snapshots (limit, session_id)
  search: Find snapshots (query, detailed, limit)
  sessions: Manage sessions (session_action: list/start/resume)
  health: Database health check
  help: This message

## Workflow
1. Save snapshots at task boundaries
2. Run /clear when context full
3. Call restore to recover context
4. Continue work seamlessly`,
      }],
    };
  }

  // ============ HELPERS ============
  private getImportanceIcon(importance: string): string {
    switch (importance) {
      case 'critical': return '[!]';
      case 'important': return '[*]';
      case 'reference': return '[r]';
      default: return '[-]';
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
    console.error(`[momentum v${VERSION}] Server running`);
    console.error(`[momentum v${VERSION}] Database: ${getDefaultDbPath()}`);
  }
}

// Type definitions for tool arguments
interface SaveArgs {
  summary: string;
  context: string;
  files_touched?: string[];
  decisions?: string[];
  next_steps?: string;
  importance?: 'critical' | 'important' | 'normal' | 'reference';
}

interface RestoreArgs {
  importance_level?: 'critical' | 'important' | 'all';
  max_snapshots?: number;
  include_summary?: boolean;
  project_path?: string;
}

interface MomentumArgs {
  action: 'list' | 'search' | 'sessions' | 'health' | 'help';
  query?: string;
  session_id?: string;
  project_path?: string;
  limit?: number;
  detailed?: boolean;
  session_action?: 'list' | 'start' | 'resume';
}

const server = new MomentumServer();
server.run().catch(console.error);
