#!/bin/sh
# Stand-in for the `claude` binary in hook integration tests. It is NOT
# Claude Code: it reads the --settings file the adapter generated, POSTs a
# documented SessionStart hook payload to the http hook URL with the
# configured Authorization header (read from the file, never printed), then
# pipes a statusline payload through the generated statusline command.
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
url=$(sed -n 's/.*"url": "\([^"]*\)".*/\1/p' "$settings" | head -n 1)
sed -n 's/.*"Authorization": "\([^"]*\)".*/Authorization: \1/p' "$settings" | head -n 1 > "$dir/fake-hook.headers"
printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup"}' "$session" "$PWD" |
  curl -s -o /dev/null -w 'FAKE CLAUDE hook %{http_code}\n' -H 'Content-Type: application/json' \
    -H "@$dir/fake-hook.headers" --data-binary @- "$url"
rm -f "$dir/fake-hook.headers"
printf '{"session_id":"%s","model":{"display_name":"Fake"},"cost":{"total_cost_usd":0.5},"rate_limits":{"five_hour":{"used_percentage":12,"resets_at":1738425600}}}' "$session" |
  sh "$dir/statusline.sh"
echo "FAKE CLAUDE DONE"
exec sleep 30
