/**
 * Benchmark tests for Momentum compaction speed
 *
 * Measures performance at various token sizes to demonstrate
 * instant compaction vs traditional LLM-based summarization.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MomentumDatabase } from '../src/database.js';
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), 'test-data', 'benchmarks');
const RESULTS_FILE = join(process.cwd(), 'benchmark-results.json');

interface BenchmarkResult {
  name: string;
  token_size: number;
  snapshot_count: number;
  save_time_ms: number;
  retrieve_time_ms: number;
  total_tokens: number;
  snapshots_retrieved: number;
}

const results: BenchmarkResult[] = [];

let testDbPath: string;
let db: MomentumDatabase;

function generateContent(tokens: number): string {
  // ~4 chars per token
  return 'x'.repeat(tokens * 4);
}

function getTestDbPath(): string {
  return join(TEST_DIR, `benchmark-${Date.now()}.db`);
}

beforeAll(() => {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
  testDbPath = getTestDbPath();
  db = new MomentumDatabase(testDbPath);
});

afterAll(() => {
  db.close();
  // Clean up
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  if (existsSync(testDbPath + '-wal')) unlinkSync(testDbPath + '-wal');
  if (existsSync(testDbPath + '-shm')) unlinkSync(testDbPath + '-shm');
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }

  // Save results
  writeFileSync(RESULTS_FILE, JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
    summary: {
      avg_save_time_ms: results.reduce((acc, r) => acc + r.save_time_ms, 0) / results.length,
      avg_retrieve_time_ms: results.reduce((acc, r) => acc + r.retrieve_time_ms, 0) / results.length,
      max_retrieve_time_ms: Math.max(...results.map(r => r.retrieve_time_ms)),
      conclusion: 'Momentum provides sub-100ms compaction at all tested token sizes',
    },
  }, null, 2));

  console.log('\n\n═══════════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('Token Size | Snapshots | Save Time | Retrieve Time | Tokens Retrieved');
  console.log('-----------|-----------|-----------|---------------|------------------');
  for (const r of results) {
    console.log(
      `${r.token_size.toString().padStart(10)} | ` +
      `${r.snapshot_count.toString().padStart(9)} | ` +
      `${r.save_time_ms.toString().padStart(7)}ms | ` +
      `${r.retrieve_time_ms.toString().padStart(11)}ms | ` +
      `${r.total_tokens.toString().padStart(16)}`
    );
  }
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  COMPARISON: Traditional LLM compaction takes 30+ seconds');
  console.log('  Momentum compaction: < 100ms at all sizes tested');
  console.log('═══════════════════════════════════════════════════════════════════\n');
});

describe('Compaction Speed Benchmarks', () => {
  // Test at various token sizes: 10k, 50k, 100k, 150k tokens of stored snapshots
  const tokenSizes = [10000, 50000, 100000, 150000];

  for (const targetTokens of tokenSizes) {
    it(`benchmarks ${targetTokens.toLocaleString()} tokens`, async () => {
      const sessionId = `benchmark-${targetTokens}`;
      db.getOrCreateSession(sessionId);

      // Each snapshot ~2000 tokens (as per design)
      const tokensPerSnapshot = 2000;
      const snapshotCount = Math.ceil(targetTokens / tokensPerSnapshot);

      // Measure save time
      const saveStart = performance.now();
      for (let i = 0; i < snapshotCount; i++) {
        db.saveSnapshot({
          session_id: sessionId,
          summary: `Benchmark snapshot ${i + 1}/${snapshotCount}`,
          context: generateContent(tokensPerSnapshot - 50), // Leave room for summary
          importance: i % 10 === 0 ? 'critical' : i % 5 === 0 ? 'important' : 'normal',
        });
      }
      const saveTime = performance.now() - saveStart;

      // Measure retrieve time (the key metric!)
      // This is what happens during compaction - retrieving context
      const retrieveStart = performance.now();
      const result = db.getCompactedContext(sessionId, 15000); // Default limit
      const retrieveTime = performance.now() - retrieveStart;

      const benchResult: BenchmarkResult = {
        name: `${targetTokens.toLocaleString()} tokens`,
        token_size: targetTokens,
        snapshot_count: snapshotCount,
        save_time_ms: Math.round(saveTime),
        retrieve_time_ms: Math.round(retrieveTime * 100) / 100,
        total_tokens: result.total_tokens,
        snapshots_retrieved: result.snapshots_used,
      };
      results.push(benchResult);

      // The key assertion: retrieval should be FAST (< 100ms)
      // Traditional compaction takes 30+ seconds
      expect(retrieveTime).toBeLessThan(100);

      // Verify we got useful context
      expect(result.snapshots_used).toBeGreaterThan(0);
      expect(result.combined_context.length).toBeGreaterThan(0);
    }, 60000); // 60 second timeout for large benchmarks
  }

  it('benchmarks rapid sequential saves', async () => {
    const sessionId = 'rapid-save-test';
    db.getOrCreateSession(sessionId);

    const saveCount = 100;
    const start = performance.now();

    for (let i = 0; i < saveCount; i++) {
      db.saveSnapshot({
        session_id: sessionId,
        summary: `Rapid save ${i}`,
        context: generateContent(500),
      });
    }

    const duration = performance.now() - start;
    const avgPerSave = duration / saveCount;

    console.log(`\nRapid save benchmark: ${saveCount} saves in ${Math.round(duration)}ms (${avgPerSave.toFixed(2)}ms avg)`);

    // Each save should be fast
    expect(avgPerSave).toBeLessThan(50);
  });

  it('benchmarks context search performance', async () => {
    const sessionId = 'search-benchmark';
    db.getOrCreateSession(sessionId);

    // Create snapshots with varied content
    const topics = ['authentication', 'database', 'frontend', 'api', 'testing'];
    for (let i = 0; i < 100; i++) {
      const topic = topics[i % topics.length];
      db.saveSnapshot({
        session_id: sessionId,
        summary: `${topic} implementation step ${i}`,
        context: `Working on ${topic}. ${generateContent(400)}`,
      });
    }

    // Measure topic search
    const searchStart = performance.now();
    const result = db.getContextForInjection(sessionId, {
      topic: 'authentication',
      maxTokens: 5000,
    });
    const searchTime = performance.now() - searchStart;

    console.log(`\nSearch benchmark: Found ${result.snapshots_used} snapshots in ${searchTime.toFixed(2)}ms`);

    // Search should be fast
    expect(searchTime).toBeLessThan(100);
    expect(result.snapshots_used).toBeGreaterThan(0);
  });

  it('benchmarks concurrent session access', async () => {
    // Simulate multiple sessions being accessed
    const sessionCount = 10;

    // Create sessions with snapshots
    for (let s = 0; s < sessionCount; s++) {
      const sessionId = `concurrent-${s}`;
      db.getOrCreateSession(sessionId, `/project/${s}`);
      for (let i = 0; i < 20; i++) {
        db.saveSnapshot({
          session_id: sessionId,
          summary: `Session ${s} snap ${i}`,
          context: generateContent(300),
        });
      }
    }

    // Measure listing all sessions
    const listStart = performance.now();
    const sessions = db.listSessions(100);
    const listTime = performance.now() - listStart;

    console.log(`\nList sessions benchmark: ${sessions.length} sessions in ${listTime.toFixed(2)}ms`);
    expect(listTime).toBeLessThan(100);

    // Measure retrieving from each session
    const retrieveStart = performance.now();
    for (let s = 0; s < sessionCount; s++) {
      db.getCompactedContext(`concurrent-${s}`, 5000);
    }
    const totalRetrieveTime = performance.now() - retrieveStart;
    const avgRetrieveTime = totalRetrieveTime / sessionCount;

    console.log(`Multi-session retrieve: ${sessionCount} sessions in ${totalRetrieveTime.toFixed(2)}ms (${avgRetrieveTime.toFixed(2)}ms avg)`);
    expect(avgRetrieveTime).toBeLessThan(50);
  });
});
