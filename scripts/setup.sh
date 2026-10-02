#!/usr/bin/env bash
# Set up (or upgrade) Regulus Office on an existing Linux machine with Docker Compose.
# SPEC §10 Ops, D11, D15: clone the repo on the VM, run this from anywhere in the checkout.
# It never provisions a VM. Safe to re-run: existing secrets and settings in deploy/.env are kept.
#
#   scripts/setup.sh                              interactive first install
#   scripts/setup.sh --domain office.example.com  public hostname (Let's Encrypt)
#   scripts/setup.sh --upgrade                    pull the checkout, rebuild, restart
#   scripts/setup.sh --media                      also run LiveKit: voice and the lounge TV (#48)
#
# Plain `cd deploy && docker compose up -d --build` keeps working (after creating the backup
# directory, see README); this script only adds checks, secret generation, the backup directory,
# the runner image build and a health check around it.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/setup.sh [options]

  --domain <host>        public hostname for the office (default: OFFICE_DOMAIN in deploy/.env,
                         else asked, else localhost). A real hostname gets a Let's Encrypt cert.
  --http-port <port>     host port for HTTP  (default 80;  stored as OFFICE_HTTP_PORT)
  --https-port <port>    host port for HTTPS (default 443; stored as OFFICE_HTTPS_PORT,
                         OFFICE_PUBLIC_URL is set to match)
  --images <mode>        auto (default): pull release images when the checkout is on a release
                         tag, otherwise build from this checkout; build; or pull (release images
                         for OFFICE_IMAGE_TAG, default latest, falling back to a local build)
  --owner-email <email>  create the owner account and a first invite link (needs bun on this host)
  --owner-name <name>    display name for the owner (default "Owner")
  --backup-dir <path>    host directory for the nightly database backups (default: OFFICE_BACKUP_HOST_DIR
                         in deploy/.env, else deploy/backups). Created with mode 700 for uid 1000,
                         the office user; existing backups in it are kept.
  --media                voice chat and screen share to the lounge TV: generate the LiveKit key
                         pair into deploy/.env and start the `media` profile (open TCP 7881 and
                         UDP 7882; docs/deploy/media.md). Stays on for later runs.
  --upgrade              git pull (fast-forward, clean checkout only), rebuild changed images and
                         restart the office; henchmen keep running in their runner containers
  --install-docker       install Docker Engine and the Compose plugin (Ubuntu only; asks first)
  --non-interactive, -y  never prompt; use flags, deploy/.env and defaults, fail on questions
  -h, --help             show this help

Environment: COMPOSE_PROJECT_NAME (default: deploy) and any deploy/.env key override deploy/.env,
as they do for docker compose itself.
EOF
}

# ---------------------------------------------------------------------------------------------
# Output helpers

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_BOLD=$'\e[1m' C_DIM=$'\e[2m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_OFF=$'\e[0m'
else
  C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW="" C_OFF=""
fi
step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_OFF"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %sok%s  %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '    %swarn%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; WARNINGS=$((WARNINGS + 1)); }
fix() { printf '         %s$ %s%s\n' "$C_DIM" "$*" "$C_OFF" >&2; }
die() {
  printf '\n%serror:%s %s\n' "$C_RED" "$C_OFF" "$1" >&2
  shift
  local line
  for line in "$@"; do fix "$line"; done
  exit 1
}
WARNINGS=0

# ---------------------------------------------------------------------------------------------
# Arguments

DOMAIN_ARG="" HTTP_PORT_ARG="" HTTPS_PORT_ARG="" IMAGES_MODE="auto" OWNER_EMAIL="" OWNER_NAME="Owner"
BACKUP_DIR_ARG="" UPGRADE=0 INSTALL_DOCKER=0 INTERACTIVE=1 MEDIA=0
ORIG_ARGS=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN_ARG="${2:?--domain needs a value}"; shift 2 ;;
    --domain=*) DOMAIN_ARG="${1#*=}"; shift ;;
    --http-port) HTTP_PORT_ARG="${2:?--http-port needs a value}"; shift 2 ;;
    --http-port=*) HTTP_PORT_ARG="${1#*=}"; shift ;;
    --https-port) HTTPS_PORT_ARG="${2:?--https-port needs a value}"; shift 2 ;;
    --https-port=*) HTTPS_PORT_ARG="${1#*=}"; shift ;;
    --images) IMAGES_MODE="${2:?--images needs a value}"; shift 2 ;;
    --images=*) IMAGES_MODE="${1#*=}"; shift ;;
    --owner-email) OWNER_EMAIL="${2:?--owner-email needs a value}"; shift 2 ;;
    --owner-email=*) OWNER_EMAIL="${1#*=}"; shift ;;
    --owner-name) OWNER_NAME="${2:?--owner-name needs a value}"; shift 2 ;;
    --owner-name=*) OWNER_NAME="${1#*=}"; shift ;;
    --backup-dir) BACKUP_DIR_ARG="${2:?--backup-dir needs a value}"; shift 2 ;;
    --backup-dir=*) BACKUP_DIR_ARG="${1#*=}"; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    --media) MEDIA=1; shift ;;
    --install-docker) INSTALL_DOCKER=1; shift ;;
    --non-interactive | -y) INTERACTIVE=0; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done
case "$IMAGES_MODE" in auto | build | pull) ;; *) die "--images must be auto, build or pull" ;; esac
for p in "$HTTP_PORT_ARG" "$HTTPS_PORT_ARG"; do
  [[ -z "$p" || ("$p" =~ ^[0-9]+$ && "$p" -ge 1 && "$p" -le 65535) ]] || die "invalid port: $p"
done
[[ -t 0 ]] || INTERACTIVE=0
# Relative to where the script was started, before it changes into deploy/.
if [[ -n "$BACKUP_DIR_ARG" && "$BACKUP_DIR_ARG" != /* ]]; then BACKUP_DIR_ARG="$PWD/$BACKUP_DIR_ARG"; fi

ask() { # ask <prompt> <default> -> REPLY
  local prompt="$1" default="${2:-}"
  if [[ $INTERACTIVE -eq 0 ]]; then REPLY="$default"; return; fi
  read -r -p "    $prompt${default:+ [$default]}: " REPLY </dev/tty || REPLY=""
  REPLY="${REPLY:-$default}"
}
confirm() { # confirm <prompt>; default no; false when non-interactive
  [[ $INTERACTIVE -eq 1 ]] || return 1
  local reply
  read -r -p "    $1 [y/N]: " reply </dev/tty || return 1
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$REPO/deploy"
ENV_FILE="$DEPLOY/.env"
[[ -f "$DEPLOY/docker-compose.yml" ]] || die "run this from a Regulus Office checkout ($DEPLOY/docker-compose.yml not found)"
cd "$DEPLOY"
PROJECT="${COMPOSE_PROJECT_NAME:-deploy}"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/regulus-setup.XXXXXX")"
trap 'rm -rf "$LOG_DIR"' EXIT

# ---------------------------------------------------------------------------------------------
# deploy/.env helpers (values are unquoted KEY=value lines, as in .env.example)

env_get() { # last uncommented KEY=value in deploy/.env, surrounding quotes stripped
  [[ -f "$ENV_FILE" ]] || return 0
  awk -v k="$1" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END {
    gsub(/^[ \t]+|[ \t\r]+$/, "", v)
    if (v ~ /^".*"$/ || v ~ /^'\''.*'\''$/) v = substr(v, 2, length(v) - 2)
    print v }' "$ENV_FILE"
}
cfg() { # like Compose interpolation: the shell environment wins over deploy/.env
  if [[ -n "${!1:-}" ]]; then printf '%s\n' "${!1}"; else env_get "$1"; fi
}
env_set() { # replace KEY=… in place (keeping the file's mode), or append it
  local key="$1" value="$2" tmp="$ENV_FILE.tmp.$$"
  if grep -q "^$key=" "$ENV_FILE"; then
    K="$key" V="$value" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
      index($0, k "=") == 1 { print k "=" v; next } { print }' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}
new_secret() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
b64_bytes() { printf '%s' "$1" | base64 -d 2>/dev/null | wc -c | tr -d ' '; }
is_b64_32() { [[ ${#1} -eq 44 && "$1" =~ ^[A-Za-z0-9+/]{43}=$ && "$(b64_bytes "$1")" -eq 32 ]]; }

version_ge() { # version_ge 2.24.0 2.20 -> true
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" == "$2" ]]
}
is_local_domain() {
  [[ "$1" == localhost || "$1" == *.localhost || "$1" =~ ^[0-9.]+$ || "$1" == *:* ]]
}
port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    [[ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]]
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}
dc() { docker compose "$@"; }

# ---------------------------------------------------------------------------------------------
# Upgrade: fast-forward the checkout first, then run the (possibly new) script again.

if [[ $UPGRADE -eq 1 && -z "${REGULUS_SETUP_REEXEC:-}" ]]; then
  step "Updating the checkout"
  if ! git -C "$REPO" rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
    warn "no upstream branch (detached HEAD or a tag); not pulling. Check out the version you want, then re-run."
  elif [[ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]]; then
    warn "the checkout has local changes; not pulling. Commit or stash them, then re-run."
    fix "git -C $REPO status"
  else
    before="$(git -C "$REPO" rev-parse HEAD)"
    timeout 120 git -C "$REPO" pull --ff-only ||
      die "git pull --ff-only failed (diverged or offline); resolve it and re-run" "git -C $REPO status"
    if [[ "$(git -C "$REPO" rev-parse HEAD)" != "$before" ]]; then
      ok "updated to $(git -C "$REPO" log -1 --format='%h %s')"
      export REGULUS_SETUP_REEXEC=1
      exec "$REPO/scripts/setup.sh" "${ORIG_ARGS[@]}"
    fi
    ok "already up to date ($(git -C "$REPO" log -1 --format=%h))"
  fi
fi

# ---------------------------------------------------------------------------------------------
# 1. Prerequisites

install_docker_ubuntu() {
  # Docker's apt repository, as in https://docs.docker.com/engine/install/ubuntu/
  local sudo=""
  [[ $EUID -eq 0 ]] || sudo="sudo"
  $sudo apt-get update -q
  $sudo apt-get install -y -q ca-certificates curl
  $sudo install -m 0755 -d /etc/apt/keyrings
  $sudo curl -fsSL --max-time 60 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  $sudo chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" |
    $sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  $sudo apt-get update -q
  $sudo apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if [[ $EUID -ne 0 ]]; then
    $sudo usermod -aG docker "$USER"
    info "Added $USER to the docker group. Log out and back in (or run: newgrp docker), then re-run this script."
    exit 0
  fi
}

step "Checking prerequisites"
[[ "$(uname -s)" == Linux ]] || die "Regulus Office runs on Linux (found $(uname -s)); use an Ubuntu 24.04 VM"
OS_ID="" OS_NAME="Linux"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  OS_ID="$(. /etc/os-release && echo "${ID:-}")"
  # shellcheck disable=SC1091
  OS_NAME="$(. /etc/os-release && echo "${PRETTY_NAME:-Linux}")"
fi
case "$OS_ID" in
  ubuntu | debian) ok "$OS_NAME, $(uname -m)" ;;
  *) warn "$OS_NAME is not tested; Ubuntu 24.04 LTS is the reference. Continuing (Docker 27+ is what matters)." ;;
esac
for tool in curl git awk base64; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is missing" "sudo apt-get install -y $tool"
done

if ! command -v docker >/dev/null 2>&1; then
  if [[ $INSTALL_DOCKER -eq 1 ]]; then
    [[ "$OS_ID" == ubuntu ]] || die "--install-docker only supports Ubuntu; install Docker Engine: https://docs.docker.com/engine/install/"
    info "This installs Docker Engine, Buildx and the Compose plugin from Docker's apt repository (uses sudo)."
    if [[ $INTERACTIVE -eq 1 ]] && ! confirm "Install Docker now?"; then die "Docker is required"; fi
    install_docker_ubuntu
  else
    die "Docker is not installed" \
      "scripts/setup.sh --install-docker        # Ubuntu: installs from Docker's apt repository" \
      "# or follow https://docs.docker.com/engine/install/"
  fi
fi
if ! docker_err="$(docker info 2>&1 >/dev/null)"; then
  if [[ "$docker_err" == *"permission denied"* ]]; then
    die "this user cannot talk to the Docker daemon" "sudo usermod -aG docker \"\$USER\"   # then log out and back in" "# or run this script with sudo"
  fi
  die "the Docker daemon is not reachable: ${docker_err##*$'\n'}" "sudo systemctl enable --now docker"
fi
docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 0)"
version_ge "$docker_version" 27.0 ||
  die "Docker $docker_version is too old; 27+ is required (runners mount volume subpaths)" \
    "# Ubuntu: upgrade from Docker's apt repository: sudo apt-get install --only-upgrade docker-ce docker-ce-cli docker-compose-plugin docker-buildx-plugin"
ok "Docker $docker_version"
compose_version="$(docker compose version --short 2>/dev/null || true)"
[[ -n "$compose_version" ]] || die "the Docker Compose plugin is missing" "sudo apt-get install -y docker-compose-plugin"
compose_version="${compose_version#v}"
version_ge "$compose_version" 2.24 || die "Docker Compose $compose_version is too old; 2.24+ is required" \
  "sudo apt-get install --only-upgrade docker-compose-plugin"
ok "Docker Compose $compose_version"
docker buildx version >/dev/null 2>&1 || die "Docker Buildx is missing (Compose builds need it)" "sudo apt-get install -y docker-buildx-plugin"

mem_gb=$(awk '/^MemTotal:/ { printf "%d", ($2 / 1048576) + 0.5 }' /proc/meminfo)
if [[ $mem_gb -lt 4 ]]; then
  warn "${mem_gb} GB RAM; the minimum is 4 GB (1-3 agents), 16 GB is recommended for a team (README, Recommended machine)"
else
  ok "${mem_gb} GB RAM"
fi
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
[[ -d "$docker_root" ]] || docker_root=/
free_gb=$(df -Pk "$docker_root" 2>/dev/null | awk 'NR == 2 { printf "%d", $4 / 1048576 }')
total_gb=$(df -Pk "$docker_root" 2>/dev/null | awk 'NR == 2 { printf "%d", $2 / 1048576 }')
if [[ ${free_gb:-0} -lt 10 ]]; then
  warn "only ${free_gb:-?} GB free for Docker ($docker_root); the images need ~4 GB plus room for checkouts and worktrees"
  fix "docker system df        # see what Docker uses; docker image prune removes unused images"
elif [[ ${total_gb:-0} -lt 40 ]]; then
  warn "${total_gb} GB disk; 40 GB is the minimum, 100 GB recommended"
else
  ok "${free_gb} GB free of ${total_gb} GB for Docker"
fi
if [[ $(awk 'NR > 1' /proc/swaps 2>/dev/null | wc -l) -eq 0 ]]; then
  warn "no swap; agent memory use is spiky, add 2-4 GB:"
  fix "sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
  fix "echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
else
  ok "swap enabled"
fi

# ---------------------------------------------------------------------------------------------
# 2. deploy/.env

step "Configuring deploy/.env"
FRESH=0
if [[ ! -f "$ENV_FILE" ]]; then
  (umask 077 && cp "$DEPLOY/.env.example" "$ENV_FILE")
  FRESH=1
  ok "created deploy/.env from .env.example"
else
  ok "keeping existing deploy/.env"
fi
chmod 600 "$ENV_FILE"

# Secrets: generated when empty, never replaced. A pasted value that lost characters is the
# classic failure (the server then refuses to start), so check the shape before starting.
for name in BETTER_AUTH_SECRET OFFICE_MASTER_KEY; do
  current="$(env_get "$name")"
  if [[ -z "$current" ]]; then
    env_set "$name" "$(new_secret)"
    ok "generated $name (32 random bytes, base64)"
    continue
  fi
  if is_b64_32 "$current"; then
    ok "$name present (44 characters, 32 bytes)"
  elif [[ "$name" == BETTER_AUTH_SECRET && ${#current} -ge 32 ]]; then
    warn "BETTER_AUTH_SECRET is ${#current} characters, not a 44-character 'openssl rand -base64 32' value. If it was pasted, check it was not cut off. Kept as is."
  elif [[ "$name" == BETTER_AUTH_SECRET ]]; then
    die "BETTER_AUTH_SECRET in deploy/.env is ${#current} characters; the server needs at least 32 (it looks truncated)." \
      "# Replacing it only signs everyone out. To generate a new one:" \
      "sed -i \"s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=\$(head -c 32 /dev/urandom | base64)|\" $ENV_FILE"
  else
    die "OFFICE_MASTER_KEY in deploy/.env is ${#current} characters and decodes to $(b64_bytes "$current") bytes; it must be 44 characters decoding to 32 bytes (it looks truncated or mistyped)." \
      "# If you still have the original value, put it back. The key encrypts stored API keys and the GitHub connection." \
      "# Only if the office has never stored anything with it (fresh install), generate a new one:" \
      "sed -i \"s|^OFFICE_MASTER_KEY=.*|OFFICE_MASTER_KEY=\$(head -c 32 /dev/urandom | base64)|\" $ENV_FILE"
  fi
done

# Domain.
OLD_DOMAIN="$(env_get OFFICE_DOMAIN)"
DOMAIN="$OLD_DOMAIN"
if [[ -n "$DOMAIN_ARG" ]]; then
  DOMAIN="$DOMAIN_ARG"
elif [[ $FRESH -eq 1 || -z "$DOMAIN" ]]; then
  info "The hostname people will open, e.g. office.example.com (DNS must point at this machine for"
  info "a Let's Encrypt certificate). 'localhost' serves https://localhost with Caddy's internal CA."
  ask "Domain" "${DOMAIN:-localhost}"
  DOMAIN="$REPLY"
fi
DOMAIN="${DOMAIN:-localhost}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid domain: $DOMAIN (a hostname without scheme or port, e.g. office.example.com)"
[[ "$(env_get OFFICE_DOMAIN)" == "$DOMAIN" ]] || env_set OFFICE_DOMAIN "$DOMAIN"
ok "domain: $DOMAIN"

# Ports. A port our own Caddy already holds is fine (re-run); anything else is a conflict.
own_caddy_running() { [[ -n "$(dc ps --status running -q caddy 2>/dev/null)" ]]; }
HTTP_PORT="${HTTP_PORT_ARG:-$(env_get OFFICE_HTTP_PORT)}"
HTTPS_PORT="${HTTPS_PORT_ARG:-$(env_get OFFICE_HTTPS_PORT)}"
HTTP_PORT="${HTTP_PORT:-80}" HTTPS_PORT="${HTTPS_PORT:-443}"
if ! own_caddy_running; then
  for kind in HTTP HTTPS; do
    var="${kind}_PORT"
    while port_in_use "${!var}"; do
      warn "port ${!var} ($kind) is already in use on this machine:"
      if command -v ss >/dev/null 2>&1; then
        ss -Hltnp "sport = :${!var}" 2>/dev/null | sed 's/^/         /' >&2 || true
      fi
      if [[ $INTERACTIVE -eq 0 ]]; then
        die "free port ${!var} or pick other host ports (OFFICE_HTTP_PORT/OFFICE_HTTPS_PORT)" \
          "scripts/setup.sh --non-interactive --http-port 8080 --https-port 8443"
      fi
      if [[ $kind == HTTP ]]; then ask "Another host port for HTTP" 8080; else ask "Another host port for HTTPS" 8443; fi
      [[ "$REPLY" =~ ^[0-9]+$ && "$REPLY" -ge 1 && "$REPLY" -le 65535 ]] || { warn "not a port: $REPLY"; continue; }
      printf -v "$var" '%s' "$REPLY"
    done
  done
fi
for kind in HTTP HTTPS; do
  var="${kind}_PORT" key="OFFICE_${kind}_PORT" default=80
  [[ $kind == HTTPS ]] && default=443
  if [[ "${!var}" != "$default" || -n "$(env_get "$key")" ]]; then
    [[ "$(env_get "$key")" == "${!var}" ]] || env_set "$key" "${!var}"
  fi
done
PUBLIC_URL="https://$DOMAIN"
[[ "$HTTPS_PORT" == 443 ]] || PUBLIC_URL="https://$DOMAIN:$HTTPS_PORT"
# OFFICE_PUBLIC_URL must equal the browser's origin; keep it in step with domain and port unless
# it points somewhere else on purpose (e.g. a load balancer in front).
existing_url="$(env_get OFFICE_PUBLIC_URL)"
url_host="${existing_url#https://}" url_host="${url_host%/}" url_host="${url_host%:*}"
if [[ -z "$existing_url" && "$PUBLIC_URL" == "https://$DOMAIN" ]]; then
  : # Compose defaults it to https://$OFFICE_DOMAIN
elif [[ -z "$existing_url" || ("$existing_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ &&
  ("$url_host" == localhost || "$url_host" == "$DOMAIN" || "$url_host" == "$OLD_DOMAIN")) ]]; then
  [[ "$existing_url" == "$PUBLIC_URL" ]] || env_set OFFICE_PUBLIC_URL "$PUBLIC_URL"
else
  PUBLIC_URL="$existing_url"
  info "keeping OFFICE_PUBLIC_URL=$existing_url"
fi
ok "ports: HTTP $HTTP_PORT, HTTPS $HTTPS_PORT; office URL $PUBLIC_URL"
if ! is_local_domain "$DOMAIN" && [[ "$HTTP_PORT" != 80 || "$HTTPS_PORT" != 443 ]]; then
  warn "Let's Encrypt validates on ports 80/443; with other host ports forward 80/443 to them, or Caddy cannot get a certificate for $DOMAIN"
fi

# DNS (warning only: the record may still be propagating, or the VM sits behind NAT).
if ! is_local_domain "$DOMAIN"; then
  resolved="$(getent ahosts "$DOMAIN" 2>/dev/null | awk '{ print $1 }' | sort -u | tr '\n' ' ')"
  local_ips=" $(hostname -I 2>/dev/null || true) "
  if [[ -z "$resolved" ]]; then
    warn "$DOMAIN does not resolve yet; add an A/AAAA record pointing at this machine, or Caddy cannot get a certificate"
  else
    match=0
    for ip in $resolved; do [[ "$local_ips" == *" $ip "* ]] && match=1; done
    if [[ $match -eq 1 ]]; then ok "$DOMAIN resolves to this machine ($resolved)"; else
      warn "$DOMAIN resolves to $resolved, which is not an address of this machine (${local_ips# }); fine behind NAT or a load balancer, otherwise fix the DNS record"
    fi
  fi
fi

# Voice and the lounge TV (#48, docs/deploy/media.md): LiveKit under the Compose `media` profile.
# On with --media, and stays on once deploy/.env has COMPOSE_PROFILES=media. The key pair is
# generated once and never printed; LiveKit reads it from LIVEKIT_KEYS (livekit.yaml has none).
new_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
PROFILES="$(cfg COMPOSE_PROFILES)"
[[ ",$PROFILES," == *,media,* ]] && MEDIA=1
if [[ $MEDIA -eq 1 ]]; then
  if [[ -z "$(env_get LIVEKIT_API_KEY)" ]]; then
    env_set LIVEKIT_API_KEY "API$(new_hex 8)"
    ok "generated LIVEKIT_API_KEY"
  fi
  lk_secret_len="$(env_get LIVEKIT_API_SECRET | tr -d '\n' | wc -c | tr -d ' ')"
  if [[ "$lk_secret_len" -eq 0 ]]; then
    env_set LIVEKIT_API_SECRET "$(new_hex 32)"
    ok "generated LIVEKIT_API_SECRET (32 random bytes, hex)"
  elif [[ "$lk_secret_len" -lt 32 ]]; then
    die "LIVEKIT_API_SECRET in deploy/.env is $lk_secret_len characters; LiveKit needs at least 32." \
      "# Empty it and re-run scripts/setup.sh --media to generate one (everyone reconnects)."
  else
    ok "LIVEKIT_API_SECRET present"
  fi
  if [[ ",$PROFILES," != *,media,* ]]; then
    PROFILES="${PROFILES:+$PROFILES,}media"
    env_set COMPOSE_PROFILES "$PROFILES"
  fi
  export COMPOSE_PROFILES="$PROFILES"
  # On a local domain STUN would advertise this machine's public address, which a browser on
  # this machine may not reach through NAT; advertise loopback instead unless already set.
  if is_local_domain "$DOMAIN" && [[ -z "$(env_get LIVEKIT_NODE_IP)$(env_get LIVEKIT_USE_EXTERNAL_IP)" ]]; then
    env_set LIVEKIT_USE_EXTERNAL_IP false
    env_set LIVEKIT_NODE_IP 127.0.0.1
  fi
  LK_TCP="$(cfg LIVEKIT_TCP_PORT)" LK_UDP="$(cfg LIVEKIT_UDP_PORT)"
  LK_TCP="${LK_TCP:-7881}" LK_UDP="${LK_UDP:-7882}"
  if [[ -z "$(dc ps --status running -q livekit 2>/dev/null)" ]] && port_in_use "$LK_TCP"; then
    die "port $LK_TCP (LiveKit TCP) is already in use on this machine" "# set LIVEKIT_TCP_PORT in $ENV_FILE to a free port"
  fi
  ok "media: LiveKit on TCP $LK_TCP and UDP $LK_UDP (open both in the firewall); signalling at $PUBLIC_URL/livekit"
fi

# ---------------------------------------------------------------------------------------------
# 3. Backup directory (#203): nightly backups go to a host directory, not the office-data volume,
# so deleting the volume does not delete them. The `backup` service runs as uid 1000 (the office
# user, which owns the database) and writes there; mode 700 keeps it private on the host.

BACKUP_UID=1000
as_root() { # as_root <command...>: directly when root, else with sudo (asks for a password only when interactive)
  if [[ $EUID -eq 0 ]]; then "$@"
  elif ! command -v sudo >/dev/null 2>&1; then return 1
  elif sudo -n true 2>/dev/null; then sudo "$@"
  elif [[ $INTERACTIVE -eq 1 ]]; then info "sudo: $*"; sudo "$@"
  else return 1; fi
}

step "Backups"
BACKUP_DIR="$(cfg OFFICE_BACKUP_HOST_DIR)"
if [[ -n "$BACKUP_DIR_ARG" ]]; then
  BACKUP_DIR="$BACKUP_DIR_ARG"
  [[ "$(env_get OFFICE_BACKUP_HOST_DIR)" == "$BACKUP_DIR" ]] || env_set OFFICE_BACKUP_HOST_DIR "$BACKUP_DIR"
fi
BACKUP_DIR="${BACKUP_DIR:-./backups}"
[[ "$BACKUP_DIR" == /* ]] || BACKUP_DIR="$DEPLOY/${BACKUP_DIR#./}"
[[ "$BACKUP_DIR" != *:* ]] || die "the backup directory must not contain ':' ($BACKUP_DIR)"
if [[ ! -d "$BACKUP_DIR" ]]; then
  if ! (umask 077 && mkdir -p "$BACKUP_DIR") 2>/dev/null && ! as_root install -d -m 700 "$BACKUP_DIR"; then
    die "cannot create the backup directory $BACKUP_DIR" \
      "sudo install -d -m 700 -o $BACKUP_UID -g $BACKUP_UID $BACKUP_DIR    # then re-run this script"
  fi
  ok "created $BACKUP_DIR"
fi
# Only the directory itself is adjusted; files already in it are never touched.
if [[ "$(stat -c %u "$BACKUP_DIR")" != "$BACKUP_UID" ]]; then
  as_root chown "$BACKUP_UID:$BACKUP_UID" "$BACKUP_DIR" ||
    die "$BACKUP_DIR must belong to uid $BACKUP_UID (the office user the backup service runs as)" \
      "sudo chown $BACKUP_UID:$BACKUP_UID $BACKUP_DIR    # then re-run this script"
fi
if [[ "$(stat -c %a "$BACKUP_DIR")" != 700 ]]; then
  chmod 700 "$BACKUP_DIR" 2>/dev/null || as_root chmod 700 "$BACKUP_DIR" ||
    die "cannot set mode 700 on $BACKUP_DIR" "sudo chmod 700 $BACKUP_DIR"
fi
BACKUP_TIME="$(cfg OFFICE_BACKUP_TIME)" BACKUP_TIME="${BACKUP_TIME:-03:00}"
BACKUP_RETENTION="$(cfg OFFICE_BACKUP_RETENTION_DAYS)" BACKUP_RETENTION="${BACKUP_RETENTION:-14}"
[[ "$BACKUP_TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "OFFICE_BACKUP_TIME must be HH:MM (UTC), got '$BACKUP_TIME'"
[[ "$BACKUP_RETENTION" =~ ^[0-9]+$ ]] || die "OFFICE_BACKUP_RETENTION_DAYS must be a whole number of days, got '$BACKUP_RETENTION'"
ok "$BACKUP_DIR (mode 700, uid $BACKUP_UID): daily at $BACKUP_TIME UTC, kept $([[ $BACKUP_RETENTION == 0 ]] && echo forever || echo "$BACKUP_RETENTION days")"

# ---------------------------------------------------------------------------------------------
# 4. Images

TAG="$(cfg OFFICE_IMAGE_TAG)"
if [[ "$IMAGES_MODE" == auto ]]; then
  release="$(git -C "$REPO" describe --exact-match --tags --match 'v[0-9]*' HEAD 2>/dev/null || true)"
  if [[ -n "$release" && -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]]; then
    IMAGES_MODE=pull
    TAG="${release#v}"
    [[ "$(env_get OFFICE_IMAGE_TAG)" == "$TAG" || -n "${OFFICE_IMAGE_TAG:-}" ]] || env_set OFFICE_IMAGE_TAG "$TAG"
  else
    IMAGES_MODE=build
  fi
fi
if [[ "$IMAGES_MODE" == build && "$TAG" =~ ^[0-9]+\.[0-9]+ ]]; then
  warn "OFFICE_IMAGE_TAG=$TAG names a release, but this checkout is not on tag v$TAG; the local build is tagged $TAG anyway. Clear OFFICE_IMAGE_TAG in deploy/.env to build as latest."
fi
export OFFICE_IMAGE_TAG="${TAG:-latest}"
OFFICE_IMAGE="ghcr.io/regulus-advanced-systems/regulus-office:$OFFICE_IMAGE_TAG"
RUNNER_IMAGE="$(cfg OFFICE_RUNNER_IMAGE)"
RUNNER_IMAGE="${RUNNER_IMAGE:-ghcr.io/regulus-advanced-systems/regulus-office-runner:$OFFICE_IMAGE_TAG}"
RUNNER_TREE_LABEL=org.regulus.office.runner-tree
RUNNER_TREE="$(git -C "$REPO" rev-parse HEAD:runner 2>/dev/null || echo unknown)"
if [[ -n "$(git -C "$REPO" status --porcelain -- "$REPO/runner" 2>/dev/null)" ]]; then RUNNER_TREE="$RUNNER_TREE-dirty"; fi

# Runs a build, keeping its output; on BuildKit's corrupted-cache error explains and offers a prune.
run_build() { # run_build <label> <command...>
  local label="$1" log="$LOG_DIR/build.log" attempt
  shift
  for attempt in 1 2; do
    if "$@" 2>&1 | tee "$log"; then return 0; fi
    if grep -Eq 'parent snapshot .* does not exist|failed to prepare extraction snapshot|snapshot .* does not exist' "$log"; then
      printf '\n' >&2
      warn "the $label build failed because Docker's build cache is corrupted (a cached layer points at a snapshot that no longer exists; this happens after an interrupted build or a disk cleanup)."
      info "Clearing the build cache fixes it. It removes only cached build layers: no images, containers, volumes or data. The next build is slower (the runner image ~7 minutes)."
      fix "docker builder prune -f"
      if [[ $attempt -eq 1 ]] && confirm "Clear the build cache now and retry?"; then
        docker builder prune -f
        continue
      fi
      die "$label build failed (corrupted build cache); run the command above, then re-run this script"
    fi
    die "$label build failed; see the output above" "scripts/setup.sh    # re-run once the cause is fixed"
  done
}
pull_image() { timeout 900 docker pull "$1"; }

step "Office image"
if [[ "$IMAGES_MODE" == pull ]] && pull_image "$OFFICE_IMAGE"; then
  ok "pulled $OFFICE_IMAGE"
else
  [[ "$IMAGES_MODE" == pull ]] && warn "could not pull $OFFICE_IMAGE; building it from this checkout instead"
  info "building $OFFICE_IMAGE from this checkout (a few minutes the first time)"
  run_build office timeout 3600 docker compose build office
  ok "built $OFFICE_IMAGE"
fi

step "Runner image"
current_tree="$(docker image inspect --format "{{ index .Config.Labels \"$RUNNER_TREE_LABEL\" }}" "$RUNNER_IMAGE" 2>/dev/null || true)"
if [[ "$IMAGES_MODE" == pull ]] && pull_image "$RUNNER_IMAGE"; then
  ok "pulled $RUNNER_IMAGE"
elif [[ "$current_tree" == "$RUNNER_TREE" && "$RUNNER_TREE" != *dirty ]]; then
  ok "$RUNNER_IMAGE is up to date with runner/ (built from tree ${RUNNER_TREE:0:12})"
else
  if [[ -n "$current_tree" ]]; then
    info "runner/ changed since $RUNNER_IMAGE was built; rebuilding (cached layers are reused)"
  elif docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1; then
    info "rebuilding $RUNNER_IMAGE so it is known to match this checkout (cached layers are reused)"
  else
    info "building $RUNNER_IMAGE: about 7 minutes and 3 GB the first time (Node, Bun, Python, uv, gh, agent CLIs)"
  fi
  # Same Dockerfile and tag as `docker compose --profile build-only build runner-image`, plus a
  # label recording which runner/ tree it came from so re-runs skip an up-to-date image.
  run_build runner timeout 3600 docker build --label "$RUNNER_TREE_LABEL=$RUNNER_TREE" -t "$RUNNER_IMAGE" "$REPO/runner"
  ok "built $RUNNER_IMAGE"
fi

# ---------------------------------------------------------------------------------------------
# 5. Start and check

step "Starting the office (Compose project '$PROJECT')"
# --no-build: the images were built or pulled above (runner containers are not Compose services).
if ! dc up -d --wait --wait-timeout 180 --no-build; then
  dc ps -a >&2 || true
  dc logs --no-color --tail 40 office caddy backup >&2 || true
  die "the stack did not become healthy; see the logs above" "cd $DEPLOY && docker compose logs office caddy backup"
fi
ok "containers healthy"
latest_backup="$(find "$BACKUP_DIR" -maxdepth 1 -name 'office-*.db' -printf '%f\n' 2>/dev/null | sort | tail -1 || true)"
if [[ -n "$latest_backup" ]]; then ok "latest backup: $latest_backup"; elif [[ ! -r "$BACKUP_DIR" ]]; then
  ok "backup service healthy (the directory is readable by uid $BACKUP_UID only)"
fi

health_url="https://$DOMAIN:$HTTPS_PORT/healthz"
healthy=0
for _ in $(seq 1 60); do
  if curl -fsSk --max-time 5 --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "$health_url" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ $healthy -eq 1 ]]; then
  ok "$health_url answers through Caddy"
elif is_local_domain "$DOMAIN"; then
  dc logs --no-color --tail 40 caddy >&2 || true
  die "$health_url does not answer through Caddy" "cd $DEPLOY && docker compose logs caddy"
else
  warn "$health_url does not answer yet; usually Caddy is still getting the certificate (needs DNS and inbound 80/443)"
  fix "cd $DEPLOY && docker compose logs -f caddy"
fi
if [[ $MEDIA -eq 1 && $healthy -eq 1 ]]; then
  # LiveKit answers "OK" on / ; through Caddy that is /livekit/.
  if curl -fsSk --max-time 5 --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "https://$DOMAIN:$HTTPS_PORT/livekit/" 2>/dev/null | grep -q OK; then
    ok "LiveKit answers at $PUBLIC_URL/livekit"
  else
    warn "LiveKit does not answer at $PUBLIC_URL/livekit; voice and the lounge TV stay off until it does"
    fix "cd $DEPLOY && docker compose logs livekit"
  fi
fi

# ---------------------------------------------------------------------------------------------
# 6. First owner

if [[ -z "$OWNER_EMAIL" && $FRESH -eq 1 && $INTERACTIVE -eq 1 ]] && command -v bun >/dev/null 2>&1; then
  info "Create the owner account now? (Or leave empty and register in the browser: the first account becomes owner.)"
  ask "Owner email" ""
  OWNER_EMAIL="$REPLY"
  if [[ -n "$OWNER_EMAIL" ]]; then
    ask "Owner name" "$OWNER_NAME"
    OWNER_NAME="$REPLY"
  fi
fi
if [[ -n "$OWNER_EMAIL" ]]; then
  step "Creating the owner account"
  if ! command -v bun >/dev/null 2>&1; then
    warn "bun is not installed on this host, so the seed script cannot run; register at $PUBLIC_URL/login instead"
    fix "curl -fsSL https://bun.sh/install | bash    # then: bun install && bun run seed --url $PUBLIC_URL --email $OWNER_EMAIL"
  elif ! (cd "$REPO" && timeout 300 bun install --frozen-lockfile >/dev/null &&
    bun run seed --url "$PUBLIC_URL" --email "$OWNER_EMAIL" --name "$OWNER_NAME"); then
    warn "creating the owner failed (see above); register at $PUBLIC_URL/login instead, or run the seed again once the URL works:"
    fix "bun run seed --url $PUBLIC_URL --email $OWNER_EMAIL"
  fi
fi

# ---------------------------------------------------------------------------------------------
# 7. Next steps

if [[ $WARNINGS -gt 0 ]]; then step "Done, with $WARNINGS warning(s) above"; else step "Done"; fi
cat <<EOF

    Office:     $PUBLIC_URL
    Config:     $ENV_FILE (mode 600; keep a copy of OFFICE_MASTER_KEY somewhere safe)

  Next steps
    1. Open $PUBLIC_URL/login.$(is_local_domain "$DOMAIN" && printf ' Accept the certificate once (Caddy internal CA)\n       or run: cd deploy && docker compose exec caddy caddy trust.')
       The first account you register becomes the owner; invite others from
       Settings -> Invite someone...
    2. Connect GitHub (operations work on GitHub repos): Settings -> GitHub -> Create GitHub App...,
       then install the app on your organization. Already have an app from an earlier
       install? Use an existing GitHub App... instead (App ID + its .pem private key).
       Webhooks need $PUBLIC_URL to be reachable from GitHub; otherwise the office polls.
       (Fallback: a fine-grained organization token.)
    3. Notifications: each person turns on desktop notifications for their own henchmen in
       Settings -> Notifications. For the team, an owner or admin opens
       Settings -> Team notifications -> Add channel..., picks Slack (incoming webhook URL),
       Discord (channel webhook URL) or Telegram (bot token + chat id), the operations and events,
       and clicks Send test. Steps for each service: README "Notifications".
    4. Each teammate signs in to their AI providers (Claude Code, Codex, ...) from their own
       runner terminal in the office; logins stay in their runner's HOME volume.
    5. Keep a copy of deploy/.env (the secrets) and of the backups off this machine.
$(if [[ $MEDIA -eq 1 ]]; then
  printf '    6. Voice and the lounge TV: open TCP %s and UDP %s in the firewall (ufw and cloud\n' "$LK_TCP" "$LK_UDP"
  printf '       firewall rules: docs/deploy/media.md), then check with two browsers.\n'
else
  printf '    6. Voice chat and screen share to the lounge TV are off: scripts/setup.sh --media\n'
  printf '       turns them on (docs/deploy/media.md).\n'
fi)

  Backups (README "Backups and restore")
    Where:      $BACKUP_DIR, daily at $BACKUP_TIME UTC, kept $([[ $BACKUP_RETENTION == 0 ]] && echo forever || echo "$BACKUP_RETENTION days")
                (the database only; operation repos live on GitHub). Not in the office-data volume.
    Now:        cd deploy && docker compose exec backup scripts/backup.sh
    Restore:    scripts/restore.sh                (lists backups)
                scripts/restore.sh <backup-name>  (stops the office, restores, starts it again)

  Later
    Upgrade:    scripts/setup.sh --upgrade      (henchmen keep running in their runners)
    Logs:       cd deploy && docker compose logs -f office
    Stop:       cd deploy && docker compose down (runners keep running; see README)
EOF
