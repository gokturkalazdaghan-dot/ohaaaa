#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Canlı site doğrulaması.
#
# Dağıtımdan sonra "sanırım çalışıyor" ile "çalıştığını biliyorum" arasındaki
# farkı kapatır. Yayına almadan önce sık yapılan 10 hatayı tek tek denetler.
#
# Kullanım:
#   ./scripts/verify-production.sh https://ohaaaa.com
# ---------------------------------------------------------------------------
set -uo pipefail

SITE="${1:-}"

if [ -z "$SITE" ]; then
  echo "Kullanım: $0 https://ohaaaa.com" >&2
  exit 2
fi

SITE="${SITE%/}"
PASS=0
FAIL=0
WARN=0

# NOT: Değişken içeriğini borulara `printf '%s'` ile veriyoruz. `echo`,
# kabuk ve yapılandırmaya göre ters bölü kaçışlarını yorumlar ve HTML/JSON
# içeriğini sessizce bozar — bu betikte tam olarak o hataya düşülmüştü.
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN+1)); }

fetch() { curl -sS --max-time 20 "$@" 2>/dev/null; }

# ---------------------------------------------------------------------------
# İçerik araması BORU KULLANMADAN yapılır.
#
# `printf '%s' "$html" | grep -q DESEN` görünüşte doğrudur ama `pipefail`
# ile birlikte SESSİZCE YANLIŞ sonuç verir: `grep -q` ilk eşleşmede hemen
# çıkar, boruyu kapatır, `printf` SIGPIPE alır (çıkış 141) ve `pipefail`
# tüm hattı başarısız sayar. Sonuç: eşleşme BULUNDUĞUNDA "bulunamadı" denir.
#
# Bu betikte tam olarak o hata vardı ve "her şey yolunda" diyen yanlış bir
# rapor üretiyordu — bir doğrulama aracında yapılabilecek en kötü hata.
#
# Bash'in kendi desen eşleştirmesi hem doğrudur hem daha hızlıdır.
# ---------------------------------------------------------------------------
contains() {
  case "$2" in
    *"$1"*) return 0 ;;
    *)      return 1 ;;
  esac
}

# Satır sayısı değil, GEÇİŞ sayısı. Sitemap tek satırlık XML olduğu için
# `grep -c` hep 1 döndürürdü.
count_occurrences() {
  local haystack="$1" needle="$2" rest count=0
  rest="$haystack"
  while [ "${rest#*"$needle"}" != "$rest" ]; do
    rest="${rest#*"$needle"}"
    count=$((count + 1))
  done
  printf '%s' "$count"
}
status() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null; }

echo "▸ $SITE doğrulanıyor"
echo

# --- 1. Erişilebilirlik -----------------------------------------------------
echo "1. Erişilebilirlik"
code=$(status "$SITE/")
if [ "$code" = "200" ]; then ok "Ana sayfa 200"; else bad "Ana sayfa $code döndü"; fi

for path in /hakkimizda /sss /gizlilik /kosullar /iletisim /ortaklik-aciklamasi /bot; do
  code=$(status "$SITE$path")
  [ "$code" = "200" ] || bad "$path → $code"
done
[ "$FAIL" -eq 0 ] && ok "Yasal ve bilgi sayfalarının tümü açılıyor"

# --- 2. HTTPS ve yönlendirme -----------------------------------------------
# Bu bölümün önceki hali iki ayrı şekilde yanlıştı:
#
#   1. `${SITE#https://}` yalnızca https şemasını soyuyordu. Yerel sunucu
#      (http://...) verildiğinde "https://www.http://127.0.0.1:3137" gibi
#      anlamsız bir adres kuruyor ve her seferinde "DNS eksik" uyarısı
#      basıyordu.
#
#   2. Yön ELLE sabitlenmişti: her zaman "www çıplak adrese yönlensin"
#      bekleniyordu. Oysa bu projenin kanonik adresi www'lu. Yani kontrol,
#      site doğru davransa bile yanlış rapor verirdi.
#
# Artık kanonik ana ad sitenin KENDİ beyanından (sitemap'teki mutlak
# adresler) okunur ve karşıt biçimin ona yönlendiği doğrulanır.
echo
echo "2. HTTPS ve alan adı"

sitemap_early=$(fetch "$SITE/sitemap.xml")
canonical_host=$(printf '%s\n' "$sitemap_early" \
  | grep -oE '<loc>https?://[^/<]+' | sed -n '1s|.*://||p')

if [ -z "$canonical_host" ]; then
  warn "Kanonik ana ad belirlenemedi (sitemap okunamadı)"
elif printf '%s' "$canonical_host" | grep -qE '^(localhost|127\.|0\.|\[?::1)|^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'; then
  # Yerel sunucuda DNS yok; bu kontrol yalnızca gerçek alan adında anlamlıdır.
  ok "Yerel adres — alan adı yönlendirmesi bu ortamda sınanmaz ($canonical_host)"
else
  # Yerel bir sunucu sınanıyor ama site gerçek bir alan adını kanonik ilan
  # ediyor. Yönlendirme DNS ve barındırma katmanında olur; buradan sınanamaz.
  # "DNS eksik" demek yanıltıcı olurdu - sorun DNS'te değil, test yerinde.
  site_host="${SITE#*://}"; site_host="${site_host%%/*}"; site_host="${site_host%%:*}"
  case "$site_host" in
    localhost|127.*|0.0.0.0|::1|[0-9]*.[0-9]*.[0-9]*.[0-9]*)
      ok "Kanonik adres $canonical_host — yönlendirme yalnızca canlı ortamda sınanabilir"
      SKIP_REDIRECT=1 ;;
  esac

  case "$canonical_host" in
    www.*) other="${canonical_host#www.}" ;;
    *)     other="www.$canonical_host" ;;
  esac
  redirect=""
  [ "${SKIP_REDIRECT:-}" = "1" ] || redirect=$(curl -sS -o /dev/null \
      -w '%{http_code} %{redirect_url}' --max-time 20 "https://$other" 2>/dev/null)
  case "${SKIP_REDIRECT:-}${redirect}" in
    1) : ;;
    30*"$canonical_host"*) ok "$other → $canonical_host yönlendiriyor" ;;
    000*)                  warn "$other yanıt vermiyor (DNS kaydı eksik olabilir)" ;;
    200*)                  bad "$other ayrı bir site olarak yanıt veriyor — mükerrer içerik" ;;
    *)                     warn "$other yanıtı beklenmedik: $redirect" ;;
  esac
fi

# --- 3. Demo modu -----------------------------------------------------------
echo
echo "3. Veri kaynağı"
home=$(fetch "$SITE/")
if contains "Demo modu" "$home"; then
  bad "DEMO MODU AÇIK — Supabase bağlanmamış, gösterilen veriler sahte"
else
  ok "Canlı veri (demo şeridi yok)"
fi

# --- 4. Yayın durumu --------------------------------------------------------
echo
echo "4. Yayın durumu"
robots=$(fetch "$SITE/robots.txt")
prelaunch=0
if contains "Yayın öncesi" "$home"; then
  prelaunch=1
  warn "Yayın öncesi modda — arama motorlarına kapalı (NEXT_PUBLIC_LAUNCH_STATE=live ile açılır)"
elif grep -qE "^Disallow: /$" <<<"$robots"; then
  warn "robots.txt her şeyi kapatıyor"
else
  ok "Yayında ve taramaya açık"
fi

# --- 5. SEO temelleri -------------------------------------------------------
echo
echo "5. SEO"
if contains "Sitemap:" "$robots"; then
  ok "robots.txt sitemap bildiriyor"
elif [ "$prelaunch" -eq 1 ]; then
  ok "robots.txt sitemap bildirmiyor (yayın öncesinde beklenen davranış)"
else
  warn "robots.txt'de sitemap yok"
fi

sitemap=$(fetch "$SITE/sitemap.xml")
# grep -c SATIR sayar; sitemap tek satırlık XML olduğu için hep 1 dönerdi.
urls=$(count_occurrences "$sitemap" "<loc>")
if [ "$urls" -gt 5 ]; then ok "Sitemap $urls adres içeriyor"; else bad "Sitemap boş veya eksik ($urls adres)"; fi

if grep -qE "localhost|vercel\.app" <<<"$sitemap"; then
  bad "Sitemap yanlış alan adı içeriyor — NEXT_PUBLIC_SITE_URL ayarlanmamış"
else
  ok "Sitemap doğru alan adını kullanıyor"
fi

# --- 6. Yapılandırılmış veri ------------------------------------------------
echo
echo "6. Yapılandırılmış veri"
# Sitemap MUTLAK adres içerir. Test edilen adres farklıysa (ör. önizleme
# dağıtımı veya yerel sunucu) bu adrese gitmek yanlış siteyi denetler;
# bu yüzden yalnızca yol kısmı alınıp $SITE ile birleştirilir.
product_path=$(echo "$sitemap" \
  | grep -oE '<loc>[^<]*/urun/[^<]*</loc>' \
  | head -1 \
  | sed 's|.*<loc>||; s|</loc>||; s|^https\?://[^/]*||')

if [ -n "$product_path" ]; then
  product=$(fetch "$SITE$product_path")
  if contains '"@type":"Product"' "$product"; then ok "Ürün şeması gömülü"; else bad "Ürün sayfasında Product şeması yok"; fi
  if contains "AggregateOffer" "$product"; then ok "Fiyat aralığı şeması gömülü"; else warn "AggregateOffer yok — zengin sonuç çıkmaz"; fi
else
  warn "Sitemap'te ürün sayfası yok (katalog boş olabilir)"
fi

if contains "SearchAction" "$home"; then ok "Site içi arama şeması gömülü"; else warn "SearchAction yok"; fi

# --- 7. Güvenlik ------------------------------------------------------------
echo
echo "7. Güvenlik"
if contains "service_role" "$home"; then
  bad "SERVICE_ROLE ANAHTARI SAYFADA GÖRÜNÜYOR — DERHAL DÖNDÜRÜN"
else
  ok "service_role anahtarı istemciye sızmıyor"
fi

headers=$(curl -sSI --max-time 20 "$SITE/" 2>/dev/null)
contains "strict-transport-security" "$headers" && ok "HSTS aktif" || warn "HSTS başlığı yok"
contains "x-content-type-options" "$headers" && ok "nosniff aktif" || warn "x-content-type-options yok"

# --- 8. Korumalı alanlar ----------------------------------------------------
echo
echo "8. Erişim denetimi"
admin=$(status "$SITE/yonetim")
case "$admin" in
  30*|404) ok "Yönetim paneli oturumsuz erişime kapalı ($admin)" ;;
  200)     bad "YÖNETİM PANELİ HERKESE AÇIK — acil kontrol edin" ;;
  *)       warn "/yonetim → $admin" ;;
esac

checkout=$(fetch "$SITE/odeme")
contains "noindex" "$checkout" && ok "Ödeme sayfası indekslenmiyor" || warn "Ödeme sayfasında noindex yok"

# --- 9. Yönlendirme (para yolu) ---------------------------------------------
echo
echo "9. Ortaklık yönlendirmesi"
if [ -n "$product_path" ]; then
  offer=$(printf '%s' "$product" | grep -oE '/git/[A-Za-z0-9-]+' | head -1)
  if [ -n "$offer" ]; then
    redirect=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "$SITE$offer" 2>/dev/null)
    case "$redirect" in
      30*subid=*) ok "Yönlendirme çalışıyor ve subid taşıyor" ;;
      30*)        bad "Yönlendirme subid TAŞIMIYOR — komisyon atfedilemez" ;;
      *)          bad "Yönlendirme başarısız: $redirect" ;;
    esac
  else
    warn "Ürün sayfasında ortaklık teklifi yok (henüz mağaza bağlanmamış)"
  fi
fi

# --- 10. Yasal metin eksikleri ----------------------------------------------
echo
echo "10. Yasal metinler"
# Künye artık sayfalara gömülü değil; NEXT_PUBLIC_BUSINESS_* ortam
# değişkenlerinden gelir (src/lib/legal.ts). Eksik olduğunda sayfa bunu
# görünür bir uyarıyla söyler. Bu yüzden kontrol köşeli parantezli yer
# tutucu değil, O UYARIYI arar.
legal_incomplete=0
for path in /iletisim /gizlilik /kosullar; do
  page=$(fetch "$SITE$path")
  if contains "İşletme kaydı tamamlanmadı" "$page"; then
    legal_incomplete=$((legal_incomplete + 1))
  fi
done

if [ "$legal_incomplete" -eq 0 ]; then
  ok "İşletme künyesi tamamlanmış"
else
  warn "Künye eksik ($legal_incomplete sayfada uyarı görünüyor) — NEXT_PUBLIC_BUSINESS_* değişkenlerini doldurun"
fi

# --- Özet -------------------------------------------------------------------
echo
echo "────────────────────────────────────────"
printf "  \033[32m%d geçti\033[0m · \033[33m%d uyarı\033[0m · \033[31m%d başarısız\033[0m\n" "$PASS" "$WARN" "$FAIL"
echo "────────────────────────────────────────"

[ "$FAIL" -eq 0 ] || exit 1
