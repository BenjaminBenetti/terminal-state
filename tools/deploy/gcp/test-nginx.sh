#!/usr/bin/env bash
set -euo pipefail
domain=game.test
site=/srv/terminal-state/current/site
mkdir -p "$site/assets" /var/lib/terminal-state-bandwidth /var/lib/terminal-state-acme
mkdir -p "/etc/letsencrypt/live/$domain"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$domain" -addext "subjectAltName=DNS:$domain" \
  -keyout "/etc/letsencrypt/live/$domain/privkey.pem" -out "/etc/letsencrypt/live/$domain/fullchain.pem" 2>/dev/null
printf '<h1>Terminal State</h1>\n' > "$site/index.html"
python3 - "$site" <<'PY'
from pathlib import Path
import sys
site = Path(sys.argv[1])
(site / 'assets/index-abc123.js').write_text('console.log("game");\n' * 1000)
(site / 'assets/model.glb').write_bytes(b'geometry' * 1000)
PY
for file in "$site"/assets/*; do
  gzip -k "$file"
  brotli -k "$file"
done
cp /test/cutoff.html /usr/share/nginx/html/terminal-state-cutoff.html
sed "s/@DOMAIN@/$domain/g" /test/nginx.conf > /etc/nginx/nginx.conf
nginx -t
nginx
trap 'nginx -s stop' EXIT
request=(curl --silent --show-error --noproxy '*' --cacert "/etc/letsencrypt/live/$domain/fullchain.pem" --resolve "$domain:443:127.0.0.1")
url="https://$domain"
"${request[@]}" -D /tmp/headers "$url/" > /tmp/body
cmp /tmp/body "$site/index.html"
grep -qi '^Cache-Control: no-cache' /tmp/headers
"${request[@]}" -H 'Accept-Encoding: br' -D /tmp/headers "$url/assets/model.glb" > /tmp/encoded.br
grep -qi '^Content-Encoding: br' /tmp/headers
grep -qi '^Content-Type: model/gltf-binary' /tmp/headers
brotli -d -c /tmp/encoded.br > /tmp/decoded
cmp /tmp/decoded "$site/assets/model.glb"
"${request[@]}" -H 'Accept-Encoding: gzip' -D /tmp/headers "$url/assets/index-abc123.js" > /tmp/encoded.gz
grep -qi '^Content-Encoding: gzip' /tmp/headers
grep -qi 'Cache-Control: public, max-age=31536000, immutable' /tmp/headers
gzip -d -c /tmp/encoded.gz > /tmp/decoded
cmp /tmp/decoded "$site/assets/index-abc123.js"
"${request[@]}" -H 'Accept-Encoding: br;q=0, gzip;q=0' "$url/assets/model.glb" > /tmp/body
cmp /tmp/body "$site/assets/model.glb"
etag=$("${request[@]}" -I "$url/assets/model.glb" | tr -d '\r' | sed -n 's/^ETag: //p')
[[ -n "$etag" ]]
[[ $("${request[@]}" -H "If-None-Match: $etag" -o /dev/null -w '%{http_code}' "$url/assets/model.glb") == 304 ]]
for route in /assets/model.glb.br /manifest.json /.env; do
  [[ $("${request[@]}" -o /dev/null -w '%{http_code}' "$url$route") == 404 ]]
done
touch /var/lib/terminal-state-bandwidth/cutoff
for route in / /assets/model.glb /assets/index-abc123.js; do
  [[ $("${request[@]}" -D /tmp/headers -o /tmp/body -w '%{http_code}' "$url$route") == 503 ]]
  cmp /tmp/body /test/cutoff.html
  grep -qi '^Cache-Control: no-store' /tmp/headers
done
rm /var/lib/terminal-state-bandwidth/cutoff
[[ $("${request[@]}" -o /dev/null -w '%{http_code}' "$url/") == 200 ]]
echo 'PASS: Rocky Linux nginx, Brotli/gzip, ETag/304, caching, cutoff page and reopening'
