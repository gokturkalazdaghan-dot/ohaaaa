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

# ---------------------------------------------------------------------------
# pgTAP TESTLERİ SESSİZCE GEÇMEZ.
# ---------------------------------------------------------------------------
# psql, pgTAP iddiaları BAŞARISIZ olsa bile 0 ile çıkar: "not ok" satırları
# hata değil, çıktıdır. Ölçüldü — 39 başarısız iddiaya rağmen çıkış kodu 0.
# Yani bu döngü, güvenlik testi tamamen düşerken "geçti" diyebilirdi.
#
# Bu yüzden çıktı okunur: bir "not ok" satırı ya da plan uyuşmazlığı
# ("Looks like you planned/failed ...") derlemeyi düşürür.
#
# `raise exception` ile yazılmış eski testler zaten ON_ERROR_STOP ile
# düşüyor; bu ek kontrol yalnızca pgTAP tarzı dosyalar için gerekli ama
# hepsine uygulanması zarar vermez.
run_sql_test() {
  local file="$1" out status
  out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$file" 2>&1)"
  status=$?

  if [ $status -ne 0 ]; then
    printf '%s\n' "$out" >&2
    echo "✗ $(basename "$file"): psql hata verdi" >&2
    return 1
  fi

  if printf '%s' "$out" | grep -qE '^[[:space:]]*not ok'; then
    printf '%s\n' "$out" | grep -E '^[[:space:]]*not ok' >&2
    echo "✗ $(basename "$file"): pgTAP iddiaları başarısız" >&2
    return 1
  fi

  if printf '%s' "$out" | grep -qE 'Looks like you (failed|planned)'; then
    printf '%s\n' "$out" | grep -E 'Looks like you (failed|planned)' >&2
    echo "✗ $(basename "$file"): pgTAP plan uyuşmazlığı" >&2
    return 1
  fi

  printf '%s' "$out" | grep -E '^[[:space:]]*(NOTICE|psql.*NOTICE)' || true
  return 0
}

for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  [ -e "$f" ] || continue
  echo "▸ Test: $(basename "$f")"
  run_sql_test "$f"
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
