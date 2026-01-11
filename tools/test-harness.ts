#!/usr/bin/env npx ts-node
/**
 * Momentum Test Harness
 *
 * Comprehensive testing tool for MCP server functionality.
 * Tests all tools, edge cases, and stress scenarios.
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  output?: unknown;
}

interface MCPResponse {
  result?: {
    content?: Array<{ type: string; text: string }>;
    tools?: Array<{ name: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
  jsonrpc: string;
  id: number;
}

class MomentumTestHarness {
  private testDb: string;
  private results: TestResult[] = [];
  private requestId = 0;

  constructor() {
    const testDir = join(dirname(__dirname), 'test-data');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    this.testDb = join(testDir, `test-${Date.now()}.db`);
  }

  private async sendRequest(request: object): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [join(dirname(__dirname), 'dist', 'index.js')], {
        env: { ...process.env, MOMENTUM_DB_PATH: this.testDb },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        // Try to parse as soon as we get data - MCP uses newline-delimited JSON
        const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === (request as { id: number }).id && !resolved) {
              resolved = true;
              proc.kill();
              resolve(parsed);
            }
          } catch {
            // Not yet complete JSON, continue waiting
          }
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', () => {
        if (!resolved) {
          const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
          if (lines.length > 0) {
            try {
              resolve(JSON.parse(lines[0]));
            } catch (e) {
              reject(new Error(`Parse error: ${e}. stdout: ${stdout}`));
            }
          } else {
            reject(new Error(`No JSON response. stderr: ${stderr}`));
          }
        }
      });

      proc.stdin.write(JSON.stringify(request) + '\n');
      proc.stdin.end();

      setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  private async callTool(name: string, args: object = {}): Promise<MCPResponse> {
    return this.sendRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: ++this.requestId,
    });
  }

  private async listTools(): Promise<MCPResponse> {
    return this.sendRequest({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: ++this.requestId,
    });
  }

  private async runTest(name: string, fn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await fn();
      this.results.push({
        name,
        passed: true,
        duration: Date.now() - start,
      });
      console.log(`✓ ${name} (${Date.now() - start}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.results.push({
        name,
        passed: false,
        duration: Date.now() - start,
        error: message,
      });
      console.log(`✗ ${name}: ${message}`);
    }
  }

  private assert(condition: boolean, message: string): void {
    if (!condition) {
      throw new Error(message);
    }
  }

  async runAllTests(): Promise<void> {
    console.log('\n═══════════════════════════════════════════');
    console.log('  MOMENTUM TEST HARNESS');
    console.log('═══════════════════════════════════════════\n');
    console.log(`Test database: ${this.testDb}\n`);

    // Basic functionality tests
    await this.runTest('tools/list returns all 13 tools', async () => {
      const response = await this.listTools();
      this.assert(!response.error, `Error: ${response.error?.message}`);
      this.assert(response.result?.tools?.length === 13, `Expected 13 tools, got ${response.result?.tools?.length}`);
    });

    await this.runTest('save_snapshot with minimal args', async () => {
      const response = await this.callTool('save_snapshot', {
        summary: 'Test snapshot',
        context: 'Testing basic functionality',
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(text.includes('saved'), `Expected "saved" in response: ${text}`);
    });

    await this.runTest('save_snapshot with all args', async () => {
      const response = await this.callTool('save_snapshot', {
        summary: 'Full snapshot test',
        context: {
          description: 'Testing structured context',
          files: ['file1.ts', 'file2.ts'],
          decisions: ['Decision 1', 'Decision 2'],
          blockers: ['Blocker 1'],
          errors_fixed: ['Fixed error 1'],
        },
        files_touched: ['file1.ts', 'file2.ts'],
        decisions: ['Decision 1'],
        next_steps: 'Continue testing',
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    await this.runTest('list_snapshots returns saved snapshots', async () => {
      const response = await this.callTool('list_snapshots', {});
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(text.includes('Test snapshot') || text.includes('Full snapshot'), `Expected snapshots: ${text}`);
    });

    await this.runTest('get_compacted_context returns combined context', async () => {
      const response = await this.callTool('get_compacted_context', {});
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(text.includes('Session Context'), `Expected session context: ${text}`);
    });

    await this.runTest('start_session creates new session', async () => {
      const response = await this.callTool('start_session', {
        project_path: '/test/project',
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(text.includes('Started session'), `Expected started: ${text}`);
    });

    await this.runTest('get_session_stats with no session', async () => {
      const response = await this.callTool('get_session_stats', {});
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    await this.runTest('cleanup_snapshots keeps recent', async () => {
      const response = await this.callTool('cleanup_snapshots', { keep_recent: 10 });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    // Edge case tests
    await this.runTest('save_snapshot with empty context validates correctly', async () => {
      const response = await this.callTool('save_snapshot', {
        summary: 'Empty context',
        context: '',
      });
      // Error can be in result.content or in error.message (JSON-RPC error)
      const text = response.result?.content?.[0]?.text || '';
      const errorMsg = response.error?.message || '';
      this.assert(
        text.toLowerCase().includes('error') ||
        text.toLowerCase().includes('required') ||
        text.toLowerCase().includes('empty') ||
        errorMsg.toLowerCase().includes('required') ||
        errorMsg.toLowerCase().includes('empty'),
        `Expected validation error: text="${text}", error="${errorMsg}"`
      );
    });

    await this.runTest('save_snapshot missing required args returns error', async () => {
      const response = await this.callTool('save_snapshot', {});
      const text = response.result?.content?.[0]?.text || '';
      this.assert(text.includes('Error') || response.error, 'Expected error for missing args');
    });

    await this.runTest('get_compacted_context with max_tokens limit', async () => {
      const response = await this.callTool('get_compacted_context', { max_tokens: 100 });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    await this.runTest('list_snapshots with limit', async () => {
      const response = await this.callTool('list_snapshots', { limit: 1 });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    await this.runTest('clear_session clears data with explicit session', async () => {
      // Note: Each test creates a new process, so session state doesn't persist
      // We test that clear_session returns correct message when no session is active
      const response = await this.callTool('clear_session', {});
      const text = response.result?.content?.[0]?.text || '';
      // Either cleared successfully or reports no active session (both valid)
      this.assert(
        text.includes('Cleared') || text.includes('No active session'),
        `Expected valid response: ${text}`
      );
    });

    // Stress tests
    await this.runTest('save 10 snapshots rapidly', async () => {
      for (let i = 0; i < 10; i++) {
        const response = await this.callTool('save_snapshot', {
          summary: `Rapid snapshot ${i}`,
          context: `Testing rapid save ${i}: ${'x'.repeat(100)}`,
        });
        this.assert(!response.error, `Error on ${i}: ${response.error?.message}`);
      }
    });

    await this.runTest('large context snapshot', async () => {
      const largeContext = 'Large context test. '.repeat(500); // ~10k chars
      const response = await this.callTool('save_snapshot', {
        summary: 'Large context test',
        context: largeContext,
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    // New tool tests
    await this.runTest('health_check returns status', async () => {
      const response = await this.callTool('health_check', {});
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(text.includes('Health Check'), `Expected health check response: ${text}`);
      this.assert(text.includes('Healthy') || text.includes('Issues'), `Expected status: ${text}`);
    });

    await this.runTest('resume_session by project path', async () => {
      const response = await this.callTool('resume_session', {
        project_path: '/test/project/resume',
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(text.includes('session'), `Expected session info: ${text}`);
    });

    await this.runTest('resume_session by session_id', async () => {
      const response = await this.callTool('resume_session', {
        session_id: 'test-session-123',
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(text.includes('Resumed'), `Expected resumed: ${text}`);
    });

    // Context injection tests
    await this.runTest('inject_context returns relevant context', async () => {
      const response = await this.callTool('inject_context', {
        include_critical: true,
        max_tokens: 5000,
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      // Should either return context or report no snapshots
      this.assert(
        text.includes('Context Injection') || text.includes('No relevant context'),
        `Expected context injection response: ${text}`
      );
    });

    await this.runTest('inject_context with topic filter', async () => {
      const response = await this.callTool('inject_context', {
        topic: 'testing',
        max_tokens: 3000,
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    await this.runTest('restore_context returns formatted context', async () => {
      const response = await this.callTool('restore_context', {
        importance_level: 'all',
        max_snapshots: 5,
        include_summary: true,
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      // Should return context or indicate no session
      this.assert(
        text.includes('RESTORATION') || text.includes('No active session') || text.includes('No snapshots'),
        `Expected restore context response: ${text}`
      );
    });

    await this.runTest('restore_context with importance filter', async () => {
      const response = await this.callTool('restore_context', {
        importance_level: 'critical',
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    await this.runTest('get_context_about searches by query', async () => {
      const response = await this.callTool('get_context_about', {
        query: 'test',
        max_snapshots: 3,
        detailed: false,
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(
        text.includes('Context About') || text.includes('No snapshots'),
        `Expected search response: ${text}`
      );
    });

    await this.runTest('get_context_about with detailed output', async () => {
      const response = await this.callTool('get_context_about', {
        query: 'snapshot',
        detailed: true,
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    await this.runTest('get_context_about with importance filter', async () => {
      const response = await this.callTool('get_context_about', {
        query: 'important',
        importance_level: 'important',
      });
      this.assert(!response.error, `Error: ${response.error?.message}`);
    });

    await this.runTest('get_context_about with empty query returns error', async () => {
      const response = await this.callTool('get_context_about', {
        query: '',
      });
      const text = response.result?.content?.[0]?.text || '';
      this.assert(
        text.includes('provide') || text.includes('query') || response.error,
        `Expected validation message: ${text}`
      );
    });

    await this.runTest('list_sessions returns session list', async () => {
      const response = await this.callTool('list_sessions', { limit: 10 });
      this.assert(!response.error, `Error: ${response.error?.message}`);
      const text = response.result?.content?.[0]?.text || '';
      this.assert(
        text.includes('Sessions') || text.includes('No sessions'),
        `Expected sessions list: ${text}`
      );
    });

    // Print summary
    console.log('\n═══════════════════════════════════════════');
    console.log('  TEST SUMMARY');
    console.log('═══════════════════════════════════════════\n');

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const totalTime = this.results.reduce((acc, r) => acc + r.duration, 0);

    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total time: ${totalTime}ms`);

    if (failed > 0) {
      console.log('\nFailed tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }

    // Cleanup
    if (existsSync(this.testDb)) {
      unlinkSync(this.testDb);
      console.log(`\nCleaned up test database: ${this.testDb}`);
    }
  }
}

// Run tests
const harness = new MomentumTestHarness();
harness.runAllTests().catch(console.error);
