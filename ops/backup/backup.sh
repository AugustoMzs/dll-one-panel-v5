#!/bin/sh
# One-shot cron worker. NEVER restores to the production database.
set -eu
umask 077
: "${DATABASE_URL:?Missing source database connection}"
: "${BACKUP_BUCKET:?Missing backup bucket}"
: "${BACKUP_ENDPOINT:?Missing backup endpoint}"
: "${AWS_ACCESS_KEY_ID:?Missing private bucket access key}"
: "${AWS_SECRET_ACCESS_KEY:?Missing private bucket secret}"
: "${BACKUP_AES256_KEY:?Missing AES256 encryption key}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_DEFAULT_REGION
# Fail immediately if a required binary is missing; do not upload an
# encrypted object that can never pass scratch restore.
for command in pg_dump pg_restore psql initdb pg_ctl su-exec node aws sha256sum; do
 if ! command -v "$command" >/dev/null 2>&1; then
   echo "[BACKUP] Required tool unavailable: $command" >&2
   exit 1
 fi
done

work="$(mktemp -d /tmp/dllone-backup.XXXXXXXX)"
pg_started=0
cleanup(){
 if [ "$pg_started" = "1" ]; then
   su-exec postgres pg_ctl -D "$work/pgdata" -m immediate -w stop >/dev/null 2>&1 || true
 fi
 rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
instance="$(cat /proc/sys/kernel/random/uuid)"
key="postgres/v1/${timestamp}-${instance}.dump.aes"
target="s3://${BACKUP_BUCKET}/${key}"
echo "[BACKUP] Starting PostgreSQL dump and isolated restore verification."
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$work/database.dump"
pg_restore --list "$work/database.dump" >/dev/null
node /opt/dllone/backup_crypto.mjs encrypt "$work/database.dump" "$work/database.dump.aes"
rm -f "$work/database.dump"
encrypted_hash="$(sha256sum "$work/database.dump.aes" | cut -d' ' -f1)"
aws --endpoint-url "$BACKUP_ENDPOINT" s3 cp "$work/database.dump.aes" "$target" --only-show-errors
aws --endpoint-url "$BACKUP_ENDPOINT" s3 cp "$target" "$work/downloaded.aes" --only-show-errors
downloaded_hash="$(sha256sum "$work/downloaded.aes" | cut -d' ' -f1)"
if [ "$encrypted_hash" != "$downloaded_hash" ]; then
 echo "[BACKUP] Downloaded object checksum mismatch; no verified marker written." >&2
 exit 1
fi
node /opt/dllone/backup_crypto.mjs decrypt "$work/downloaded.aes" "$work/recovered.dump"
pg_restore --list "$work/recovered.dump" >/dev/null
# Disposable PostgreSQL isolated by Unix socket and port 55432.
mkdir -p "$work/pgdata"
chown -R postgres:postgres "$work"
su-exec postgres initdb --pgdata="$work/pgdata" --username=postgres --auth=trust --no-instructions >/dev/null
su-exec postgres pg_ctl -D "$work/pgdata" -o "-c listen_addresses='' -c unix_socket_directories=$work -c port=55432 -c fsync=off" -w start >/dev/null
pg_started=1
pg_restore --host="$work" --port=55432 --username=postgres --dbname=postgres --exit-on-error --no-owner --no-acl "$work/recovered.dump"
table_count="$(psql --host="$work" --port=55432 --username=postgres --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 --command="SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname='public'")"
case "$table_count" in
  ''|*[!0-9]*) echo "[BACKUP] Scratch restoration produced invalid table count." >&2;exit 1;;
esac
if [ "$table_count" -lt 1 ]; then
 echo "[BACKUP] Scratch restoration contains no application tables." >&2;exit 1
fi
required_tables="$(psql --host="$work" --port=55432 --username=postgres --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 --command="SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename IN ('panel_companies','panel_users','panel_orders')")"
if [ "$required_tables" != "3" ]; then
 echo "[BACKUP] Scratch restore is missing a critical application table." >&2
 exit 1
fi
printf 'format=DLLONE-PG-CUSTOM-AES256-GCM-v1\narchive=%s\nsha256=%s\nverified_at=%s\ntables_restored=%s\n' \
 "$key" "$encrypted_hash" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$table_count" > "$work/verified.txt"
aws --endpoint-url "$BACKUP_ENDPOINT" s3 cp "$work/verified.txt" "${target}.verified.txt" --only-show-errors
echo "[BACKUP] VERIFIED: encrypted archive uploaded, downloaded, authenticated and restored to scratch database. Tables=$table_count."
