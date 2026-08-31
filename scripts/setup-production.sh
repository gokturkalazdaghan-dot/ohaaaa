#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OHAAAA · Üretime alma (tek komut)
#
# Tarayıcıda yapılması ZORUNLU tek adım Supabase projesini açmaktır. Gerisi —
# migration'lar, anahtar doğrulaması, Vercel ortam değişkenleri, dağıtım ve
# canlı doğrulama — bu betikte.
#
# Kullanım:
#   ./scripts/setup-production.sh
#
# Değerler istenirse ortamdan da okunur (CI için):
#   SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#   SUPABASE_SERVICE_ROLE_KEY, SITE_URL, SKIP_VERCEL=1
#
# ---------------------------------------------------------------------------
# BU BETİĞİN YAPMADIĞI ŞEY
# ---------------------------------------------------------------------------
# supabase/seed.sql'i ÜRETİME UYGULAMAZ. O dosya uydurma satıcılar ve uydurma
# fiyatlar içerir; canlı bir fiyat karşılaştırma sitesinde sahte fiyat
# göstermek, ziyaretçiye yalan söylemektir. Üretim kataloğu yalnızca gerçek
# ortaklık beslemelerinden dolar. Betik bunu bilerek reddeder.
# ---------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

red=$'\033[31m'; grn=$'\033[32m'; ylw=$'\033[33m'; bld=$'\033[1m'; dim=$'\033[2m'; rst=$'\033[0m'
step() { printf '\n%s▸ %s%s\n' "$bld" "$1" "$rst"; }
ok()   { printf '  %s✓%s %s\n' "$grn" "$rst" "$1"; }
warn() { printf '  %s!%s %s\n' "$ylw" "$rst" "$1"; }
die()  { printf '\n  %s✗ %s%s\n\n' "$red" "$1" "$rst" >&2; exit 1; }

# Gizli değer soran okuma: terminale yazılmaz, kabuk geçmişine düşmez.
ask() {  # ask <değişken-adı> <soru> [gizli]
  local __var="$1" __prompt="$2" __secret="${3:-}" __val
  __val="${!__var:-}"
  if [ -n "$__val" ]; then
    printf '  %s%s: ortamdan alındı%s\n' "$dim" "$__var" "$rst"
    return 0
  fi
  if [ ! -t 0 ]; then die "$__var tanımlı değil ve terminal etkileşimli değil."; fi
  if [ -n "$__secret" ]; then
    read -r -s -p "  $__prompt: " __val; echo
  else
    read -r -p "  $__prompt: " __val
  fi
  [ -n "$__val" ] || die "$__var boş bırakılamaz."
  printf -v "$__var" '%s' "$__val"
}

# ---------------------------------------------------------------------------
# Anahtarın gerçekten iddia ettiği anahtar olduğunu doğrula.
#
# Supabase panelinde anon ve service_role anahtarları yan yana durur ve
# görünüşleri aynıdır. Yanlışlıkla service_role'ü NEXT_PUBLIC_ olarak
# yapıştırmak, tüm RLS kurallarını atlayan bir anahtarı her ziyaretçinin
# tarayıcısına göndermek demektir: tüm siparişler, tüm adresler, tüm API
# anahtarları okunabilir hale gelir. Bu, kurulumda yapılabilecek en pahalı
# hatadır ve sessizdir — site sorunsuz çalışır.
#
# Bu yüzden anahtarın kendi içindeki rol iddiası okunur.
# ---------------------------------------------------------------------------
key_role() {  # key_role <anahtar> -> "anon" | "service_role" | "publishable" | "secret" | ""
  local token="$1" payload decoded

  case "$token" in
    sb_publishable_*) printf 'publishable'; return 0 ;;
    sb_secret_*)      printf 'secret';      return 0 ;;
  esac

  # JWT: header.payload.signature — ortadaki bölüm base64url.
  case "$token" in *.*.*) ;; *) return 0 ;; esac
  payload="${token#*.}"; payload="${payload%%.*}"
  payload="${payload//-/+}"; payload="${payload//_//}"
  case $(( ${#payload} % 4 )) in
    2) payload="${payload}==" ;;
    3) payload="${payload}=" ;;
  esac

  decoded=$(printf '%s' "$payload" | base64 -d 2>/dev/null || true)
  # sed tüm akışı tüketir; `head` ile boru hattı kurup SIGPIPE riski almayız.
  printf '%s\n' "$decoded" | grep -oE '"role"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | sed -n '1s/.*"\([^"]*\)"$/\1/p'
}

expect_key_role() {  # expect_key_role <anahtar> <beklenen> <insan-okur-ad>
  local actual; actual=$(key_role "$1")
  case "$2:$actual" in
    anon:anon|anon:publishable)                 ok "$3 doğrulandı (rol: $actual)" ;;
    service_role:service_role|service_role:secret) ok "$3 doğrulandı (rol: $actual)" ;;
    anon:service_role|anon:secret)
      die "FELAKET ÖNLENDİ: $3 alanına GİZLİ anahtar yapıştırılmış.
       Bu anahtar tüm RLS kurallarını atlar ve NEXT_PUBLIC_ olarak
       her ziyaretçinin tarayıcısına gider. Supabase panelinden
       'anon / publishable' anahtarını alın." ;;
    service_role:anon|service_role:publishable)
      die "$3 alanına AÇIK (anon) anahtar yapıştırılmış. Sunucu tarafı
       işlemler çalışmaz. 'service_role / secret' anahtarını alın." ;;
    *:"")  warn "$3: biçim tanınmadı, rol doğrulanamadı — panelden tekrar kontrol edin" ;;
    *)     die "$3 beklenen rol '$2' değil, '$actual' görünüyor." ;;
  esac
}

printf '\n%s  OHAAAA · üretime alma%s\n' "$bld" "$rst"
printf '%s  Supabase projesini tarayıcıda açmış olmalısınız.%s\n' "$dim" "$rst"

# --- 0. Ön koşullar --------------------------------------------------------
step "0/6 · Ön koşullar"
command -v psql >/dev/null || die "psql bulunamadı. Kurulum: brew install libpq  /  apt install postgresql-client"
ok "psql var"
command -v npx  >/dev/null || die "npx bulunamadı. Node.js 20+ kurun."
ok "npx var"
[ -d "$ROOT/supabase/migrations" ] || die "Depo kökünden çalıştırın."
ok "Depo bulundu: $ROOT"

# --- 1. Bilgiler -----------------------------------------------------------
step "1/6 · Supabase bilgileri"
echo "  ${dim}Supabase → Project Settings → Database → Connection string (URI)${rst}"
ask SUPABASE_DB_URL "Veritabanı bağlantı dizesi (postgresql://...)" secret
case "$SUPABASE_DB_URL" in
  postgres://*|postgresql://*) ;;
  *) die "Bağlantı dizesi postgresql:// ile başlamalı." ;;
esac
case "$SUPABASE_DB_URL" in
  *localhost*|*127.0.0.1*) die "Yerel bir veritabanı verdiniz. Üretim için Supabase bağlantı dizesi gerekir." ;;
esac
ok "Bağlantı dizesi alındı"

echo
echo "  ${dim}Supabase → Project Settings → API${rst}"
ask NEXT_PUBLIC_SUPABASE_URL "Project URL (https://xxxx.supabase.co)"
case "$NEXT_PUBLIC_SUPABASE_URL" in
  https://*) ;; *) die "Project URL https:// ile başlamalı." ;;
esac
NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL%/}"
ok "Project URL: $NEXT_PUBLIC_SUPABASE_URL"

ask NEXT_PUBLIC_SUPABASE_ANON_KEY "anon / publishable anahtarı" secret
expect_key_role "$NEXT_PUBLIC_SUPABASE_ANON_KEY" anon "anon anahtarı"

ask SUPABASE_SERVICE_ROLE_KEY "service_role / secret anahtarı" secret
expect_key_role "$SUPABASE_SERVICE_ROLE_KEY" service_role "service_role anahtarı"

[ "$NEXT_PUBLIC_SUPABASE_ANON_KEY" != "$SUPABASE_SERVICE_ROLE_KEY" ] \
  || die "İki anahtar aynı. Panelden ayrı ayrı kopyalayın."

SITE_URL="${SITE_URL:-https://ohaaaa.com}"
ok "Site adresi: $SITE_URL"

# --- 2. Migration'lar ------------------------------------------------------
# Defter mantığı TEK YERDE: scripts/apply-migrations.sh. İki kopya zamanla
# ayrışır ve şema hizalaması, ayrışmayı en pahalı şekilde fark edeceğiniz
# yerdir.
step "2/6 · Veritabanı şeması"

SUPABASE_DB_URL="$SUPABASE_DB_URL" "$ROOT/scripts/apply-migrations.sh" \
  || die "Migration'lar uygulanamadı."

# --- 3. Şema doğrulaması ---------------------------------------------------
# Migration'ın hatasız bitmesi, şemanın DOĞRU olduğunu kanıtlamaz. Asıl
# soru şudur: RLS her tabloda açık mı? Kapalı kalan tek bir tablo, anon
# anahtarıyla tüm satırların okunabilmesi demektir.
step "3/6 · Güvenlik doğrulaması"

unprotected=$(psql "$SUPABASE_DB_URL" -tAc "
  select string_agg(c.relname, ', ' order by c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;" || die "Şema sorgulanamadı.")

if [ -n "${unprotected// /}" ]; then
  die "RLS KAPALI TABLOLAR: $unprotected
       Bu tablolar anon anahtarıyla herkese açık okunur. Dağıtım durduruldu."
fi
ok "public şemasındaki her tabloda RLS açık"

tables=$(psql "$SUPABASE_DB_URL" -tAc \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r';")
policies=$(psql "$SUPABASE_DB_URL" -tAc \
  "select count(*) from pg_policies where schemaname='public';")
ok "${tables// /} tablo · ${policies// /} RLS politikası"

products=$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from public.products;" 2>/dev/null || echo "?")
if [ "${products// /}" = "0" ]; then
  warn "Katalog boş (0 teklif) — gerçek ortaklık beslemesi bağlanana kadar normaldir"
else
  ok "Katalogda ${products// /} teklif var"
fi

# --- 3.5 Seed verisi denetimi ----------------------------------------------
# Geliştirme seed'i üretime bir kez girerse site, uydurma fiyatları gerçek gibi
# gösterir. Arayüzde satıcı adını gizlemek bunu çözmez: adsız bir kart da
# "bu ürün şu fiyata" iddiasını sürdürür. Veriyi kaldırmak gerekir.
step "3.5/6 · Seed (örnek) verisi denetimi"

# Tespit, silme betiğinin KURU ÇALIŞTIRMASIYLA yapılır: böylece "seed nedir"
# sorusunun tek bir yanıtı olur ve tespit ile silme zamanla ayrışamaz.
seed_count=$(psql "$SUPABASE_DB_URL" -tA -v dry_run=1 \
               -f "$ROOT/scripts/purge-seed-data.sql" 2>/dev/null \
             | sed -n 's/^ *SEED_ROWS=\([0-9]*\).*/\1/p' | sed -n '1p')
seed_count="${seed_count:-0}"

if [ "${seed_count// /}" != "0" ]; then
  warn "Üretim veritabanında seed (uydurma) teklif bulundu."
  echo "     Bu satırlar gerçek olmayan fiyatları gerçekmiş gibi gösterir."
  if [ "${PURGE_SEED:-}" = "1" ]; then
    reply="e"
  elif [ -t 0 ]; then
    read -r -p "     Şimdi kaldırılsın mı? [e/H] " reply
  else
    reply="h"
  fi
  case "$reply" in
    e|E|y|Y)
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/purge-seed-data.sql" \
        || die "Seed temizliği başarısız."
      ok "Seed verisi kaldırıldı"
      ;;
    *)
      warn "Kaldırılmadı. Elle: psql \"\$SUPABASE_DB_URL\" -f scripts/purge-seed-data.sql"
      ;;
  esac
else
  ok "Seed verisi yok"
fi

# --- 4. Ortam değişkenleri -------------------------------------------------
step "4/6 · Vercel ortam değişkenleri"

if [ "${SKIP_VERCEL:-}" = "1" ]; then
  warn "SKIP_VERCEL=1 — atlandı"
else
  CLICK_HASH_SECRET="${CLICK_HASH_SECRET:-$(openssl rand -hex 32)}"
  ok "CLICK_HASH_SECRET üretildi (ortaklık tıklama imzası)"

  # `vercel env add` var olan değişkende hata verir; önce sessizce siler.
  set_env() {  # set_env <ad> <değer> <ortam...>
    local name="$1" value="$2"; shift 2
    local env
    for env in "$@"; do
      npx --yes vercel@latest env rm "$name" "$env" --yes >/dev/null 2>&1 || true
      printf '%s' "$value" | npx --yes vercel@latest env add "$name" "$env" >/dev/null 2>&1 \
        || die "Vercel'e '$name' yazılamadı. 'npx vercel login' ile giriş yaptınız mı?"
    done
    printf '  %s✓%s %-32s → %s\n' "$grn" "$rst" "$name" "$*"
  }

  npx --yes vercel@latest whoami >/dev/null 2>&1 \
    || die "Vercel oturumu yok. Önce: npx vercel login && npx vercel link"

  set_env NEXT_PUBLIC_SITE_URL          "$SITE_URL"                       production
  set_env NEXT_PUBLIC_SUPABASE_URL      "$NEXT_PUBLIC_SUPABASE_URL"       production preview
  set_env NEXT_PUBLIC_SUPABASE_ANON_KEY "$NEXT_PUBLIC_SUPABASE_ANON_KEY"  production preview
  set_env SUPABASE_URL                  "$NEXT_PUBLIC_SUPABASE_URL"       production
  set_env CLICK_HASH_SECRET             "$CLICK_HASH_SECRET"              production

  # service_role SADECE production. Önizleme adresleri kimlik doğrulaması
  # olmadan herkese açıktır; oraya konan bu anahtar, veritabanının tamamını
  # bağlantıyı bilen herkese açar.
  set_env SUPABASE_SERVICE_ROLE_KEY     "$SUPABASE_SERVICE_ROLE_KEY"      production
fi

# --- 5. Yayın durumu -------------------------------------------------------
step "5/6 · Yayın durumu"

placeholders=$(grep -roE '\[(Ad Soyad|Açık adres|Vergi dairesi|TC kimlik no[^]]*|Sicil no|ETBİS numarası|Telefon|barındırma sağlayıcısı|ölçümleme sağlayıcısı)\]' \
  "$ROOT/apps/web/src/app" 2>/dev/null | wc -l | tr -d ' ')

if [ "$placeholders" -gt 0 ]; then
  warn "Yasal metinlerde $placeholders doldurulmamış alan var."
  echo "     Mesafeli satış sözleşmesi ve ETBİS bilgisi, kurulmamış bir işletmeyi"
  echo "     adres gösteremez. NEXT_PUBLIC_LAUNCH_STATE 'prelaunch' bırakılıyor:"
  echo "     site çalışır ve gezilir, arama motorlarına kapalıdır."
  echo
  echo "     Şahıs firması kurulduktan ve alanlar dolduktan sonra:"
  echo "       ${bld}npx vercel env add NEXT_PUBLIC_LAUNCH_STATE production${rst}  → live"
  if [ "${SKIP_VERCEL:-}" != "1" ]; then
    set_env NEXT_PUBLIC_LAUNCH_STATE "prelaunch" production
  fi
else
  ok "Yasal metinler tamamlanmış — yayın açılıyor"
  if [ "${SKIP_VERCEL:-}" != "1" ]; then
    set_env NEXT_PUBLIC_LAUNCH_STATE "live" production
  fi
fi

# --- 6. Dağıtım ve doğrulama ----------------------------------------------
step "6/6 · Dağıtım"
if [ "${SKIP_VERCEL:-}" = "1" ]; then
  warn "SKIP_VERCEL=1 — dağıtım atlandı"
else
  npx --yes vercel@latest --prod || die "Dağıtım başarısız."
  ok "Üretime dağıtıldı"

  step "Canlı doğrulama"
  "$ROOT/scripts/verify-production.sh" "$SITE_URL" || true
fi

printf '\n%s  Kurulum bitti.%s\n\n' "$grn$bld" "$rst"
