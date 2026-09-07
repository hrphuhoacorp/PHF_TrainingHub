#!/usr/bin/env bash
# PHF HR — SYSTEM V1 Audit Log FOUNDATION -> THROWAWAY phf_hr_e2e ONLY.
# Deployer runs this (docker + postgres superuser pw). claude-phf CANNOT (no DDL).
#   export SUPERPW='<throwaway postgres superuser pw>'
#   bash /tmp/deployer-apply-audit-v1-throwaway.sh
# NOT prod. No prod change.
set -euo pipefail
MIG_LOCAL="${MIG_LOCAL:-$(cd "$(dirname "$0")/.." && pwd)/migrations/phf_hr_audit_v1.sql}"
[ -r "$MIG_LOCAL" ] || { echo "migration not found: $MIG_LOCAL" >&2; exit 1; }
[ -n "${SUPERPW:-}" ] || { echo "export SUPERPW=... first" >&2; exit 1; }
CID=""
[ -r /tmp/phf-hr-e2e-throwaway.current ] && CID="$(cat /tmp/phf-hr-e2e-throwaway.current)"
[ -z "$CID" ] && CID="$(docker ps --format '{{.ID}} {{.Names}}' | grep -iE 'phf[_-]hr[_-]e2e|phf-postgres-e2e|phf_hr_e2e' | awk '{print $1}' | head -1 || true)"
[ -n "$CID" ] || { echo "throwaway container not found" >&2; exit 1; }
DBNAME="${PHF_HR_E2E_DBNAME:-phf_hr_e2e}"
echo "throwaway container: $CID  db: $DBNAME"
docker cp "$MIG_LOCAL" "$CID:/tmp/phf_hr_audit_v1.sql"
echo "--- applying audit-v1 foundation (transactional, ON_ERROR_STOP) ---"
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 -f /tmp/phf_hr_audit_v1.sql
echo "--- append-only proof: these three MUST all fail with APPEND_ONLY ---"
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -c \
  "INSERT INTO audit.entries(module,action) VALUES ('_probe','_probe');" >/dev/null
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -c \
  "UPDATE audit.entries SET action='x' WHERE module='_probe';" 2>&1 | grep -q APPEND_ONLY && echo "UPDATE blocked OK"
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -c \
  "DELETE FROM audit.entries WHERE module='_probe';" 2>&1 | grep -q APPEND_ONLY && echo "DELETE blocked OK"
docker exec -e PGPASSWORD="$SUPERPW" "$CID" psql -U postgres -d "$DBNAME" -c \
  "TRUNCATE audit.entries;" 2>&1 | grep -q APPEND_ONLY && echo "TRUNCATE blocked OK"
echo "NOTE: the _probe row is intentionally left (append-only — cannot be removed). Throwaway only."
docker exec "$CID" rm -f /tmp/phf_hr_audit_v1.sql
echo "--- DONE. Throwaway only. No prod change. ---"
