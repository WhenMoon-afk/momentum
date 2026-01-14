#!/usr/bin/env node
/**
 * Momentum MCP Server Wrapper
 * Auto-installs dependencies before starting the server.
 * Based on obra's episodic-memory pattern.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(__dirname);

// Log to stderr (MCP uses stdout for JSON-RPC)
function log(msg) {
  console.error(`[momentum] ${msg}`);
}

/**
 * Run npm install to install dependencies
 */
function runNpmInstall() {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const npmCommand = isWindows ? 'npm.cmd' : 'npm';

    log('Installing dependencies (first run only)...');
    log('This may take 30-60 seconds...');

    const child = spawn(npmCommand, ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd: PLUGIN_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows
    });

    child.stdout.on('data', (data) => {
      process.stderr.write(data);
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        log('Dependencies installed successfully.');
        resolve();
      } else {
        log('ERROR: Failed to install dependencies.');
        log(`Please run manually: cd "${PLUGIN_ROOT}" && npm install`);
        reject(new Error(`npm install failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      log(`ERROR: Failed to run npm install: ${err.message}`);
      reject(err);
    });
  });
}

async function main() {
  try {
    const nodeModulesPath = join(PLUGIN_ROOT, 'node_modules');
    const betterSqlitePath = join(nodeModulesPath, 'better-sqlite3');

    // Install if node_modules is missing OR if better-sqlite3 isn't installed
    if (!existsSync(nodeModulesPath) || !existsSync(betterSqlitePath)) {
      await runNpmInstall();
    }

    // Start the MCP server
    const mcpServerPath = join(PLUGIN_ROOT, 'dist', 'index.js');

    if (!existsSync(mcpServerPath)) {
      log(`ERROR: MCP server not found at ${mcpServerPath}`);
      log('Please run: npm run build');
      process.exit(1);
    }

    const child = spawn(process.execPath, [mcpServerPath], {
      stdio: 'inherit',
      shell: false
    });

    // Forward signals to the child process
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.on('SIGINT', () => child.kill('SIGINT'));

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code || 0);
      }
    });

    child.on('error', (err) => {
      log(`ERROR: Failed to start MCP server: ${err.message}`);
      process.exit(1);
    });

  } catch (error) {
    log(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  log(`Unexpected error: ${error.message}`);
  process.exit(1);
});
