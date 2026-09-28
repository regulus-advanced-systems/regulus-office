#!/bin/sh
# Stand-in for the `claude` CLI in tests (never the real binary, never ~/.claude).
# `auth status` exits 0 once `auth login` accepted the code CODE-OK, else 1,
# like the real command; the marker lives in the fake runner HOME.
marker="$HOME/.fake-claude-login"
case "$1 $2" in
  "auth status")
    if [ -f "$marker" ]; then
      echo '{"loggedIn":true,"email":"fake-account-email@example.invalid"}'
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
      sleep 60
      exit 0
    fi
    echo "Invalid code"
    exit 1
    ;;
esac
echo "fake-claude: unexpected arguments" >&2
exit 2
