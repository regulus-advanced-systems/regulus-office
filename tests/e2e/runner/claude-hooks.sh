# Sourced by the fake `claude` scripts (this directory, and apps/server/src/agents/hooks/testing).
# It is NOT Claude Code. It runs the hooks a --settings file registers the way Claude Code does,
# including the rule that made real hooks fail in Compose (#162): an `type: "http"` hook whose
# host resolves to a private or link-local address is refused with Claude Code's own message
# ("HTTP hook blocked: <host> resolves to <addr> (private/link-local address). Loopback
# (127.0.0.1, ::1) is allowed for local dev."), and only loopback is allowed. The ranges are
# those Claude Code 2.1.284 checks: 0/8, 10/8, 100.64/10, 169.254/16, 172.16/12, 192.168/16,
# ::, fc00::/7, fe80::/10 and IPv4-mapped forms of those.
#
#   claude_hooks_init <settings.json>
#   claude_hook <Event> <json>      prints the hook's output (a decision body, if any)
#
# `type: "command"` hooks get the JSON on stdin through `sh -c`, bounded by their `timeout`, and
# a non-zero exit is reported as "<Event> hook error: ..." like Claude Code's non-blocking error,
# through `claude_hooks_error` (the caller points it at the pane). Diagnostics go through
# `claude_hooks_trace`. Both default to stderr; nothing here prints a header or token. The
# settings file must be pretty-printed JSON, as the adapter writes it.

claude_hooks_settings=""
claude_hooks_trace() { printf '%s\n' "$*" >&2; }
claude_hooks_error() { printf '%s\n' "$*" >&2; }

claude_hooks_init() { claude_hooks_settings="$1"; }

# claude_hook_field <Event> <field>: the first handler's field for that event, JSON-unescaped.
claude_hook_field() {
  awk -v ev="    \"$1\": [" -v key="\"$2\": " '
    index($0, ev) == 1 { on = 1; next }
    on && /^    \]/ { exit }
    on && index($0, key) {
      v = substr($0, index($0, key) + length(key)); sub(/,$/, "", v)
      if (v ~ /^"/) { v = substr(v, 2, length(v) - 2); gsub(/\\"/, "\"", v); gsub(/\\\\/, "\\", v) }
      print v; exit
    }' "$claude_hooks_settings"
}

# claude_hook_ip_blocked <address>: exit 0 when Claude Code would refuse it.
claude_hook_ip_blocked() {
  ip=$(printf '%s' "$1" | tr 'A-F' 'a-f')
  case "$ip" in
    ::ffff:*.*.*.*) ip=${ip#::ffff:} ;;
    ::1) return 1 ;;
    ::) return 0 ;;
    fc* | fd* | fe[89ab]?:*) return 0 ;;
    *:*) return 1 ;;
  esac
  old_ifs=$IFS
  IFS=.
  # shellcheck disable=SC2086
  set -- $ip
  IFS=$old_ifs
  [ $# -eq 4 ] || return 1
  a=$1 b=$2
  [ "$a" -eq 127 ] && return 1
  [ "$a" -eq 0 ] || [ "$a" -eq 10 ] && return 0
  [ "$a" -eq 169 ] && [ "$b" -eq 254 ] && return 0
  [ "$a" -eq 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ] && return 0
  [ "$a" -eq 100 ] && [ "$b" -ge 64 ] && [ "$b" -le 127 ] && return 0
  [ "$a" -eq 192 ] && [ "$b" -eq 168 ] && return 0
  return 1
}

# claude_hook_url_blocked <url>: prints Claude Code's message and exits 0 when it is refused.
claude_hook_url_blocked() {
  host=$(printf '%s' "$1" | sed -e 's#^[a-z]*://##' -e 's#[/?].*$##' -e 's#^.*@##')
  case "$host" in
    \[*) host=${host#\[}; host=${host%%\]*} ;;
    *) host=${host%:*} ;;
  esac
  for addr in $(getent ahosts "$host" 2>/dev/null | awk '{ print $1 }' | sort -u); do
    if claude_hook_ip_blocked "$addr"; then
      echo "HTTP hook blocked: $host resolves to $addr (private/link-local address). Loopback (127.0.0.1, ::1) is allowed for local dev."
      return 0
    fi
  done
  return 1
}

claude_hook() {
  event=$1
  type=$(claude_hook_field "$event" type)
  timeout_s=$(claude_hook_field "$event" timeout)
  timeout_s=${timeout_s:-600}
  case "$type" in
    command)
      command=$(claude_hook_field "$event" command)
      out=$(printf '%s' "$2" | timeout "$timeout_s" sh -c "$command")
      status=$?
      claude_hooks_trace "hook $event (command) -> exit $status"
      if [ "$status" -ne 0 ]; then
        claude_hooks_error "$event hook error: exit $status"
      else
        printf '%s' "$out"
      fi
      ;;
    http)
      url=$(claude_hook_field "$event" url)
      if blocked=$(claude_hook_url_blocked "$url"); then
        claude_hooks_trace "hook $event (http) -> blocked"
        claude_hooks_error "$event hook error: $blocked"
        return 0
      fi
      headers=$(mktemp)
      body=$(mktemp)
      (umask 077 && sed -n 's/.*"Authorization": "\([^"]*\)".*/Authorization: \1/p' \
        "$claude_hooks_settings" | head -n 1 > "$headers")
      code=$(printf '%s' "$2" | curl -sS --max-time "$timeout_s" -o "$body" -w '%{http_code}' \
        -H 'Content-Type: application/json' -H "@$headers" --data-binary @- "$url")
      claude_hooks_trace "hook $event (http) -> ${code:-none}"
      case "$code" in 2??) cat "$body" ;; esac
      rm -f "$headers" "$body"
      ;;
    *)
      claude_hooks_trace "hook $event not registered"
      ;;
  esac
}
