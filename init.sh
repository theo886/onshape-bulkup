#!/bin/bash
# Initialization script for Claude agent sessions
# Run this at the start of each session to verify environment and catch regressions

set -e

echo "=============================================="
echo "  Onshape Migration - Session Initialization"
echo "=============================================="
echo ""

# Check Node.js version
echo "1. Checking Node.js..."
NODE_VERSION=$(node -v)
echo "   Node version: $NODE_VERSION"

# Check if API key exists
echo ""
echo "2. Checking API credentials..."
if [ -f "Node/config/apikey.js" ]; then
    echo "   API key file: EXISTS"
else
    echo "   ERROR: Node/config/apikey.js not found!"
    echo "   Copy Node/config/apikeyexample.js and add your credentials"
    exit 1
fi

# Quick API connectivity test
echo ""
echo "3. Testing Onshape API connectivity..."
cd Node
API_TEST=$(node -e "
const onshape = require('./lib/onshape.js');
onshape.get({ path: '/api/users/sessioninfo' }, (data) => {
    const user = JSON.parse(data.toString());
    console.log('Connected as: ' + user.name + ' (' + user.email + ')');
});
" 2>&1) || API_TEST="FAILED"
echo "   $API_TEST"
cd ..

# Show git status
echo ""
echo "4. Git status..."
BRANCH=$(git branch --show-current)
echo "   Branch: $BRANCH"
COMMITS_AHEAD=$(git rev-list --count origin/$BRANCH..$BRANCH 2>/dev/null || echo "0")
echo "   Commits ahead of origin: $COMMITS_AHEAD"
UNCOMMITTED=$(git status --porcelain | wc -l | tr -d ' ')
echo "   Uncommitted changes: $UNCOMMITTED files"

# Show recent commits
echo ""
echo "5. Recent commits..."
git log --oneline -5 | sed 's/^/   /'

# Show feature status
echo ""
echo "6. Feature status..."
if [ -f "features.json" ]; then
    TOTAL=$(node -e "const f=require('./features.json'); console.log(f.features.length)")
    PASSED=$(node -e "const f=require('./features.json'); console.log(f.features.filter(x=>x.passed).length)")
    echo "   Features: $PASSED / $TOTAL passed"
    echo ""
    echo "   Incomplete features:"
    node -e "
    const f = require('./features.json');
    f.features.filter(x => !x.passed).forEach(x => {
        console.log('   - [' + x.id + '] ' + x.description);
    });
    if (f.features.every(x => x.passed)) {
        console.log('   (none - all features complete!)');
    }
    "
else
    echo "   features.json not found"
fi

echo ""
echo "=============================================="
echo "  Initialization complete - ready to work"
echo "=============================================="
echo ""
echo "Next: Read claude-progress.txt for context"
