#!/bin/sh
# Stand-in for Claude Code's first-run screens (#158). It is NOT Claude Code and never reads
# ~/.claude/. Like the real CLI (seen in v2.1.285), it shows the onboarding (theme picker, then
# login) until `hasCompletedOnboarding` is true in `$CLAUDE_CONFIG_DIR/.claude.json` (or
# `$HOME/.claude.json`), then the workspace trust dialog until `projects["$PWD"]` has
# `hasTrustDialogAccepted: true`. Past both it is the hook fake (fake-claude.sh): SessionStart.
# It reads the config with grep, relying on the office's pretty-printed JSON.
cfg="${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"
if ! grep -q '"hasCompletedOnboarding": true' "$cfg" 2>/dev/null; then
  echo " Let's get started."
  echo " Choose the text style that looks best with your terminal"
  echo " ❯ 2. Dark mode ✔"
  exec sleep 600
fi
if ! grep -A1 -F "\"$PWD\": {" "$cfg" 2>/dev/null | grep -q '"hasTrustDialogAccepted": true'; then
  echo " Quick safety check: Is this a project you created or one you trust?"
  echo " ❯ No, exit"
  echo "   Yes, I trust this folder"
  exec sleep 600
fi
exec "$(dirname "$0")/fake-claude.sh" "$@"
