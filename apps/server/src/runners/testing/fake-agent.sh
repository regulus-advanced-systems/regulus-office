#!/bin/sh
# Tiny stand-in for an agent CLI, used by runner integration tests.
# Sets an OSC title, prints a banner, echoes each input line, exits on "exit".
# Ctrl-C (SIGINT) prints "FAKE AGENT INTERRUPTED" and keeps it running (bash
# runs the trap at once, dash only after the pending `read` returns).
# It reports whether FAKE_API_KEY is set but never prints its value.
printf '\033]2;fake-agent: idle\007'
if [ -n "${FAKE_API_KEY:-}" ]; then echo "FAKE AGENT key=present"; else echo "FAKE AGENT key=absent"; fi
interrupted=0
trap 'interrupted=1; echo "FAKE AGENT INTERRUPTED"' INT
echo "FAKE AGENT READY"
while :; do
  if ! IFS= read -r line; then
    # A trapped signal interrupts `read`; anything else is end of input.
    if [ "$interrupted" = 1 ]; then
      interrupted=0
      continue
    fi
    exit 0
  fi
  if [ "$line" = "exit" ]; then
    echo "FAKE AGENT BYE"
    exit 0
  fi
  printf '\033]2;fake-agent: working\007'
  echo "you said: $line"
  printf '\033]2;fake-agent: idle\007'
done
