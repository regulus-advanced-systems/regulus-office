#!/bin/sh
# Stand-in for the `claude` binary in hook integration tests. It is NOT
# Claude Code: it reads the --settings file the adapter generated, runs the
# SessionStart hook it registers the way Claude Code does (through
# tests/e2e/runner/claude-hooks.sh, shared with the e2e fake: command hooks get
# the payload on stdin, and http hooks to a private or link-local address are
# refused, #162), then pipes a statusline payload through the generated
# statusline command. Nothing it prints holds the hook token.
settings=""
session=""
while [ $# -gt 0 ]; do
  case "$1" in
    --settings) settings="$2"; shift 2 ;;
    --session-id|--resume) session="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -r "$settings" ] || { echo "FAKE CLAUDE no settings"; exit 1; }
dir=$(dirname "$settings")
. "$(dirname "$0")/../../../../../../tests/e2e/runner/claude-hooks.sh"
claude_hooks_error() { echo "FAKE CLAUDE $*"; }
claude_hooks_trace() { echo "FAKE CLAUDE $*"; }
claude_hooks_init "$settings"
claude_hook SessionStart \
  "$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup"}' "$session" "$PWD")"
printf '{"session_id":"%s","model":{"display_name":"Fake"},"cost":{"total_cost_usd":0.5},"rate_limits":{"five_hour":{"used_percentage":12,"resets_at":1738425600}}}' "$session" |
  sh "$dir/statusline.sh"
echo "FAKE CLAUDE DONE"
exec sleep 30
