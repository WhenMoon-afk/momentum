#!/bin/bash
# Momentum Setup Script
# Installs and configures Momentum for Claude Code

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  MOMENTUM SETUP"
echo "  Instant context recovery for Claude Code"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Detect script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Check for bun or node
if command -v bun &> /dev/null; then
    RUNTIME="bun"
    echo "✓ Using Bun runtime"
elif command -v node &> /dev/null; then
    RUNTIME="node"
    echo "✓ Using Node.js runtime"
else
    echo "✗ Error: Neither Bun nor Node.js found"
    echo "  Install Bun: curl -fsSL https://bun.sh/install | bash"
    echo "  Or install Node.js: https://nodejs.org"
    exit 1
fi

# Install dependencies and build
echo ""
echo "Installing dependencies..."
cd "$PROJECT_DIR"

if [ "$RUNTIME" = "bun" ]; then
    bun install
    bun run build
else
    npm install
    npm run build
fi

echo ""
echo "✓ Build complete"

# Determine Claude Code settings path
CLAUDE_SETTINGS_DIR="$HOME/.claude"
CLAUDE_SETTINGS_FILE="$CLAUDE_SETTINGS_DIR/settings.json"

# Create settings directory if needed
mkdir -p "$CLAUDE_SETTINGS_DIR"

# Generate MCP server config
MCP_CONFIG=$(cat <<EOF
{
  "mcpServers": {
    "momentum": {
      "command": "$RUNTIME",
      "args": ["$PROJECT_DIR/dist/index.js"]
    }
  }
}
EOF
)

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  SETUP COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "To enable Momentum in Claude Code, add this to your settings:"
echo ""
echo "File: $CLAUDE_SETTINGS_FILE"
echo ""
echo "$MCP_CONFIG"
echo ""
echo "Or for project-specific: .claude/settings.local.json"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  QUICK START"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "1. Start a session:     start_session(project_path: \"$(pwd)\")"
echo "2. Save snapshots:      save_snapshot(summary: \"...\", context: \"...\")"
echo "3. Restore context:     restore_context()"
echo ""
echo "Performance: <5ms context recovery vs 30+ seconds traditional"
echo ""
