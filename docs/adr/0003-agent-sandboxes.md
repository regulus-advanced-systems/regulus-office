# ADR 0003: Per-agent sandboxes

Date: 2026-09-30. Status: accepted (owner decision D18, #139; implemented in #169).

## Context
Until M2 every robot of a human ran in that human's runner: one container
(docker) or one account with one tmux server (linux-user). Two `bun run dev`
both wanted port 3000, robots saw each other's processes, and one runaway dev
server could starve the human's other robots or the office VM (8 vCPU, 16 GB,
D11). The runner guarantees had to stay: non-root, no Docker socket, only the
human's own area mounted (#122), a shared HOME so CLI logins work, secrets only
on stdin or in 0600 files, self-heal (#152), floor cleanup (#153), re-adoption
after an office restart.

## Decision
- The `Runner` interface gets two optional methods: `sandbox(agent, {workdir})`
  and `listSandboxes()`. The AgentManager calls `sandbox()` in `startAgent`
  before anything runs; from then on the backend routes every call about that
  robot (exec, piped processes, tmux, processes, ports) to the sandbox, and
  `kill` removes it. Login terminals and side processes stay in the runner.
- **docker:** one container per robot, `<prefix>-sbx-<agentId>`, from the
  runner image with the runner's hardening, the human's HOME volume and only
  the human's area on the robot's floor. It has its own network namespace on
  the runners network (the office reaches it by container name, nothing is
  published), its own pid namespace, its own tmux server (tmux runs per
  sandbox), memory/CPU/pids limits and `RestartPolicy: no`. It is never healed
  in place: a stopped or broken one is replaced. No new Engine API endpoints,
  so the socket-proxy allowlist is unchanged.
- **linux-user:** the helper's `sandbox-up` records the robot's slot and
  limits and creates a network namespace with a veth on an isolated bridge,
  NAT outwards, and `127.0.0.1:<office port>` plus a loopback DNS stub
  forwarded to the host. `exec` starts the robot's own tmux server as pid 1 of
  a new pid namespace (own `/proc`) inside it, in `agent-<id>.scope` with
  `MemoryMax`, `CPUQuota`, `TasksMax`.
- **Ports:** each sandbox has a slot; slot n owns `base + n*span …` and `PORT`
  is its first port, picked from a hash of the agent id, so it is stable.
- **Cleanup:** stop, send-home and failed starts remove the sandbox at once;
  a reaper at boot and every minute removes sandboxes of untracked robots and
  of robots down for more than two minutes.
- Defaults: 2 GiB, 2 CPUs, 1024 pids, ports 20000 + 10 × slot, 2000 slots
  (`OFFICE_SANDBOX_*`); `OFFICE_SANDBOXES=false` turns sandboxes off.

## Consequences
- One extra container (docker) or namespace set (linux-user) per robot; image
  layers are shared, so the cost is small.
- Robots of one human share uid and HOME: sandboxes separate processes, ports
  and limits, not trust between one human's robots. The boundary between
  humans is unchanged.
- The runner is no longer busy while robots run, so first spawns on a new
  floor no longer hit `RunnerBusyError` because of other robots.
- On docker, sandboxes on one runners network can reach each other's ports
  (as runners could before); linux-user isolates bridge ports.
