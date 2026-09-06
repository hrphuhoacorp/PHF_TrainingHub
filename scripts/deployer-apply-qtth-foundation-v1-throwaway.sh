#!/usr/bin/env bash
# PHF HR — QTTH V1 FOUNDATION migration -> THROWAWAY phf_hr_e2e ONLY. Deployer
# runs this (docker + postgres superuser pw). NOT prod. claude-phf CANNOT (no DDL).
#   export SUPERPW='<throwaway postgres superuser pw>'
#   bash /tmp/deployer-apply-qtth-foundation-v1-throwaway.sh
set -euo pipefail
MIG_LOCAL="${MIG_LOCAL:-$(cd "$(dirname "$0")/.." && pwd)/migrations/phf_hr_qtth_foundation_v1.sql}"
[ -r "$MIG_LOCAL" ] || { echo "migration not found: $MIG_LOCAL" >&2; exit 1; }
[ -n "${SUPERPW:-}" ] || { echo "export SUPERPW=... first" >&2; exit 1; }
CID=""
[ -r /tmp/phf-hr-e2e-throwaway.current ] && CID="$(cat /tmp/phf-hr-e2e-throwaway.current)"
[ -z "$CID" ] && CID="$(docker ps --format '{{.ID}} {{.Names}}' | grep -iE 'phf[_-]hr[_-]e2e|phf-postgres-e2e|phf_hr_e2e' | awk '{print $1}' | head -1 || true)"
[ -n "$CID" ] || { echo "throwaway container not found" >&2; exit 1; }
DBNAME="${PHF_HR_E2E_DBNAME:-phf_hr_e2e}"
echo "throwaway container: $CID  db: $DBNAME"
docker cp "$MIG_LOCAL" "$CID:/tmp/phf_hr_qtth_foundation_v1.sql"
echo "--- applying qtth foundation v1 (transactional, ON_ERROR_STOP) ---"
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 -f /tmp/phf_hr_qtth_foundation_v1.sql
echo "--- validation ---"
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'qtth tables = '||count(*) from information_schema.tables where table_schema='qtth';"
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'phf_hr_app has USAGE on qtth = '||has_schema_privilege('phf_hr_app','qtth','USAGE');"
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'module_permission grants = '||string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_schema='qtth' and table_name='module_permission' and grantee='phf_hr_app';"
docker exec "$CID" rm -f /tmp/phf_hr_qtth_foundation_v1.sql
echo "--- DONE. Throwaway only. No prod change. DOWN: migrations/phf_hr_qtth_foundation_v1_DOWN.sql ---"
