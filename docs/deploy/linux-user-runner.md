# linux-user runner backend

The default runner for bare-metal and VM installs (SPEC §8). Each human gets
their own Linux account, `office-u-<rid>`, with a private HOME (where the agent
CLIs keep their own credentials), their own tmux server, and one systemd scope
per agent. `office-server` runs unprivileged as `office` and crosses into those
accounts only through one root helper, invoked with `sudo -n`.

Code: `apps/server/src/runners/linux-user/`. Helper:
`apps/server/src/runners/linux-user/helper/office-runner-helper`.

## Names

| Thing | Name |
|---|---|
| Runner id `<rid>` | the office user id if it is 1-16 chars of `[a-z0-9]`, otherwise the first 23 hex chars of its SHA-256. User ids are UUIDs (36 chars) and Linux user names are limited to 32, so `office-u-<uuid>` cannot exist; this is the `<id>`/`<humanId>` of SPEC §4.4 and §8. |
| Account and its private group | `office-u-<rid>` (GECOS `Regulus Office runner`) |
| HOME | `/home/office-u-<rid>`, mode 0700 |
| tmux socket | `/run/office/tmux/<rid>.sock`, owned by the account |
| tmux server scope | `office-tmux-<rid>.scope` |
| Agent session / scope | tmux session `agent-<agentId>`, scope `agent-<agentId>.scope` |
| Piped side process (e.g. `codex app-server`) | scope `agent-<agentId>.io-<random>.scope` |

All scopes live in `system.slice`, so `/sys/fs/cgroup/system.slice/agent-<agentId>*.scope/cgroup.procs`
is the exact process list of an agent.

## Install

```sh
sudo install -d -m 0755 /usr/local/lib/office /etc/office
sudo install -m 0755 -o root -g root \
  apps/server/src/runners/linux-user/helper/office-runner-helper /usr/local/lib/office/
sudo install -m 0440 -o root -g root \
  apps/server/src/runners/linux-user/helper/office-runner.sudoers /etc/sudoers.d/office-runner
sudo visudo -c
sudo install -d -m 0755 /srv/office
sudo install -d -m 0750 -o office -g office /srv/office/projects /srv/office/worktrees
```

Requirements: systemd (cgroup v2), `tmux` >= 3.0, `acl` (`setfacl`), util-linux
(`setpriv`), `busctl`, `useradd`/`userdel`. `/proc` must not be mounted with
`hidepid` (office reads `/proc/<pid>/stat` of agent processes).

### Helper configuration

Optional `/etc/office/runner-helper.conf` (root-owned, `KEY=value`, unknown keys
are rejected). This is where the run dir is configured; the server learns the
socket path from `provision`'s output.

```ini
OFFICE_TMUX_DIR=/run/office/tmux          # per-human tmux sockets
OFFICE_PROJECTS_ROOT=/srv/office/projects # floor checkouts
OFFICE_WORKTREES_ROOT=/srv/office/worktrees
OFFICE_SERVER_USER=office                 # gets rw ACLs on project files
```

## sudoers

Exact contents of `/etc/sudoers.d/office-runner`
(`apps/server/src/runners/linux-user/helper/office-runner.sudoers`; a test keeps
the two in sync):

```sudoers
Cmnd_Alias OFFICE_RUNNER_HELPER = /usr/local/lib/office/office-runner-helper
Defaults!OFFICE_RUNNER_HELPER !use_pty
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper provision *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper deprovision *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper mount-project *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper exec *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper spawn-piped *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper kill *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper sockets *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper capture *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper pane-title *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper send-keys *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper has-session *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper list-sessions *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper attach *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper write-file *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper read-file *
office ALL=(root) NOPASSWD: /usr/local/lib/office/office-runner-helper list-dir *
```

sudo only pins the verb (`*` matches any remaining arguments, spaces
included); the helper enforces the rest of the grammar and exits 2 on anything
else, before it does any work. One rule per verb keeps the allowed surface
greppable and lets an operator drop verbs they do not want.

| Rule | Why it is needed |
|---|---|
| `Defaults!… !use_pty` | `attach` is spawned inside the terminal bridge's PTY and `spawn-piped` speaks JSON over pipes; an extra sudo PTY layer would only relay bytes. The helper still runs with sudo's `env_reset`. |
| `provision` | `useradd` the account and group, HOME 0700, create the sticky run dir, start the account's tmux server in its own scope with `systemd-run --uid --gid --scope`. Root: account creation and cross-uid scopes. |
| `deprovision` | Kill every process of the account, stop its tmux scope, `userdel --remove`. Root. |
| `mount-project` | `setfacl` on a floor checkout or agent worktree (must be a canonical path under the configured roots) so the human's group and the office user can read and write it. Root: files in a checkout may belong to other humans' accounts. |
| `exec` | Start `agent-<agentId>` on the human's tmux server as the human and move the pane into its own `agent-<agentId>.scope`. Root: acting as another uid, creating a system scope. |
| `spawn-piped` | `systemd-run --uid --gid --scope` a stdio process (e.g. `codex app-server`) as the human. Root: same. |
| `kill` | Kill the session and `systemctl kill` every `agent-<agentId>*` scope (only if all its processes are the human's). Root: the processes belong to another uid. |
| `sockets` | Socket inodes held by the agent's processes, for port detection. Root: `/proc/<pid>/fd` is readable only by the owner. |
| `capture`, `pane-title`, `send-keys`, `has-session`, `list-sessions` | Read or type into the human's tmux server. Root only to switch to the human (`setpriv`); tmux sockets are private to their owner. |
| `attach` | The terminal bridge (#24) runs it in a PTY: `tmux attach-session` as the human, `-r` for watchers. |
| `write-file` | Write a `SpawnPlan` file (hook settings, statusline scripts) as the human; contents arrive on stdin. |
| `read-file`, `list-dir` | Read transcripts and session dirs in the human's private HOME. |

The trust boundary is `office` → any `office-u-*` account (running agents for
humans is the whole point), never `office` → root or another account. So the
helper runs only account, scope and ACL plumbing as root and does everything
else as the target account via `setpriv --reuid --regid --init-groups
--no-new-privs` with a clean environment. It refuses accounts without its GECOS
marker, uid 0, and IDs outside `^[a-z0-9]{1,23}$` (runner), `^[A-Za-z0-9_-]{1,64}$`
(agent), `^agent-[A-Za-z0-9_-]{1,64}$` (session).

## How the pieces work

- **tmux server per human.** Started by `provision` (and again by `exec` if it
  died) as `systemd-run --uid --gid --scope --unit=office-tmux-<rid> tmux -S
  /run/office/tmux/<rid>.sock -f /dev/null start-server ; set -g exit-empty off`.
  Its own scope keeps it out of `office.service`, so restarting the office does
  not kill agents. `/run/office/tmux` is mode 1733 (sticky, not listable, like
  `/tmp`): accounts create their own socket and cannot list or remove others'.
  Before every use the helper checks the socket is a socket owned by that
  account, and `provision` removes a stale or squatted one.
- **One scope per agent.** SPEC §8 says agents are launched via
  `systemd-run --uid --gid --scope --unit=agent-<id>` inside the human's tmux
  server. Taken literally that cannot work: pane processes are forked by the
  tmux server, so a scope wrapped around a tmux *client* would not contain the
  agent. `exec` therefore creates the pane with a small wrapper as its command,
  reads the pane pid and creates the same transient unit systemd-run would,
  `agent-<agentId>.scope`, adopting that pid (`StartTransientUnit` with `PIDs`
  via `busctl`). The wrapper waits until it sits in that scope before it execs
  the agent, so everything the agent starts, daemons included, is in the scope.
  `spawn-piped` has no tmux in the way and uses `systemd-run --uid --gid
  --scope` literally.
- **Secrets (SPEC §8 rule 2).** `plan.env` becomes `export NAME='value'` lines
  that go to the helper on stdin (NUL-terminated). The helper writes them, as
  the human, into a fresh 0600 file in `~/.office/env` (0700); the wrapper
  sources and deletes it, then execs the agent. Values never appear in argv
  (sudo, helper, tmux, systemd-run are all visible in `ps` and sudo's log) or
  in any log. `plan.files` travel on stdin to `write-file` and are written to a
  temp file with the target mode, then renamed.
- **Processes and ports.** `listProcesses` reads the agent's scopes'
  `cgroup.procs` and `/proc/<pid>/stat` directly (no sudo). `listPorts` asks
  the helper for `<pid> <socket inode>` pairs and matches them against LISTEN
  rows of `/proc/net/tcp{,6}`.
- **Project workdirs: ACLs, not group membership.** `mount-project` grants
  `g:office-u-<rid>:rwX` plus the same default ACL (so new files inherit it),
  `u:office:rwX` (+ default) for the office's own git work, and `--x` on each
  ancestor below the projects root. Chosen over a shared per-floor group
  because supplementary groups only apply to new processes: adding a human to
  a floor group would not reach their already-running tmux server. ACLs work
  immediately, need no `usermod`, and are per human. `setfacl -R -P` never
  follows symlinks inside the checkout.

## Verifying

`bun test apps/server/src/runners/linux-user` runs the unit tests (helper
mocked, and the helper's argument grammar exercised unprivileged). The real
test needs the install above and passwordless sudo:

```sh
OFFICE_TEST_LINUX_USER=1 bun test apps/server/src/runners/linux-user/linux-user-runner.integration.test.ts
```

It is the `linux-user` job in `.github/workflows/ci.yml`.

## Not covered yet

- Git refuses repositories owned by another user ("dubious ownership"); the
  worktree/PR work (#31) needs `safe.directory` for runner accounts.
- Resource limits (CPU/memory) per agent or per human: set them on the scopes
  or a slice later.
