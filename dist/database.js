import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
export class SnapshotDatabase {
    db;
    constructor(dbPath) {
        const dir = dirname(dbPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        this.db = new Database(dbPath);
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        summary TEXT NOT NULL,
        context TEXT NOT NULL,
        next_steps TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_created_at
        ON snapshots(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_snapshots_name
        ON snapshots(name) WHERE name IS NOT NULL;
    `);
        // Migration: Add continuation_prompt column if it doesn't exist
        const columns = this.db.pragma('table_info(snapshots)');
        const hasContinuationPrompt = columns.some((col) => col.name === 'continuation_prompt');
        if (!hasContinuationPrompt) {
            this.db.exec(`
        ALTER TABLE snapshots ADD COLUMN continuation_prompt TEXT NOT NULL DEFAULT '';
      `);
        }
    }
    formatStructuredContext(context) {
        if (typeof context === 'string') {
            return context;
        }
        const parts = [];
        if (context.files && context.files.length > 0) {
            parts.push('Files:');
            parts.push(...context.files.map(f => `- ${f}`));
            parts.push('');
        }
        if (context.decisions && context.decisions.length > 0) {
            parts.push('Decisions:');
            parts.push(...context.decisions.map(d => `- ${d}`));
            parts.push('');
        }
        if (context.blockers && context.blockers.length > 0) {
            parts.push('Blockers:');
            parts.push(...context.blockers.map(b => `- ${b}`));
            parts.push('');
        }
        if (context.code_state && Object.keys(context.code_state).length > 0) {
            parts.push('Code State:');
            parts.push(JSON.stringify(context.code_state, null, 2));
            parts.push('');
        }
        // Add any other custom fields
        for (const [key, value] of Object.entries(context)) {
            if (!['files', 'decisions', 'blockers', 'code_state'].includes(key)) {
                parts.push(`${key}:`);
                if (typeof value === 'string') {
                    parts.push(value);
                }
                else {
                    parts.push(JSON.stringify(value, null, 2));
                }
                parts.push('');
            }
        }
        return parts.join('\n').trim();
    }
    generateContinuationPrompt(summary, context, next_steps) {
        const parts = [
            `Resuming: ${summary}`,
            '',
            'Context:',
            context,
        ];
        if (next_steps) {
            parts.push('', 'Next:', next_steps);
        }
        return parts.join('\n');
    }
    saveSnapshot(input) {
        const formattedContext = this.formatStructuredContext(input.context);
        const continuationPrompt = this.generateContinuationPrompt(input.summary, formattedContext, input.next_steps);
        const stmt = this.db.prepare(`
      INSERT INTO snapshots (name, summary, context, next_steps, continuation_prompt)
      VALUES (?, ?, ?, ?, ?)
    `);
        const result = stmt.run(input.name || null, input.summary, formattedContext, input.next_steps || null, continuationPrompt);
        return this.getSnapshotById(result.lastInsertRowid);
    }
    getSnapshotById(id) {
        const stmt = this.db.prepare('SELECT * FROM snapshots WHERE id = ?');
        return stmt.get(id);
    }
    getSnapshotByName(name) {
        const stmt = this.db.prepare('SELECT * FROM snapshots WHERE name = ? ORDER BY created_at DESC, id DESC LIMIT 1');
        return stmt.get(name);
    }
    getLatestSnapshot() {
        const stmt = this.db.prepare('SELECT * FROM snapshots ORDER BY created_at DESC, id DESC LIMIT 1');
        return stmt.get();
    }
    listSnapshots(limit) {
        const stmt = this.db.prepare('SELECT * FROM snapshots ORDER BY created_at DESC, id DESC LIMIT ?');
        return stmt.all(limit || 100);
    }
    deleteSnapshot(id) {
        const stmt = this.db.prepare('DELETE FROM snapshots WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }
    /**
     * Import snapshots from an external database (e.g., Claude Desktop's snapshots.db).
     * Opens the external DB in read-only mode to avoid WAL/locking issues on /mnt/c/.
     * Deduplicates on created_at + summary to make imports idempotent.
     */
    importFromExternal(externalDbPath) {
        if (!existsSync(externalDbPath)) {
            throw new Error(`Database not found: ${externalDbPath}`);
        }
        const externalDb = new Database(externalDbPath, { readonly: true });
        let externalSnapshots;
        try {
            externalSnapshots = externalDb.prepare('SELECT * FROM snapshots ORDER BY created_at ASC').all();
        }
        catch (e) {
            externalDb.close();
            throw new Error(`Failed to read external database: ${e instanceof Error ? e.message : String(e)}`);
        }
        const checkStmt = this.db.prepare('SELECT id FROM snapshots WHERE created_at = ? AND summary = ?');
        const insertStmt = this.db.prepare(`
      INSERT INTO snapshots (name, summary, context, next_steps, continuation_prompt, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        let imported = 0;
        let skipped = 0;
        const errors = [];
        const importAll = this.db.transaction(() => {
            for (const snap of externalSnapshots) {
                try {
                    const existing = checkStmt.get(snap.created_at, snap.summary);
                    if (existing) {
                        skipped++;
                        continue;
                    }
                    insertStmt.run(snap.name || null, snap.summary, snap.context, snap.next_steps || null, snap.continuation_prompt || '', snap.created_at);
                    imported++;
                }
                catch (e) {
                    errors.push(`Snapshot ${snap.id}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        });
        importAll();
        externalDb.close();
        return { imported, skipped, errors };
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=database.js.map