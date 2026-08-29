#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Migration'ları temiz bir PostgreSQL veritabanında baştan sona uygular ve
# supabase/tests/ altındaki iddia (assertion) testlerini çalıştırır.
#
# Kullanım:  DATABASE_URL=postgres://... ./scripts/verify-sql.sh
# ---------------------------------------------------------------------------
set -euo pipefail

DB_URL="${DATABASE_URL:?DATABASE_URL tanımlı olmalı}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▸ Supabase shim uygulanıyor (yerel doğrulama ortamı)"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_shim.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "▸ Migration: $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "▸ Seed verisi"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql"

for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  [ -e "$f" ] || continue
  echo "▸ Test: $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "✓ Tüm SQL doğrulamaları geçti"
