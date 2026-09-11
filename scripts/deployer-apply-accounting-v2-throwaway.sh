#!/usr/bin/env bash
# PHF HR — QTTH Truth Data · ACCOUNTING OPERATOR DECISION LAYER V2 -> THROWAWAY
# phf_hr_e2e ONLY. NOT prod. ADDITIVE on top of v1 (schema `accounting`):
#   classification_rule +origin/cost_code/match_signature · normalized +decision_source
#   new tables accounting.rule_history + accounting.item_decision (append-only).
#   export SUPERPW='<throwaway postgres superuser pw>'   # optional on trust-auth
#   bash scripts/deployer-apply-accounting-v2-throwaway.sh
set -euo pipefail
MIG_LOCAL="${MIG_LOCAL:-$(cd "$(dirname "$0")/.." && pwd)/migrations/phf_hr_qtth_accounting_v2.sql}"
[ -r "$MIG_LOCAL" ] || { echo "migration not found: $MIG_LOCAL" >&2; exit 1; }
CID=""
[ -r /tmp/phf-hr-e2e-throwaway.current ] && CID="$(cat /tmp/phf-hr-e2e-throwaway.current)"
[ -z "$CID" ] && CID="$(docker ps --format '{{.ID}} {{.Names}}' | grep -iE 'phf[_-]hr[_-]e2e' | awk '{print $1}' | head -1 || true)"
[ -n "$CID" ] || { echo "throwaway container not found" >&2; exit 1; }
DBNAME="${PHF_HR_E2E_DBNAME:-phf_hr_e2e}"
PGENV=(); [ -n "${SUPERPW:-}" ] && PGENV=(-e PGPASSWORD="$SUPERPW")
echo "throwaway container: $CID  db: $DBNAME"
docker cp "$MIG_LOCAL" "$CID:/tmp/phf_hr_qtth_accounting_v2.sql"
echo "--- applying qtth accounting v2 (transactional, ON_ERROR_STOP) ---"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 -f /tmp/phf_hr_qtth_accounting_v2.sql
echo "--- validation ---"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'accounting tables = '||count(*) from information_schema.tables where table_schema='accounting';"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'classification_rule.origin = '||count(*) from information_schema.columns where table_schema='accounting' and table_name='classification_rule' and column_name='origin';"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'normalized.decision_source = '||count(*) from information_schema.columns where table_schema='accounting' and table_name='normalized' and column_name='decision_source';"
docker exec "${PGENV[@]}" "$CID" psql -U postgres -d "$DBNAME" -tAc \
  "select 'item_decision append-only trg = '||count(*) from pg_trigger where tgname='item_decision_immutable';"
docker exec "$CID" rm -f /tmp/phf_hr_qtth_accounting_v2.sql
echo "--- DONE. Throwaway only. No prod. DOWN: migrations/phf_hr_qtth_accounting_v2_DOWN.sql ---"
