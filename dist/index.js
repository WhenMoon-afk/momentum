#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { homedir } from 'os';
import { join } from 'path';
import { SnapshotDatabase } from './database.js';
const VERSION = '1.0.0';
function getDbPath() {
    if (process.env.SNAPSHOT_DB_PATH)
        return process.env.SNAPSHOT_DB_PATH;
    const platform = process.platform;
    if (platform === 'darwin') {
        return join(homedir(), '.local', 'share', 'momentum', 'snapshots.db');
    }
    else if (platform === 'win32') {
        return join(process.env.APPDATA || homedir(), 'momentum', 'snapshots.db');
    }
    else {
        return join(homedir(), '.local', 'share', 'momentum', 'snapshots.db');
    }
}
class MomentumServer {
    server;
    db;
    constructor() {
        const dbPath = getDbPath();
        this.db = new SnapshotDatabase(dbPath);
        this.server = new Server({ name: 'momentum', version: VERSION }, { capabilities: { tools: {} } });
        this.setupHandlers();
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
    }
    cleanup() {
        this.db.close();
        process.exit(0);
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'save_snapshot',
                    description: 'Save current conversation state',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            summary: {
                                type: 'string',
                                description: 'Summary of work accomplished',
                            },
                            context: {
                                oneOf: [
                                    {
                                        type: 'string',
                                        description: 'Conversation context and state',
                                    },
                                    {
                                        type: 'object',
                                        description: 'Structured context',
                                        properties: {
                                            files: {
                                                type: 'array',
                                                items: { type: 'string' },
                                                description: 'Files modified',
                                            },
                                            decisions: {
                                                type: 'array',
                                                items: { type: 'string' },
                                                description: 'Decisions made',
                                            },
                                            blockers: {
                                                type: 'array',
                                                items: { type: 'string' },
                                                description: 'Blockers',
                                            },
                                            code_state: {
                                                type: 'object',
                                                description: 'Code state',
                                            },
                                        },
                                    },
                                ],
                            },
                            name: {
                                type: 'string',
                                description: 'Optional name for this snapshot',
                            },
                            next_steps: {
                                type: 'string',
                                description: 'Next steps to continue work',
                            },
                        },
                        required: ['summary', 'context'],
                    },
                },
                {
                    name: 'load_snapshot',
                    description: 'Load snapshot by ID, name, or latest',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'number',
                                description: 'Snapshot ID',
                            },
                            name: {
                                type: 'string',
                                description: 'Snapshot name',
                            },
                        },
                    },
                },
                {
                    name: 'list_snapshots',
                    description: 'List all snapshots',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                description: 'Max snapshots to return (default: 100)',
                            },
                        },
                    },
                },
                {
                    name: 'delete_snapshot',
                    description: 'Delete snapshot by ID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'number',
                                description: 'Snapshot ID to delete',
                            },
                        },
                        required: ['id'],
                    },
                },
                {
                    name: 'import_snapshots',
                    description: 'Import snapshots from an external database (e.g., Claude Desktop)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            db_path: {
                                type: 'string',
                                description: 'Path to external snapshots.db. Falls back to SNAPSHOT_DESKTOP_DB env var.',
                            },
                        },
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case 'save_snapshot':
                        return await this.handleSaveSnapshot(args);
                    case 'load_snapshot':
                        return await this.handleLoadSnapshot(args);
                    case 'list_snapshots':
                        return await this.handleListSnapshots(args);
                    case 'delete_snapshot':
                        return await this.handleDeleteSnapshot(args);
                    case 'import_snapshots':
                        return await this.handleImportSnapshots(args);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                };
            }
        });
    }
    async handleSaveSnapshot(args) {
        if (!args.summary || !args.context) {
            throw new Error('summary and context are required');
        }
        const snapshot = this.db.saveSnapshot(args);
        return {
            content: [{
                    type: 'text',
                    text: `Saved snapshot #${snapshot.id}${snapshot.name ? ` (${snapshot.name})` : ''}`,
                }],
        };
    }
    async handleLoadSnapshot(args) {
        let snapshot;
        if (args.id !== undefined) {
            snapshot = this.db.getSnapshotById(args.id);
            if (!snapshot)
                throw new Error(`Snapshot with ID ${args.id} not found`);
        }
        else if (args.name) {
            snapshot = this.db.getSnapshotByName(args.name);
            if (!snapshot)
                throw new Error(`Snapshot with name "${args.name}" not found`);
        }
        else {
            snapshot = this.db.getLatestSnapshot();
            if (!snapshot)
                throw new Error('No snapshots found');
        }
        // Use pre-generated continuation prompt if available, otherwise generate on-the-fly
        let promptText;
        if (snapshot.continuation_prompt && snapshot.continuation_prompt.trim() !== '') {
            promptText = snapshot.continuation_prompt;
        }
        else {
            const prompt = [
                `Resuming: ${snapshot.summary}`,
                '',
                'Context:',
                snapshot.context,
            ];
            if (snapshot.next_steps) {
                prompt.push('', 'Next:', snapshot.next_steps);
            }
            promptText = prompt.join('\n');
        }
        return {
            content: [{ type: 'text', text: promptText }],
        };
    }
    async handleListSnapshots(args) {
        const snapshots = this.db.listSnapshots(args.limit);
        if (snapshots.length === 0) {
            return {
                content: [{ type: 'text', text: 'No snapshots found.' }],
            };
        }
        const lines = snapshots.map((s) => {
            const namePart = s.name ? ` (${s.name})` : '';
            return `#${s.id}${namePart} - ${s.summary} [${s.created_at}]`;
        });
        return {
            content: [{ type: 'text', text: lines.join('\n') }],
        };
    }
    async handleDeleteSnapshot(args) {
        if (args.id === undefined) {
            throw new Error('id is required');
        }
        const deleted = this.db.deleteSnapshot(args.id);
        if (!deleted)
            throw new Error(`Snapshot with ID ${args.id} not found`);
        return {
            content: [{ type: 'text', text: `Deleted snapshot #${args.id}` }],
        };
    }
    async handleImportSnapshots(args) {
        const dbPath = args.db_path || process.env.SNAPSHOT_DESKTOP_DB;
        if (!dbPath) {
            throw new Error('No database path provided. Pass db_path or set SNAPSHOT_DESKTOP_DB environment variable.');
        }
        const result = this.db.importFromExternal(dbPath);
        const parts = [`Imported ${result.imported} snapshot(s), skipped ${result.skipped} duplicate(s).`];
        if (result.errors.length > 0) {
            parts.push(`Errors: ${result.errors.length}`);
            parts.push(...result.errors.map(e => `  - ${e}`));
        }
        return {
            content: [{ type: 'text', text: parts.join('\n') }],
        };
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error(`[momentum v${VERSION}] Server running`);
        console.error(`[momentum v${VERSION}] Database: ${getDbPath()}`);
    }
}
const server = new MomentumServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map