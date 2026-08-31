#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OHAAAA · Bekleyen migration'ları uygula
#
# Yalnızca veritabanı şemasını hizalar. Anahtar doğrulaması, Vercel ayarları
# ve dağıtım yapmaz — onlar için scripts/setup-production.sh var.
#
# NEDEN AYRI BİR BETİK
# Şema, uygulama kodundan bağımsız olarak geride kalabilir: kod dağıtılır ama
# migration uygulanmaz. O aralıkta yeni bir SQL fonksiyonunu çağıran her yol
# hata verir. Bu betik, tek bir bağlantı dizesiyle o aralığı kapatır ve
# başka hiçbir şeye dokunmaz.
#
# Kullanım:
#   SUPABASE_DB_URL='postgresql://...' ./scripts/apply-migrations.sh
#
# Bağlantı dizesini Supabase panelinde Settings → Database → Connection
# string (URI) altında bulursunuz.
# ---------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

red=$'\033[31m'; grn=$'\033[32m'; ylw=$'\033[33m'; bld=$'\033[1m'; dim=$'\033[2m'; rst=$'\033[0m'
step() { printf '\n%s▸ %s%s\n' "$bld" "$1" "$rst"; }
ok()   { printf '  %s✓%s %s\n' "$grn" "$rst" "$1"; }
warn() { printf '  %s!%s %s\n' "$ylw" "$rst" "$1"; }
die()  { printf '\n%s✗ %s%s\n\n' "$red" "$1" "$rst" >&2; exit 1; }

SUPABASE_DB_URL="${SUPABASE_DB_URL:-}"
if [ -z "$SUPABASE_DB_URL" ]; then
  printf 'Veritabanı bağlantı dizesi (postgresql://...): '
  read -rs SUPABASE_DB_URL
  echo
fi

case "$SUPABASE_DB_URL" in
  postgres://*|postgresql://*) ;;
  *) die "Bağlantı dizesi 'postgresql://' ile başlamalı." ;;
esac

command -v psql >/dev/null 2>&1 || die "psql bulunamadı. PostgreSQL istemcisini kurun."

# --- 2. Migration'lar ------------------------------------------------------
# Migration dosyaları idempotent DEĞİLDİR (`create type ...` ikinci çalıştırmada
# hata verir). Betiği tekrar çalıştırmak ise olağandır: anahtar yanlış girilir,
# ağ kopar, dağıtım yenilenir. Bu yüzden hangi sürümün uygulandığı veritabanında
# tutulur ve yalnızca eksikler çalıştırılır.
#
# Defter, Supabase CLI'nin kendi tablosudur (supabase_migrations.schema_migrations).
# Aynı tabloyu aynı sürüm biçimiyle kullanmak, ileride `supabase db push`
# denildiğinde bu migration'ların "zaten uygulanmış" sayılmasını sağlar; iki
# araç birbirinin üstüne yazmaz.
step "Veritabanı şeması"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "Migration defteri oluşturulamadı."
set client_min_messages = warning;   -- "already exists" bildirimleri gürültüdür
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[],
  name       text
);
SQL

# --- Zaten kurulmuş bir şemayı devral (baseline) ----------------------------
# Şema başka bir yolla uygulanmış olabilir: `supabase db push`, SQL editörü ya
# da daha önceki bir dağıtım. O durumda defter boştur ama tablolar durur; hiçbir
# şey yapmadan devam etmek "type already exists" hatasıyla biter.
#
# Devralmadan önce ŞEMANIN GÜNCEL OLDUĞU doğrulanır: en son migration'ın
# getirdiği nesne aranır. Yoksa şema yarım demektir ve sessizce "uygulandı"
# işaretlemek, eksik tabloyla çalışan bir siteden daha kötüdür — bu yüzden
# durulur.
ledger_rows=$(psql "$SUPABASE_DB_URL" -tAc \
  "select count(*) from supabase_migrations.schema_migrations;")
schema_exists=$(psql "$SUPABASE_DB_URL" -tAc \
  "select case when to_regclass('public.products') is null then 0 else 1 end;")

if [ "${ledger_rows// /}" = "0" ] && [ "${schema_exists// /}" = "1" ]; then
  warn "Şema zaten kurulmuş ama migration defteri boş."
  newest=$(psql "$SUPABASE_DB_URL" -tAc \
    "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'tg_vendors_promote_owner';")
  if [ "${newest// /}" = "0" ]; then
    die "Şema YARIM görünüyor: en son migration'ın nesnesi yok.
       Devralmak, eksik bir şemayı 'tamam' diye işaretlemek olurdu.
       Önce şemayı hizalayın (supabase db push) ve betiği tekrar çalıştırın."
  fi
  for f in "$ROOT"/supabase/migrations/*.sql; do
    b=$(basename "$f"); v="${b%%_*}"; nm="${b#*_}"; nm="${nm%.sql}"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c \
      "insert into supabase_migrations.schema_migrations (version, name)
       values ('$v', '$nm') on conflict (version) do nothing;" \
      || die "Defter yazılamadı."
  done
  ok "Mevcut şema devralındı — migration'lar 'uygulanmış' işaretlendi"
fi

applied=0; skipped=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  base=$(basename "$f")
  version="${base%%_*}"
  name="${base#*_}"; name="${name%.sql}"

  already=$(psql "$SUPABASE_DB_URL" -tAc \
    "select 1 from supabase_migrations.schema_migrations where version = '$version';")
  if [ "${already// /}" = "1" ]; then
    printf '  %s·%s %s %s(zaten uygulanmış)%s\n' "$dim" "$rst" "$base" "$dim" "$rst"
    skipped=$((skipped + 1))
    continue
  fi

  printf '  %s…%s %s\n' "$dim" "$rst" "$base"
  # --single-transaction: dosya yarıda hata verirse hiçbir şey uygulanmaz ve
  # defter de yazılmaz. Yarım uygulanmış bir şema, hiç uygulanmamıştan beterdir.
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
       -f "$f" \
       -c "insert into supabase_migrations.schema_migrations (version, name)
           values ('$version', '$name') on conflict (version) do nothing;" \
    || die "Migration başarısız: $base
       Hiçbir değişiklik uygulanmadı (işlem geri alındı). Hatayı giderip
       betiği tekrar çalıştırın; tamamlanmış migration'lar atlanacaktır."
  applied=$((applied + 1))
done

if [ "$applied" -gt 0 ]; then ok "$applied migration uygulandı"; fi
if [ "$skipped" -gt 0 ]; then ok "$skipped migration zaten uygulanmıştı"; fi

echo "  ${dim}NOT: supabase/seed.sql UYGULANMADI — uydurma satıcı ve fiyat içerir.${rst}"


step "Bitti"
ok "Şema güncel."
