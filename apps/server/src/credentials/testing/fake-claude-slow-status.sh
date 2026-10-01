#!/bin/sh
# Stand-in for the `claude` CLI (never the real binary, never ~/.claude) whose `auth status`
# is slow, to pin down the order of the office's login check (#199).
# - `auth status` reads the login state first, then waits until the test creates
#   $HOME/.fake-claude-status-release, and only then answers what it read. It marks
#   $HOME/.fake-claude-status-started so the test knows the check is in flight.
# - `auth login` exits right after it accepted CODE-OK, like the real CLI, so the login
#   session can close while a status check is still running.
marker="$HOME/.fake-claude-login"
case "$1 $2" in
  "auth status")
    if [ -f "$marker" ]; then answer=0; else answer=1; fi
    : > "$HOME/.fake-claude-status-started"
    n=0
    while [ ! -f "$HOME/.fake-claude-status-release" ] && [ "$n" -lt 200 ]; do
      sleep 0.05
      n=$((n + 1))
    done
    rm -f "$HOME/.fake-claude-status-started"
    if [ "$answer" = 0 ]; then
      echo '{"loggedIn":true}'
      exit 0
    fi
    echo '{"loggedIn":false}'
    exit 1
    ;;
  "auth login")
    echo "Paste code here if prompted >"
    IFS= read -r code
    if [ "$code" = "CODE-OK" ]; then
      : > "$marker"
      echo "Login successful."
      exit 0
    fi
    echo "Invalid code"
    exit 1
    ;;
esac
echo "fake-claude: unexpected arguments" >&2
exit 2
