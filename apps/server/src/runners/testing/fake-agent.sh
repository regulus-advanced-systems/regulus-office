#!/bin/sh
# Tiny stand-in for an agent CLI, used by runner integration tests.
# Sets an OSC title, prints a banner, echoes each input line, exits on "exit".
# It reports whether FAKE_API_KEY is set but never prints its value.
printf '\033]2;fake-agent: idle\007'
if [ -n "${FAKE_API_KEY:-}" ]; then echo "FAKE AGENT key=present"; else echo "FAKE AGENT key=absent"; fi
echo "FAKE AGENT READY"
while IFS= read -r line; do
  if [ "$line" = "exit" ]; then
    echo "FAKE AGENT BYE"
    exit 0
  fi
  printf '\033]2;fake-agent: working\007'
  echo "you said: $line"
  printf '\033]2;fake-agent: idle\007'
done
