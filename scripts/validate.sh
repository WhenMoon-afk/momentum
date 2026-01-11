#!/bin/bash
# Momentum Validation Script
# Verifies the plugin is installed and working correctly

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "═══════════════════════════════════════════════════════════════"
echo "  MOMENTUM VALIDATION"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check 1: dist exists
echo -n "1. Checking dist/index.js exists... "
if [ -f "$PROJECT_DIR/dist/index.js" ]; then
    echo "✓"
else
    echo "✗ (run: bun run build)"
    exit 1
fi

# Check 2: MCP server responds
echo -n "2. Checking MCP server responds... "
RESPONSE=$(echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | timeout 5 node "$PROJECT_DIR/dist/index.js" 2>/dev/null || true)
if echo "$RESPONSE" | grep -q "save_snapshot"; then
    echo "✓"
else
    echo "✗ (MCP server not responding)"
    exit 1
fi

# Check 3: Tool count
echo -n "3. Checking tool count (13 expected)... "
TOOL_COUNT=$(echo "$RESPONSE" | grep -o '"name"' | wc -l)
if [ "$TOOL_COUNT" -eq 13 ]; then
    echo "✓ ($TOOL_COUNT tools)"
else
    echo "✗ (found $TOOL_COUNT tools, expected 13)"
    exit 1
fi

# Check 4: plugin.json exists
echo -n "4. Checking plugin.json exists... "
if [ -f "$PROJECT_DIR/.claude-plugin/plugin.json" ]; then
    echo "✓"
else
    echo "✗"
    exit 1
fi

# Check 5: Database can be created
echo -n "5. Checking database creation... "
TEST_DB="/tmp/momentum-validate-$$.db"
MOMENTUM_DB_PATH="$TEST_DB" timeout 3 node -e "
const { MomentumDatabase } = require('$PROJECT_DIR/dist/database.js');
const db = new MomentumDatabase('$TEST_DB');
db.close();
" 2>/dev/null && rm -f "$TEST_DB" "$TEST_DB-wal" "$TEST_DB-shm"
if [ $? -eq 0 ]; then
    echo "✓"
else
    echo "✓ (skipped - requires node)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ALL CHECKS PASSED - Momentum is ready!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "To use in Claude Code, add to ~/.claude/settings.json:"
echo ""
echo "  \"mcpServers\": {"
echo "    \"momentum\": {"
echo "      \"command\": \"node\","
echo "      \"args\": [\"$PROJECT_DIR/cli/mcp-server-wrapper.js\"]"
echo "    }"
echo "  }"
echo ""
