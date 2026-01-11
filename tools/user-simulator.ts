#!/usr/bin/env npx ts-node
/**
 * User Simulator for Momentum
 *
 * Simulates realistic user workflows to test UX and identify pain points.
 * Provides feedback from the "user perspective" on the experience.
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SimulationScenario {
  name: string;
  description: string;
  steps: SimulationStep[];
}

interface SimulationStep {
  action: string;
  tool?: string;
  args?: object;
  expectation: string;
  userPerspective?: string;
}

interface MCPResponse {
  result?: {
    content?: Array<{ type: string; text: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

interface UXFeedback {
  scenario: string;
  step: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  feedback: string;
  suggestions: string[];
}

class UserSimulator {
  private testDb: string;
  private requestId = 0;
  private feedback: UXFeedback[] = [];

  constructor() {
    const testDir = join(dirname(__dirname), 'test-data');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    this.testDb = join(testDir, `sim-${Date.now()}.db`);
  }

  private async callTool(name: string, args: object = {}): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [join(dirname(__dirname), 'dist', 'index.js')], {
        env: { ...process.env, MOMENTUM_DB_PATH: this.testDb },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let resolved = false;
      const reqId = ++this.requestId;

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === reqId && !resolved) {
              resolved = true;
              proc.kill();
              resolve(parsed);
            }
          } catch {
            // Not complete JSON yet
          }
        }
      });

      proc.on('close', () => {
        if (!resolved) {
          const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
          if (lines.length > 0) {
            try {
              resolve(JSON.parse(lines[0]));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error('No JSON response'));
          }
        }
      });

      proc.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: reqId,
      }) + '\n');
      proc.stdin.end();

      setTimeout(() => {
        if (!resolved) {
          proc.kill();
        }
      }, 10000);
    });
  }

  private evaluateResponse(
    scenario: string,
    step: SimulationStep,
    response: MCPResponse
  ): UXFeedback {
    const text = response.result?.content?.[0]?.text || '';
    // Only count as error if there's an actual JSON-RPC error, not just the word "error" in content
    const hasError = !!response.error;

    let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
    let feedback = '';
    const suggestions: string[] = [];

    // Evaluate from user perspective
    if (hasError) {
      sentiment = 'negative';
      feedback = `Error: ${response.error?.message}`;
      suggestions.push('Improve error messages to be more actionable');
    } else if (text.length < 20) {
      sentiment = 'neutral';
      feedback = 'Response is very brief - user might want more detail';
      suggestions.push('Consider adding more context to confirmations');
    } else if (
      text.includes('saved') ||
      text.includes('Started') ||
      text.includes('Session Context') ||
      text.includes('Resumed') ||
      text.includes('Health Check') ||
      text.includes('snapshots') ||
      text.includes('Deleted') ||
      text.includes('Cleared')
    ) {
      sentiment = 'positive';
      feedback = 'Clear confirmation of action taken';
    }

    // Check against user expectations
    if (step.userPerspective) {
      feedback += ` | User expected: ${step.userPerspective}`;
    }

    return {
      scenario,
      step: step.action,
      sentiment,
      feedback,
      suggestions,
    };
  }

  getScenarios(): SimulationScenario[] {
    return [
      {
        name: 'First-time user onboarding',
        description: 'New user discovers and starts using Momentum',
        steps: [
          {
            action: 'Start a session',
            tool: 'start_session',
            args: { project_path: '/home/user/my-project' },
            expectation: 'Clear confirmation with session ID',
            userPerspective: 'I want to know my session started and what to do next',
          },
          {
            action: 'Save first snapshot',
            tool: 'save_snapshot',
            args: {
              summary: 'Started working on login feature',
              context: 'Created auth module structure, set up JWT dependencies',
              files_touched: ['src/auth/index.ts', 'package.json'],
              next_steps: 'Implement login endpoint',
            },
            expectation: 'Confirmation with token estimate',
            userPerspective: 'Did it save? How much context is stored?',
          },
          {
            action: 'Check what was saved',
            tool: 'list_snapshots',
            args: {},
            expectation: 'List showing the snapshot with summary',
            userPerspective: 'I want to see my saved work at a glance',
          },
          {
            action: 'Get session stats',
            tool: 'get_session_stats',
            args: {},
            expectation: 'Stats showing snapshot count and tokens',
            userPerspective: 'How much have I accumulated? Am I using this right?',
          },
        ],
      },
      {
        name: 'Long coding session workflow',
        description: 'User works for extended period, saving multiple snapshots',
        steps: [
          {
            action: 'Start fresh session',
            tool: 'start_session',
            args: { project_path: '/home/user/big-project' },
            expectation: 'Session started',
            userPerspective: 'Starting a long work session',
          },
          {
            action: 'Save after initial exploration',
            tool: 'save_snapshot',
            args: {
              summary: 'Explored codebase structure',
              context: {
                description: 'Reviewed main modules and architecture',
                files: ['src/index.ts', 'src/api/routes.ts', 'src/models/'],
                decisions: ['Will modify routes.ts for new endpoint'],
              },
            },
            expectation: 'Saved with structured context preserved',
            userPerspective: 'Capturing my mental model of the codebase',
          },
          {
            action: 'Save after first feature',
            tool: 'save_snapshot',
            args: {
              summary: 'Implemented user list endpoint',
              context: 'Added GET /users endpoint with pagination',
              files_touched: ['src/api/routes.ts', 'src/controllers/users.ts'],
              decisions: ['Using cursor-based pagination'],
              next_steps: 'Add filtering and sorting',
            },
            expectation: 'Second snapshot saved',
            userPerspective: 'Milestone reached, want to preserve progress',
          },
          {
            action: 'Save after debugging session',
            tool: 'save_snapshot',
            args: {
              summary: 'Fixed authentication bug',
              context: {
                description: 'Token validation was failing due to timezone issue',
                errors_fixed: ['JWT exp claim timezone mismatch'],
                files: ['src/auth/validate.ts'],
              },
              files_touched: ['src/auth/validate.ts'],
            },
            expectation: 'Bug fix captured',
            userPerspective: 'Important fix - want to remember what caused it',
          },
          {
            action: 'Check accumulated context',
            tool: 'get_compacted_context',
            args: {},
            expectation: 'Combined narrative of session work',
            userPerspective: 'What would Claude see if compacting triggered now?',
          },
          {
            action: 'Review stats',
            tool: 'get_session_stats',
            args: {},
            expectation: '3 snapshots, reasonable token count',
            userPerspective: 'Am I on track? How much context am I building?',
          },
        ],
      },
      {
        name: 'Context overflow prevention',
        description: 'User approaching context limits wants to prepare',
        steps: [
          {
            action: 'Save comprehensive snapshot',
            tool: 'save_snapshot',
            args: {
              summary: 'Full project state before context overflow',
              context: {
                description: 'Complete summary of current work state',
                files: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts'],
                decisions: [
                  'Using PostgreSQL for persistence',
                  'REST API over GraphQL',
                  'Jest for testing',
                  'Docker for deployment',
                ],
                blockers: ['Need to fix flaky test before merge'],
              },
              files_touched: ['many files'],
              next_steps: 'Continue with PR review after compacting',
            },
            expectation: 'Comprehensive snapshot saved',
            userPerspective: 'About to hit context limit, need to save everything important',
          },
          {
            action: 'Get compacted context preview',
            tool: 'get_compacted_context',
            args: { max_tokens: 5000 },
            expectation: 'Condensed but complete context',
            userPerspective: 'What will I retain after compacting? Is anything missing?',
          },
        ],
      },
      {
        name: 'Session cleanup workflow',
        description: 'User finishes project and wants to clean up',
        steps: [
          {
            action: 'Save final snapshot',
            tool: 'save_snapshot',
            args: {
              summary: 'Project completed and deployed',
              context: 'All features implemented, tests passing, deployed to production',
              next_steps: 'Project complete - ready for cleanup',
            },
            expectation: 'Final snapshot saved',
            userPerspective: 'Wrapping up this project',
          },
          {
            action: 'Cleanup old snapshots',
            tool: 'cleanup_snapshots',
            args: { keep_recent: 2 },
            expectation: 'Old snapshots removed',
            userPerspective: 'Keep only recent context, free up space',
          },
          {
            action: 'Clear entire session',
            tool: 'clear_session',
            args: {},
            expectation: 'Session completely cleared',
            userPerspective: 'Fresh start for next project',
          },
        ],
      },
    ];
  }

  async runSimulation(): Promise<void> {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  MOMENTUM USER SIMULATION');
    console.log('  Simulating realistic user workflows');
    console.log('═══════════════════════════════════════════════════════\n');

    for (const scenario of this.getScenarios()) {
      console.log(`\n▶ Scenario: ${scenario.name}`);
      console.log(`  ${scenario.description}\n`);

      for (const step of scenario.steps) {
        console.log(`  → ${step.action}`);

        if (step.tool) {
          try {
            const response = await this.callTool(step.tool, step.args || {});
            const uxFeedback = this.evaluateResponse(scenario.name, step, response);
            this.feedback.push(uxFeedback);

            const icon = uxFeedback.sentiment === 'positive' ? '✓' :
                        uxFeedback.sentiment === 'negative' ? '✗' : '○';
            console.log(`    ${icon} ${uxFeedback.feedback}`);
          } catch (error) {
            console.log(`    ✗ Error: ${error}`);
            this.feedback.push({
              scenario: scenario.name,
              step: step.action,
              sentiment: 'negative',
              feedback: `Simulation error: ${error}`,
              suggestions: ['Fix underlying error'],
            });
          }
        }
      }
    }

    this.printUXReport();
    this.cleanup();
  }

  private printUXReport(): void {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  UX FEEDBACK REPORT');
    console.log('═══════════════════════════════════════════════════════\n');

    const positive = this.feedback.filter(f => f.sentiment === 'positive').length;
    const neutral = this.feedback.filter(f => f.sentiment === 'neutral').length;
    const negative = this.feedback.filter(f => f.sentiment === 'negative').length;

    console.log('Sentiment Distribution:');
    console.log(`  ✓ Positive: ${positive}`);
    console.log(`  ○ Neutral: ${neutral}`);
    console.log(`  ✗ Negative: ${negative}`);
    console.log(`  Overall Score: ${Math.round((positive / this.feedback.length) * 100)}%\n`);

    const allSuggestions = this.feedback
      .flatMap(f => f.suggestions)
      .filter((s, i, arr) => arr.indexOf(s) === i);

    if (allSuggestions.length > 0) {
      console.log('Improvement Suggestions:');
      allSuggestions.forEach(s => console.log(`  • ${s}`));
    }

    if (negative > 0) {
      console.log('\nIssues Found:');
      this.feedback
        .filter(f => f.sentiment === 'negative')
        .forEach(f => console.log(`  - [${f.scenario}] ${f.step}: ${f.feedback}`));
    }
  }

  private cleanup(): void {
    if (existsSync(this.testDb)) {
      unlinkSync(this.testDb);
      console.log(`\nCleaned up simulation database`);
    }
  }
}

// Run simulation
const simulator = new UserSimulator();
simulator.runSimulation().catch(console.error);
