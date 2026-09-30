#!/bin/bash
# Every helper call shape must be allowed by the sudoers rules for a user without blanket sudo.
set -euo pipefail
helper_dir=${1:?helper dir}
user=${2:?check user}
bin=/usr/local/lib/office/office-runner-helper
fail=0
n=0
while IFS= read -r call; do
  mapfile -t args < <(jq -r '.[]' <<<"$call")
  n=$((n + 1))
  if ! sudo -u "$user" sudo -n -l "$bin" "${args[@]}" >/dev/null 2>&1; then
    echo "not allowed by sudoers: ${args[*]}"
    fail=1
  fi
done < <(jq -c '.[]' "$helper_dir/helper-calls.json")
echo "$n helper calls checked"
exit "$fail"
