# The watchdog: what to set up on a host and in Sentry

The watchdog henchman (SPEC D30, #253) reads PM2 on your hosts over SSH and your Sentry projects over Sentry's API. It only reads; the one thing it writes anywhere outside the office is a comment on a Sentry issue. This page is what an operator sets up outside the office before adding a host or a Sentry project under Settings → Watchdog.

Nothing here has been run against a real VPS or a real Sentry organisation yet. The SSH side is tested against a local `sshd` with the forced command below; the PM2 commands were checked against PM2 6.0.14 on a workstation. Treat the first real host as the test.

## What the office runs on a host

Exactly two commands, as fixed argument lists, never anything the model wrote:

```
pm2 jlist
pm2 logs <app> --err --nostream --raw --lines 300
```

`<app>` is a PM2 app name you typed in Settings (letters, digits, `. _ : @ -`). `ssh` is started with no agent, no forwarding, no TTY and no config file.

## A read-only user

PM2 keeps one daemon per Linux user, in that user's `PM2_HOME` (`~/.pm2` by default). The apps usually run under a deploy user. A separate user cannot see that daemon unless you let it, so pick one of these.

### Recommended: a forced command on the deploy user's key

Add the watchdog's public key to the **deploy user's** `~/.ssh/authorized_keys` with a forced command, so this key can do nothing but the two reads:

```
restrict,command="/usr/local/bin/watchdog-pm2" ssh-ed25519 AAAA... regulus-watchdog
```

`/usr/local/bin/watchdog-pm2` (root-owned, mode 0755):

```sh
#!/bin/sh
# Lets the watchdog's key read PM2 and nothing else.
set -eu
case "${SSH_ORIGINAL_COMMAND:-}" in
  "pm2 jlist")
    exec pm2 jlist ;;
  "pm2 logs "*" --err --nostream --raw --lines 300")
    app=${SSH_ORIGINAL_COMMAND#pm2 logs }
    app=${app% --err --nostream --raw --lines 300}
    case "$app" in
      *[!A-Za-z0-9._:@-]*|"") echo "refused" >&2; exit 3 ;;
    esac
    exec pm2 logs "$app" --err --nostream --raw --lines 300 ;;
  *)
    echo "this key may only read PM2 state and logs" >&2; exit 3 ;;
esac
```

`restrict` turns off port, agent and X11 forwarding and the TTY. In Settings, the "read-only user" is then the deploy user's name; what makes it read-only is the forced command, not the account.

If `pm2` is not on the non-interactive `PATH` (nvm, mise), use its full path in the script.

### Alternative: a separate user that shares the PM2 home

Create a user (say `watchdog`), put it in the deploy user's group, and make the deploy user's `PM2_HOME` group-readable, including the `rpc.sock` and `pub.sock` sockets and the `logs` directory. Set `PM2_HOME` for the `watchdog` user to that path (for example in a forced command: `command="PM2_HOME=/home/deploy/.pm2 /usr/local/bin/watchdog-pm2"`). PM2's sockets accept commands from anyone who can write to them, so with this setup the forced command is what keeps the user read-only; do not skip it.

## The SSH key and the host key

- Make a key only for this: `ssh-keygen -t ed25519 -N "" -f watchdog_key -C regulus-watchdog`. Paste the private key into Settings once; the office stores it encrypted with `OFFICE_MASTER_KEY` and never shows it again. On the runner it exists only as a 0600 file for the seconds a check runs.
- Give the host's public key when you add the host: `ssh-keyscan -t ed25519 your.host` and paste the line. Then the watchdog talks to that host only. If you leave it empty, the key the host shows on first contact is stored and shown in Settings as a fingerprint; compare it with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the host.
- If a host later shows another key, its checks fail and owners and admins are told. Accept the new key in Settings only if you know why it changed (a reinstall, a rotated host key).
- Changing a host's address or port in Settings drops its pin: it is treated as another machine. Give the new machine's public key in the same form to pin it at once; without it the host shows as "not yet verified" and the first key it shows is trusted and stored.
- If a host shows another key and the office could not read which one, there is nothing to accept: the pin stays and the host is not read until a check can read the new key.

## Who may point a stored key or token at something new

The SSH key of a host and the Sentry token are the office's. Adding an app to a host, changing a host's address or port, adding a Sentry project while a token is stored, and changing the Sentry organisation all point a stored credential at something new. The office owner may do that. An admin who is not the owner has to give the credential again in the same form (paste the key, type the token); what they give replaces the stored copy. Each such change is in the audit log with how it was allowed (`owner` or `given_again`).

An admin who cannot see a target's room can stop watching it, but the target is then kept as "not watched" with its room, and only someone who can see that room can watch it again or remove it for good. So removing a target and adding it again under another room does not work.

## Sentry

- **Token.** Create an auth token for the organisation (an internal integration token, or a user auth token) with the scopes **`event:read`** and **`project:read`** to read issues and events, and **`event:write`** to post the verdict as a comment. Without `event:write` the rounds still work and the comments show as failed. These scope names are from Sentry's documentation and have not been confirmed against a live organisation by this project; if a round reports `http_403` for a project, the scopes are the first thing to check.
- **Host.** `sentry.io`, a region host such as `de.sentry.io`, or your self-hosted host. Changing the host in Settings removes the stored token: a token is never sent to another host than the one it was typed for.
- **Projects.** List the project slugs to watch and put each into the room of its repo. The office asks Sentry for those projects only, and comments only on issues it read from them.
- The office calls these endpoints, all under `https://<host>/api/0/`:
  - `GET projects/<org>/<project>/issues/?query=is:unresolved firstSeen:-<N>h` and `...is:unresolved is:regressed`
  - `GET organizations/<org>/issues/<id>/` (when an issue it knows is marked regressed: its activity, to see when)
  - `GET organizations/<org>/issues/<id>/events/latest/`
  - `POST organizations/<org>/issues/<id>/comments/`

## The agent and the fix rule

- Under Settings → Agents, create a shared agent with the job **Watchdog**, running as a **Claude Code session** on an office key (DeepSeek Flash is enough for the rounds). A Hermes agent cannot do rounds.
- "Start fixes without asking" is off by default. Read what it says in Settings before switching it on: a henchman then works in your name from text that came out of production logs.

## Checking it by hand

From the office host, as the runner identity, with the same key:

```
ssh -i watchdog_key -o BatchMode=yes -o IdentitiesOnly=yes deploy@your.host -- pm2 jlist | head -c 300
ssh -i watchdog_key -o BatchMode=yes -o IdentitiesOnly=yes deploy@your.host -- pm2 restart api   # must be refused
```
