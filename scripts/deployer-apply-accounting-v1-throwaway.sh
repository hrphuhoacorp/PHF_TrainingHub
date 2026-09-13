#!/usr/bin/env bash
# PHF HR — QTTH Truth Data · ACCOUNTING (CHI PHÍ QUẢN TRỊ) FOUNDATION V1 -> THROWAWAY
# phf_hr_e2e ONLY. NOT prod. Schema `accounting` (import/import_file/normalized/
# delta/cost_dictionary/cost_dictionary_entry/classification_rule + seed rules).
# Idempotent-ish: fails if the schema already has these tables.
#   export SUPERPW='<throwaway postgres superuser pw>'   # optional on trust-auth
#   bash scripts/deployer-apply-accounting-v1-throwaway.sh
set -euo pipefail
MIG_LOCAL="${MIG_LOCAL:-$(cd "$(dirname "$0")/.." && pwd)/migrations/phf_hr_qtth_accounting_v1.sql}"
[ -r "$MIG_LOCAL" ] || { echo "migration not found: $MIG_LOCAL" >&2; exit 1; }
CID=""
[ -r /tmp/phf-hr-e2e-throwaway.current ] && CID="$(cat /tmp/phf-hr-e2e-throwaway.current)"
[ -z "$CID" ] && CID="$(docker ps --format '{{.ID}} {{.Names}}' | grep -iE 'phf[_-]hr[_-]e2e' | awk '{print $1}' | head -1 || true)"
[ -n "$CID" ] || { echo "throwaway container not found" >&2; exit 1; }
DBNAME="${PHF_HR_E2E_DBNAME:-phf_hr_e2e}"
PGENV=(); [ -n "${SUPERPW:-}" ] && PGENV=(-e PGPASSWORD="$SUPERPW")
echo "throwaway container: $CID  db: $DBNAME"
docker cp "$MIG_LOCAL" "$CID:/tmp/phf_hr_qtth_accounting_v1.sql"
echo "--- applying qtth accounting v1 (transactional, ON_ERROR_STOP) ---"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 -f /tmp/phf_hr_qtth_accounting_v1.sql
echo "--- validation ---"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'accounting tables = '||count(*) from information_schema.tables where table_schema='accounting';"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'phf_hr_app USAGE on accounting = '||has_schema_privilege('phf_hr_app','accounting','USAGE');"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'classification_rule seed rows = '||count(*) from accounting.classification_rule;"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'normalized TRUNCATE guard = '||count(*) from pg_trigger where tgname='normalized_no_truncate';"
docker exec "$CID" rm -f /tmp/phf_hr_qtth_accounting_v1.sql
echo "--- DONE. Throwaway only. No prod. DOWN: migrations/phf_hr_qtth_accounting_v1_DOWN.sql ---"
