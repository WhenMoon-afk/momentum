#!/bin/bash
# Momentum Release Script
# Automates version bump, testing, changelog, and release

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  MOMENTUM RELEASE"
echo "  Automated release workflow"
echo "═══════════════════════════════════════════════════════════════"
echo ""

cd "$PROJECT_DIR"

# Check for clean working directory
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${YELLOW}Warning: Working directory has uncommitted changes${NC}"
    git status --short
    echo ""
    read -p "Continue anyway? (y/N): " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Get current version from package.json
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')
echo -e "Current version: ${CYAN}$CURRENT_VERSION${NC}"
echo ""

# Parse version components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Calculate new versions
PATCH_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
MINOR_VERSION="$MAJOR.$((MINOR + 1)).0"
MAJOR_VERSION="$((MAJOR + 1)).0.0"

# Prompt for version bump type
echo "Select version bump type:"
echo "  1) patch  ($CURRENT_VERSION -> $PATCH_VERSION) - Bug fixes, small changes"
echo "  2) minor  ($CURRENT_VERSION -> $MINOR_VERSION) - New features, backward compatible"
echo "  3) major  ($CURRENT_VERSION -> $MAJOR_VERSION) - Breaking changes"
echo "  4) custom - Enter a custom version"
echo ""
read -p "Choice [1-4]: " BUMP_CHOICE

case $BUMP_CHOICE in
    1|patch|p)
        NEW_VERSION="$PATCH_VERSION"
        BUMP_TYPE="patch"
        ;;
    2|minor|m)
        NEW_VERSION="$MINOR_VERSION"
        BUMP_TYPE="minor"
        ;;
    3|major|M)
        NEW_VERSION="$MAJOR_VERSION"
        BUMP_TYPE="major"
        ;;
    4|custom|c)
        read -p "Enter custom version (e.g., 1.0.0): " NEW_VERSION
        if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo -e "${RED}Error: Invalid version format. Use semver (e.g., 1.0.0)${NC}"
            exit 1
        fi
        BUMP_TYPE="custom"
        ;;
    *)
        echo -e "${RED}Invalid choice. Aborted.${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "New version: ${GREEN}$NEW_VERSION${NC}"
echo ""

# Prompt for changelog entry
echo "Enter changelog entry (what changed in this release):"
echo "  Tip: Use Markdown formatting. End with an empty line."
echo "  Categories: Added, Changed, Fixed, Removed, Performance, Security"
echo ""
echo "Example:"
echo "  ### Fixed"
echo "  - Fixed database connection issue on Windows"
echo ""

CHANGELOG_ENTRY=""
echo "Enter changelog entry (press Ctrl+D or enter empty line when done):"
while IFS= read -r line; do
    [[ -z "$line" ]] && break
    CHANGELOG_ENTRY+="$line"$'\n'
done

# If no entry provided, use a default
if [[ -z "$CHANGELOG_ENTRY" ]]; then
    echo -e "${YELLOW}No changelog entry provided. Using default.${NC}"
    CHANGELOG_ENTRY="### Changed
- Version bump to $NEW_VERSION
"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  RELEASE SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "Version:   ${CYAN}$CURRENT_VERSION${NC} -> ${GREEN}$NEW_VERSION${NC}"
echo "Bump type: $BUMP_TYPE"
echo ""
echo "Changelog entry:"
echo "$CHANGELOG_ENTRY"
echo ""
read -p "Proceed with release? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  STEP 1: Running tests"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if ! bun test; then
    echo ""
    echo -e "${RED}Tests failed. Fix tests before releasing.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}All tests passed.${NC}"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  STEP 2: Building"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if ! bun run build; then
    echo ""
    echo -e "${RED}Build failed.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Build successful.${NC}"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  STEP 3: Updating version numbers"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Update package.json
echo -n "Updating package.json... "
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
echo -e "${GREEN}done${NC}"

# Update .claude-plugin/plugin.json
echo -n "Updating .claude-plugin/plugin.json... "
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" .claude-plugin/plugin.json
echo -e "${GREEN}done${NC}"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  STEP 4: Updating CHANGELOG.md"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Get today's date
TODAY=$(date +%Y-%m-%d)

# Create new changelog entry
NEW_CHANGELOG_SECTION="## [$NEW_VERSION] - $TODAY

$CHANGELOG_ENTRY"

# Insert after "# Changelog" header and any preamble
# Find line number of first "## [" and insert before it
FIRST_VERSION_LINE=$(grep -n "^## \[" CHANGELOG.md | head -1 | cut -d: -f1)

if [[ -n "$FIRST_VERSION_LINE" ]]; then
    # Insert new section before first version entry
    head -n $((FIRST_VERSION_LINE - 1)) CHANGELOG.md > CHANGELOG.tmp
    echo "" >> CHANGELOG.tmp
    echo "$NEW_CHANGELOG_SECTION" >> CHANGELOG.tmp
    tail -n +$FIRST_VERSION_LINE CHANGELOG.md >> CHANGELOG.tmp
    mv CHANGELOG.tmp CHANGELOG.md
    echo -e "${GREEN}CHANGELOG.md updated${NC}"
else
    echo -e "${YELLOW}Could not find version entries in CHANGELOG.md. Manual update required.${NC}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  STEP 5: Creating commit"
echo "═══════════════════════════════════════════════════════════════"
echo ""

git add package.json .claude-plugin/plugin.json CHANGELOG.md

# Create commit message
COMMIT_MSG="chore(release): bump version to $NEW_VERSION"

git commit -m "$COMMIT_MSG"
echo ""
echo -e "${GREEN}Commit created: $COMMIT_MSG${NC}"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  STEP 6: Pushing to origin"
echo "═══════════════════════════════════════════════════════════════"
echo ""

read -p "Push to origin? (y/N): " PUSH_CONFIRM
if [[ "$PUSH_CONFIRM" =~ ^[Yy]$ ]]; then
    git push origin
    echo ""
    echo -e "${GREEN}Pushed to origin.${NC}"
else
    echo -e "${YELLOW}Skipped push. Run 'git push origin' manually when ready.${NC}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  RELEASE COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "Released: ${GREEN}momentum v$NEW_VERSION${NC}"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  NEXT STEPS: Update substratia-marketplace"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "1. Navigate to the substratia-marketplace repo:"
echo ""
echo "   cd ../substratia-marketplace"
echo ""
echo "2. Update the momentum version in plugins/momentum.json:"
echo ""
echo "   Edit: plugins/momentum.json"
echo "   Change: \"version\": \"...\" -> \"version\": \"$NEW_VERSION\""
echo ""
echo "3. Commit and push the marketplace update:"
echo ""
echo "   git add plugins/momentum.json"
echo "   git commit -m \"chore: update momentum to v$NEW_VERSION\""
echo "   git push origin"
echo ""
echo "4. (Optional) Create a GitHub release with tag v$NEW_VERSION:"
echo ""
echo "   git tag v$NEW_VERSION"
echo "   git push origin v$NEW_VERSION"
echo ""
echo "═══════════════════════════════════════════════════════════════"
