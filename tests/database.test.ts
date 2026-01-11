/**
 * Unit tests for MomentumDatabase
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { MomentumDatabase } from '../src/database.js';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), 'test-data', 'vitest');
let testDbPath: string;
let db: MomentumDatabase;

function getTestDbPath(): string {
  return join(TEST_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

beforeEach(() => {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
  testDbPath = getTestDbPath();
  db = new MomentumDatabase(testDbPath);
});

afterEach(() => {
  db.close();
  // Clean up db and WAL files
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  if (existsSync(testDbPath + '-wal')) unlinkSync(testDbPath + '-wal');
  if (existsSync(testDbPath + '-shm')) unlinkSync(testDbPath + '-shm');
});

afterAll(() => {
  // Clean up test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('MomentumDatabase', () => {
  describe('Session Management', () => {
    it('creates a new session with generated ID', () => {
      const sessionId = db.getOrCreateSession();
      expect(sessionId).toMatch(/^session-[a-f0-9-]+$/);
    });

    it('creates a session with custom ID', () => {
      const sessionId = db.getOrCreateSession('my-custom-session');
      expect(sessionId).toBe('my-custom-session');
    });

    it('creates a session with project path', () => {
      const sessionId = db.getOrCreateSession(undefined, '/test/project');
      expect(sessionId).toMatch(/^session-/);
    });

    it('returns existing session if called again', () => {
      const id1 = db.getOrCreateSession('same-session');
      const id2 = db.getOrCreateSession('same-session');
      expect(id1).toBe(id2);
    });

    it('finds session by project path', () => {
      const projectPath = '/test/find-project';
      const sessionId = db.getOrCreateSession(undefined, projectPath);

      // Save a snapshot to update last_snapshot_at
      db.saveSnapshot({
        session_id: sessionId,
        summary: 'test',
        context: 'test context',
      });

      const foundId = db.findSessionByProject(projectPath);
      expect(foundId).toBe(sessionId);
    });

    it('returns null for non-existent project path', () => {
      const found = db.findSessionByProject('/non/existent/path');
      expect(found).toBeNull();
    });
  });

  describe('Snapshot Operations', () => {
    it('saves a snapshot with minimal data', () => {
      const snapshot = db.saveSnapshot({
        summary: 'Test summary',
        context: 'Test context',
      });

      expect(snapshot.id).toBeGreaterThan(0);
      expect(snapshot.summary).toBe('Test summary');
      expect(snapshot.context).toBe('Test context');
      expect(snapshot.sequence).toBe(1);
      expect(snapshot.importance).toBe('normal');
    });

    it('saves a snapshot with all fields', () => {
      const snapshot = db.saveSnapshot({
        summary: 'Full snapshot',
        context: 'Full context',
        files_touched: ['file1.ts', 'file2.ts'],
        decisions: ['Decision 1', 'Decision 2'],
        next_steps: 'Continue work',
        importance: 'important',
      });

      expect(snapshot.files_touched).toBe(JSON.stringify(['file1.ts', 'file2.ts']));
      expect(snapshot.decisions).toBe(JSON.stringify(['Decision 1', 'Decision 2']));
      expect(snapshot.next_steps).toBe('Continue work');
      expect(snapshot.importance).toBe('important');
    });

    it('saves structured context and formats it', () => {
      const snapshot = db.saveSnapshot({
        summary: 'Structured test',
        context: {
          description: 'Main description',
          files: ['a.ts', 'b.ts'],
          decisions: ['chose X'],
          blockers: ['blocker 1'],
          errors_fixed: ['error 1'],
        },
      });

      expect(snapshot.context).toContain('Main description');
      expect(snapshot.context).toContain('a.ts');
      expect(snapshot.context).toContain('chose X');
      expect(snapshot.context).toContain('blocker 1');
      expect(snapshot.context).toContain('error 1');
    });

    it('increments sequence numbers within a session', () => {
      const sessionId = db.getOrCreateSession('seq-test');

      const snap1 = db.saveSnapshot({ session_id: sessionId, summary: 'First', context: 'c1' });
      const snap2 = db.saveSnapshot({ session_id: sessionId, summary: 'Second', context: 'c2' });
      const snap3 = db.saveSnapshot({ session_id: sessionId, summary: 'Third', context: 'c3' });

      expect(snap1.sequence).toBe(1);
      expect(snap2.sequence).toBe(2);
      expect(snap3.sequence).toBe(3);
    });

    it('estimates tokens based on content length', () => {
      const content = 'x'.repeat(400); // ~100 tokens
      const snapshot = db.saveSnapshot({
        summary: content,
        context: content,
      });

      // ~800 chars / 4 ≈ 200 tokens
      expect(snapshot.token_estimate).toBeGreaterThanOrEqual(150);
      expect(snapshot.token_estimate).toBeLessThanOrEqual(250);
    });

    it('validates summary length', () => {
      const longSummary = 'x'.repeat(15000);
      expect(() => db.saveSnapshot({
        summary: longSummary,
        context: 'test',
      })).toThrow(/exceeds maximum length/);
    });

    it('validates context length', () => {
      const longContext = 'x'.repeat(150000);
      expect(() => db.saveSnapshot({
        summary: 'test',
        context: longContext,
      })).toThrow(/exceeds maximum length/);
    });

    it('defaults to normal importance for invalid values', () => {
      const snapshot = db.saveSnapshot({
        summary: 'test',
        context: 'test',
        importance: 'invalid' as any,
      });
      expect(snapshot.importance).toBe('normal');
    });
  });

  describe('Snapshot Retrieval', () => {
    beforeEach(() => {
      const sessionId = db.getOrCreateSession('retrieval-test');
      for (let i = 1; i <= 5; i++) {
        db.saveSnapshot({
          session_id: sessionId,
          summary: `Snapshot ${i}`,
          context: `Context ${i}`,
          importance: i === 1 ? 'critical' : i === 2 ? 'important' : 'normal',
        });
      }
    });

    it('lists snapshots by session', () => {
      const snapshots = db.listSnapshots('retrieval-test');
      expect(snapshots.length).toBe(5);
      // Should be in descending sequence order
      expect(snapshots[0].summary).toBe('Snapshot 5');
    });

    it('respects limit parameter', () => {
      const snapshots = db.listSnapshots('retrieval-test', 2);
      expect(snapshots.length).toBe(2);
    });

    it('gets snapshot by ID', () => {
      const snapshots = db.listSnapshots('retrieval-test', 1);
      const snapshot = db.getSnapshotById(snapshots[0].id);
      expect(snapshot).toBeDefined();
      expect(snapshot?.summary).toBe('Snapshot 5');
    });

    it('returns undefined for non-existent ID', () => {
      const snapshot = db.getSnapshotById(99999);
      expect(snapshot).toBeUndefined();
    });
  });

  describe('Compacted Context', () => {
    beforeEach(() => {
      const sessionId = db.getOrCreateSession('compact-test');
      db.saveSnapshot({ session_id: sessionId, summary: 'Critical item', context: 'Critical content', importance: 'critical' });
      db.saveSnapshot({ session_id: sessionId, summary: 'Important item', context: 'Important content', importance: 'important' });
      db.saveSnapshot({ session_id: sessionId, summary: 'Normal item', context: 'Normal content', importance: 'normal' });
      db.saveSnapshot({ session_id: sessionId, summary: 'Reference item', context: 'Reference content', importance: 'reference' });
    });

    it('returns combined context from snapshots', () => {
      const result = db.getCompactedContext('compact-test');

      expect(result.snapshots_used).toBeGreaterThan(0);
      expect(result.combined_context).toContain('Critical item');
      expect(result.total_tokens).toBeGreaterThan(0);
    });

    it('prioritizes by importance then recency', () => {
      const result = db.getCompactedContext('compact-test', 50000);

      // Critical should appear (prioritized)
      expect(result.combined_context).toContain('Critical');
    });

    it('respects max_tokens limit', () => {
      // Add a lot more content
      const sessionId = db.getOrCreateSession('token-limit-test');
      for (let i = 0; i < 50; i++) {
        db.saveSnapshot({
          session_id: sessionId,
          summary: `Snapshot ${i}`,
          context: 'x'.repeat(1000), // ~250 tokens each
        });
      }

      const result = db.getCompactedContext('token-limit-test', 1000);
      // Should use fewer than all 50 snapshots
      expect(result.snapshots_used).toBeLessThan(50);
      // Should be within limit (with 15% safety margin)
      expect(result.total_tokens).toBeLessThanOrEqual(1000);
    });

    it('returns empty result for non-existent session', () => {
      const result = db.getCompactedContext('non-existent-session');
      expect(result.snapshots_used).toBe(0);
      expect(result.combined_context).toBe('');
    });
  });

  describe('Context Injection', () => {
    beforeEach(() => {
      const sessionId = db.getOrCreateSession('injection-test');
      db.saveSnapshot({ session_id: sessionId, summary: 'Auth implementation', context: 'JWT tokens and refresh flow', importance: 'critical' });
      db.saveSnapshot({ session_id: sessionId, summary: 'Database setup', context: 'PostgreSQL with migrations', importance: 'important' });
      db.saveSnapshot({ session_id: sessionId, summary: 'UI components', context: 'React with TypeScript', importance: 'normal' });
    });

    it('filters by topic', () => {
      const result = db.getContextForInjection('injection-test', {
        topic: 'auth',
        maxTokens: 5000,
      });

      expect(result.combined_context).toContain('Auth');
    });

    it('includes critical snapshots by default', () => {
      const result = db.getContextForInjection('injection-test', {
        includeCritical: true,
        maxTokens: 5000,
      });

      expect(result.combined_context).toContain('Auth');
    });

    it('respects maxTokens limit', () => {
      const result = db.getContextForInjection('injection-test', {
        maxTokens: 100,
      });

      expect(result.total_tokens).toBeLessThanOrEqual(100);
    });
  });

  describe('Session Statistics', () => {
    it('returns stats for session with snapshots', () => {
      const sessionId = db.getOrCreateSession('stats-test');
      db.saveSnapshot({ session_id: sessionId, summary: 's1', context: 'c1' });
      db.saveSnapshot({ session_id: sessionId, summary: 's2', context: 'c2' });

      const stats = db.getSessionStats(sessionId);

      expect(stats).toBeDefined();
      expect(stats?.snapshot_count).toBe(2);
      expect(stats?.total_tokens).toBeGreaterThan(0);
    });

    it('returns undefined for non-existent session', () => {
      const stats = db.getSessionStats('non-existent');
      expect(stats).toBeUndefined();
    });
  });

  describe('Cleanup Operations', () => {
    it('deletes old snapshots keeping recent', () => {
      const sessionId = db.getOrCreateSession('cleanup-test');
      for (let i = 0; i < 10; i++) {
        db.saveSnapshot({ session_id: sessionId, summary: `s${i}`, context: `c${i}` });
      }

      const deleted = db.deleteSnapshots(sessionId, undefined, 3);
      expect(deleted).toBe(7);

      const remaining = db.listSnapshots(sessionId);
      expect(remaining.length).toBe(3);
    });

    it('clears entire session', () => {
      const sessionId = db.getOrCreateSession('clear-test');
      db.saveSnapshot({ session_id: sessionId, summary: 's1', context: 'c1' });
      db.saveSnapshot({ session_id: sessionId, summary: 's2', context: 'c2' });

      const deleted = db.clearSession(sessionId);
      expect(deleted).toBe(2);

      const remaining = db.listSnapshots(sessionId);
      expect(remaining.length).toBe(0);
    });
  });

  describe('List Sessions', () => {
    it('lists all sessions with stats', () => {
      db.getOrCreateSession('session-a', '/project/a');
      db.saveSnapshot({ session_id: 'session-a', summary: 'a', context: 'a' });

      db.getOrCreateSession('session-b', '/project/b');
      db.saveSnapshot({ session_id: 'session-b', summary: 'b', context: 'b' });

      const sessions = db.listSessions();
      expect(sessions.length).toBe(2);
      expect(sessions.some(s => s.session_id === 'session-a')).toBe(true);
      expect(sessions.some(s => s.session_id === 'session-b')).toBe(true);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        db.getOrCreateSession(`list-session-${i}`, `/project/${i}`);
        db.saveSnapshot({ session_id: `list-session-${i}`, summary: `s${i}`, context: `c${i}` });
      }

      const sessions = db.listSessions(2);
      expect(sessions.length).toBe(2);
    });
  });

  describe('Health Check', () => {
    it('returns healthy status', () => {
      const health = db.healthCheck();
      expect(health.ok).toBe(true);
      expect(health.details.integrity).toBe('ok');
    });

    it('includes session and snapshot counts', () => {
      db.saveSnapshot({ summary: 's', context: 'c' });
      const health = db.healthCheck();
      expect(health.details.snapshots).toBeGreaterThanOrEqual(1);
    });
  });
});
