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

# İmza hesabı iki yerde yapılır (JS ve SQL); ayrışırlarsa fiyat karşılaştırması
# sessizce çalışmaz olur. Eşitliği makineye doğrulat.
if command -v node >/dev/null 2>&1; then
  echo "▸ İmza eşitliği (JavaScript = SQL)"
  DATABASE_URL="$DB_URL" node "$ROOT/scripts/verify-signature-parity.mjs"
fi

# Şema hazırken, uygulamanın attığı sorguların ona uyduğunu da doğrula.
# Supabase kod yolu demo modunda hiç çalışmaz; bir tablo/sütun/fonksiyon adı
# tutmuyorsa bu ancak canlıda, ilk ziyaretçide ortaya çıkardı.
if command -v node >/dev/null 2>&1; then
  echo "▸ Supabase sorguları şemayla karşılaştırılıyor"
  DATABASE_URL="$DB_URL" node "$ROOT/scripts/verify-supabase-queries.mjs"
else
  echo "! node bulunamadı — sorgu/şema karşılaştırması atlandı"
fi

echo "✓ Tüm SQL doğrulamaları geçti"
