#!/usr/bin/env node
/**
 * Momentum MCP Server Wrapper
 * Auto-installs dependencies and builds before starting the server.
 * Based on obra's episodic-memory pattern.
 */

import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const nodeModulesPath = join(projectRoot, 'node_modules');
const distPath = join(projectRoot, 'dist', 'index.js');

// Log to stderr (MCP uses stdout for JSON-RPC)
function log(msg) {
  console.error(`[momentum] ${msg}`);
}

function hasCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function ensureDependencies() {
  if (existsSync(nodeModulesPath)) {
    return; // Already installed
  }

  log('Installing dependencies...');
  try {
    if (hasCommand('bun')) {
      execSync('bun install', { cwd: projectRoot, stdio: 'pipe' });
    } else if (hasCommand('npm')) {
      execSync('npm install', { cwd: projectRoot, stdio: 'pipe' });
    } else {
      throw new Error('Neither bun nor npm found. Please install Node.js or Bun.');
    }
    log('Dependencies installed.');
  } catch (err) {
    log(`Failed to install dependencies: ${err.message}`);
    process.exit(1);
  }
}

async function ensureBuild() {
  if (existsSync(distPath)) {
    return; // Already built
  }

  log('Building TypeScript...');
  try {
    if (hasCommand('bun')) {
      execSync('bun run build', { cwd: projectRoot, stdio: 'pipe' });
    } else {
      execSync('npm run build', { cwd: projectRoot, stdio: 'pipe' });
    }
    log('Build complete.');
  } catch (err) {
    log(`Failed to build: ${err.message}`);
    process.exit(1);
  }
}

async function startServer() {
  try {
    await ensureDependencies();
    await ensureBuild();
  } catch (err) {
    log(`Setup failed: ${err.message}`);
    process.exit(1);
  }

  // Start the actual MCP server
  const server = spawn('node', [distPath], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: { ...process.env },
  });

  server.on('error', (err) => {
    log(`Server error: ${err.message}`);
    process.exit(1);
  });

  server.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Handle termination signals
  process.on('SIGTERM', () => server.kill('SIGTERM'));
  process.on('SIGINT', () => server.kill('SIGINT'));
}

startServer();
