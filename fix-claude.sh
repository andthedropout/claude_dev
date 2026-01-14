#!/bin/bash
# Fix Claude Code terminal issues
# Run this if you continue to see errors when opening terminal

echo "Fixing Claude Code installation..."

# 1. Clear terminal saved state (if using iTerm2)
if [ -d "$HOME/Library/Application Support/iTerm2/SavedState" ]; then
    echo "Clearing iTerm2 saved state..."
    rm -rf "$HOME/Library/Application Support/iTerm2/SavedState"/*
fi

# 2. Clear Terminal app saved state (if using default Terminal)
if [ -d "$HOME/Library/Saved Application State/com.apple.Terminal.savedState" ]; then
    echo "Clearing Terminal saved state..."
    rm -rf "$HOME/Library/Saved Application State/com.apple.Terminal.savedState"/*
fi

# 3. Verify Claude installation
echo ""
echo "Current Claude version:"
claude --version

echo ""
echo "Claude location:"
which claude

echo ""
echo "✓ Done! Close all terminal windows and open a new one."
echo "  The errors should no longer appear."
