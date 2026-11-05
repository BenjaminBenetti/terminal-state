#!/usr/bin/env bash
# Idempotent bootstrap for this dedicated Rocky Linux 10 Compute Engine VM.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with passwordless sudo'; exit 1; }
stage=$(realpath "${1:?Expected staging directory}")
[[ "$stage" =~ ^/tmp/terminal-state\.[a-zA-Z0-9]+$ ]] || { echo 'Invalid staging path'; exit 1; }
exec 9>/run/terminal-state-deploy.lock
flock -w 1800 9
# shellcheck source=/dev/null
source /etc/os-release
[[ "$ID" == rocky && "$VERSION_ID" == 10* ]] || { echo 'This installer targets Rocky Linux 10'; exit 1; }
python3 "$stage/verify.py" "$stage"
readarray -t config < <(python3 - "$stage/deploy.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for key in ('commit', 'domain', 'tag', 'cap_bytes', 'acme_email'):
    print(d[key])
PY
)
commit=${config[0]}; domain=${config[1]}; tag=${config[2]}; cap=${config[3]}; email=${config[4]}
root=/srv/terminal-state
install -d -m 755 "$root/releases" /etc/terminal-state /usr/local/libexec/terminal-state
previous=$(readlink -f "$root/current" || true)
# Reject delayed workflows for an older source commit (including queued old tags).
if [[ -f "$root/current/deploy.json" ]]; then
  old_commit=$(python3 -c 'import json; print(json.load(open("/srv/terminal-state/current/deploy.json"))["commit"])')
  # The runner includes all ancestors as plain SHA lines, generated from git.
  [[ "$commit" == "$old_commit" ]] || grep -Fxq "$old_commit" "$stage/ancestors.txt" || {
    echo 'Production is newer or divergent; refusing to overwrite it'; exit 1;
  }
fi

# No full OS upgrade or build on the micro VM. Only install required packages.
dnf -y install epel-release dnf-plugins-core
dnf config-manager --set-enabled crb
dnf -y install nginx nginx-mod-brotli certbot policycoreutils-python-utils curl
install -d -m 755 /var/lib/terminal-state-acme/.well-known/acme-challenge /var/lib/terminal-state-bandwidth
touch /var/lib/terminal-state-bandwidth/cutoff
chmod 644 /var/lib/terminal-state-bandwidth/cutoff
install -m 644 "$stage/cutoff.html" /usr/share/nginx/html/terminal-state-cutoff.html
install -m 755 "$stage/bandwidth.py" /usr/local/libexec/terminal-state/bandwidth.py
install -m 644 "$stage/bandwidth.service" /etc/systemd/system/terminal-state-bandwidth.service
install -d -m 755 /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/terminal-state.conf <<'UNIT'
[Unit]
After=terminal-state-bandwidth.service
BindsTo=terminal-state-bandwidth.service
[Service]
# Terminate downloads promptly at cutoff, rather than gracefully draining them.
KillSignal=SIGTERM
TimeoutStopSec=3
ExecStop=
ExecStop=/bin/kill -s TERM $MAINPID
UNIT
python3 - "$cap" <<'PY'
import json, subprocess, sys
routes = json.loads(subprocess.check_output(['ip', '-j', 'route', 'show', 'default']))
devices = {r['dev'] for r in routes if 'dev' in r}
if len(devices) != 1:
    raise SystemExit('Expected one default outbound NIC')
with open('/etc/terminal-state/bandwidth.json', 'w') as stream:
    json.dump({'cap_bytes': int(sys.argv[1]), 'interface': devices.pop()}, stream)
PY
if command -v getenforce >/dev/null && [[ $(getenforce) != Disabled ]]; then
  for path in '/srv/terminal-state(/.*)?' '/var/lib/terminal-state-bandwidth(/.*)?' '/var/lib/terminal-state-acme(/.*)?'; do
    semanage fcontext -a -t httpd_sys_content_t "$path" 2>/dev/null || semanage fcontext -m -t httpd_sys_content_t "$path"
  done
  restorecon -RF "$root" /var/lib/terminal-state-bandwidth /var/lib/terminal-state-acme /usr/share/nginx/html
fi
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  # Add live rules without a reload that could interfere with other services.
  firewall-cmd --add-service=http
  firewall-cmd --add-service=https
fi
[[ -f /etc/nginx/nginx.conf.before-terminal-state ]] || cp -a /etc/nginx/nginx.conf /etc/nginx/nginx.conf.before-terminal-state
systemctl daemon-reload
systemctl enable terminal-state-bandwidth.service nginx.service

if [[ ! -s "/etc/letsencrypt/live/$domain/fullchain.pem" ]]; then
  # Initial ACME webroot server. The game is never exposed over plain HTTP.
  cat > /etc/nginx/nginx.conf <<HTTP
user nginx;
events { worker_connections 256; }
http {
  server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root /var/lib/terminal-state-acme; }
    location / { return 503; }
  }
}
HTTP
  nginx -t
  systemctl restart terminal-state-bandwidth.service
  systemctl restart nginx
  acme_contact=(--register-unsafely-without-email)
  [[ -z "$email" ]] || acme_contact=(--email "$email")
  certbot certonly --webroot --webroot-path /var/lib/terminal-state-acme --non-interactive \
    --agree-tos "${acme_contact[@]}" --domain "$domain"
fi

# Prepare a fresh immutable directory, then atomically switch the public symlink.
# Keep the previous release on disk for rollback and inspection.
release="$root/releases/$commit"
if [[ ! -d "$release" ]]; then
  incoming=$(mktemp -d "$root/releases/.incoming-$commit.XXXXXXXX")
  cp -a "$stage/site" "$stage/manifest.json" "$stage/deploy.json" "$incoming/"
  find "$incoming" -type d -exec chmod 755 {} +
  find "$incoming" -type f -exec chmod 644 {} +
  mv "$incoming" "$release"
fi
python3 "$stage/verify.py" "$release"
cp -a /etc/nginx/nginx.conf "$stage/previous-nginx.conf"
sed "s/@DOMAIN@/$domain/g" "$stage/nginx.conf" > /etc/nginx/nginx.conf
rollback() {
  cp -a "$stage/previous-nginx.conf" /etc/nginx/nginx.conf
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfnT "$previous" "$root/.rollback-current"
    mv -Tf "$root/.rollback-current" "$root/current"
  fi
  systemctl restart nginx || true
}
trap rollback ERR
nginx -t
ln -sfnT "$release" "$root/.next-current"
mv -Tf "$root/.next-current" "$root/current"
if command -v getenforce >/dev/null && [[ $(getenforce) != Disabled ]]; then
  restorecon -RF "$root"
fi
systemctl restart terminal-state-bandwidth.service
systemctl restart nginx
# Use loopback for health checks: quota cannot lock the deployment out. A closed
# site must show the fallback; an open one must match the official index hash.
status=$(curl --silent --show-error --retry 5 --retry-connrefused --resolve "$domain:443:127.0.0.1" \
  --output "$stage/response.html" --write-out '%{http_code}' "https://$domain/")
if [[ -f /var/lib/terminal-state-bandwidth/cutoff ]]; then
  [[ "$status" == 503 ]]
  cmp "$stage/response.html" /usr/share/nginx/html/terminal-state-cutoff.html
else
  [[ "$status" == 200 ]]
  cmp "$stage/response.html" "$release/site/index.html"
fi
trap - ERR
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/terminal-state.sh <<'HOOK'
#!/bin/sh
/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/terminal-state.sh
systemctl enable --now certbot-renew.timer
python3 - "$root" "$previous" <<'PY'
from pathlib import Path
import re, shutil, sys
root = Path(sys.argv[1])
keep = {root.joinpath('current').resolve(), Path(sys.argv[2])}
releases = sorted((p for p in root.joinpath('releases').iterdir()
                   if not p.is_symlink() and p.is_dir() and re.fullmatch('[a-f0-9]{40}', p.name)),
                  key=lambda p: p.stat().st_mtime, reverse=True)
keep.update(releases[:3])
for release in releases:
    if release not in keep:
        shutil.rmtree(release)
PY
echo "Deployed $tag ($commit); monthly cutoff $cap bytes"
python3 /usr/local/libexec/terminal-state/bandwidth.py --status
