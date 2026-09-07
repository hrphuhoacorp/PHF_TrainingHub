#!/usr/bin/env bash
# PHF HR — THÔNG BÁO QUẢN TRỊ V1 FOUNDATION migration -> THROWAWAY phf_hr_e2e ONLY.
# Deployer runs this (docker + postgres superuser). NOT prod.
#   export SUPERPW='<throwaway postgres superuser pw>'   # or leave unset if the
#                                                        # throwaway trusts -U postgres
#   bash /tmp/deployer-apply-notice-v1-throwaway.sh
set -euo pipefail
MIG_LOCAL="${MIG_LOCAL:-$(cd "$(dirname "$0")/.." && pwd)/migrations/phf_hr_notice_v1.sql}"
[ -r "$MIG_LOCAL" ] || { echo "migration not found: $MIG_LOCAL" >&2; exit 1; }
CID=""
[ -r /tmp/phf-hr-e2e-throwaway.current ] && CID="$(cat /tmp/phf-hr-e2e-throwaway.current)"
[ -z "$CID" ] && CID="$(docker ps --format '{{.ID}} {{.Names}}' | grep -iE 'phf[_-]hr[_-]e2e' | awk '{print $1}' | head -1 || true)"
[ -n "$CID" ] || { echo "throwaway container not found" >&2; exit 1; }
DBNAME="${PHF_HR_E2E_DBNAME:-phf_hr_e2e}"
PGENV=""
[ -n "${SUPERPW:-}" ] && PGENV="-e PGPASSWORD=$SUPERPW"
echo "throwaway container: $CID  db: $DBNAME"
docker cp "$MIG_LOCAL" "$CID:/tmp/phf_hr_notice_v1.sql"
echo "--- applying notice foundation v1 (transactional, ON_ERROR_STOP) ---"
docker exec $PGENV "$CID" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 -f /tmp/phf_hr_notice_v1.sql
echo "--- validation ---"
docker exec $PGENV "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'notice tables = '||count(*) from information_schema.tables where table_schema='notice';"
docker exec $PGENV "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'phf_hr_app USAGE on notice = '||has_schema_privilege('phf_hr_app','notice','USAGE');"
docker exec $PGENV "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'vn_unaccent = '||notice.vn_unaccent('Bấm bill F6 Voucher');"
docker exec "$CID" rm -f /tmp/phf_hr_notice_v1.sql
echo "--- DONE. Throwaway only. No prod change. DOWN: migrations/phf_hr_notice_v1_DOWN.sql ---"
