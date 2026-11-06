#!/usr/bin/env bash
set -euo pipefail
# Never echo credentials or disable host verification. Pin the VM host key from
# its trusted console, not an unauthenticated keyscan on this runner.
: "${DEPLOY_KEY:?Missing prod secret DEPLOY_KEY}"
: "${DEPLOY_KNOWN_HOSTS:?Missing prod variable DEPLOY_KNOWN_HOSTS}"
node tools/deploy/gcp/release.mjs validate
ssh_dir=$(mktemp -d "$RUNNER_TEMP/terminal-state-ssh.XXXXXX")
remote_dir=''
cleanup() {
  if [[ "$remote_dir" =~ ^/tmp/terminal-state\.[a-zA-Z0-9]+$ ]]; then
    # The strictly validated staging path must expand on this runner.
    # shellcheck disable=SC2029
    ssh "${ssh_options[@]}" "$target" "rm -rf -- '$remote_dir'" || true
  fi
  rm -rf -- "$ssh_dir"
}
trap cleanup EXIT
printf '%s\n' "$DEPLOY_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
unset DEPLOY_KEY DEPLOY_KNOWN_HOSTS
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
ssh-keygen -y -P '' -f "$ssh_dir/key" > /dev/null
ssh_options=(-i "$ssh_dir/key" -p "$DEPLOY_PORT" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts"
  -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
target="$DEPLOY_USER@$DEPLOY_HOST"
ssh "${ssh_options[@]}" "$target" 'sudo -n true'
remote_dir=$(ssh "${ssh_options[@]}" "$target" 'umask 077; mktemp -d /tmp/terminal-state.XXXXXXXXXX')
[[ "$remote_dir" =~ ^/tmp/terminal-state\.[a-zA-Z0-9]+$ ]] || { echo 'Invalid staging path'; exit 1; }
# Stream the archive over authenticated SSH; the VM does no build or compression.
# shellcheck disable=SC2029
ssh "${ssh_options[@]}" "$target" "cat > '$remote_dir/release.tar'" < "$RUNNER_TEMP/terminal-state-release.tar"
# shellcheck disable=SC2029
ssh "${ssh_options[@]}" "$target" "tar --no-same-owner -xf '$remote_dir/release.tar' -C '$remote_dir' && sudo -n bash '$remote_dir/install.sh' '$remote_dir'"
