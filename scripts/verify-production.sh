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
echo
echo "2. HTTPS ve alan adı"
apex="${SITE#https://}"
www_redirect=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "https://www.$apex" 2>/dev/null)
case "$www_redirect" in
  30*"$SITE"*) ok "www → çıplak alan adına yönlendiriyor" ;;
  000*)        warn "www.$apex yanıt vermiyor (DNS eksik olabilir)" ;;
  200*)        bad "www ayrı bir site olarak yanıt veriyor — mükerrer içerik" ;;
  *)           warn "www yanıtı beklenmedik: $www_redirect" ;;
esac

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
placeholders=0
for path in /iletisim /gizlilik /kosullar; do
  page=$(fetch "$SITE$path")
  n=$(printf '%s' "$page" | grep -oE '\[(Ad Soyad|Açık adres|açık adres|Vergi dairesi|TC kimlik no[^]]*|Sicil no|ETBİS numarası|Telefon)\]' | wc -l)
  placeholders=$((placeholders + n))
done

if [ "$placeholders" -eq 0 ]; then
  ok "Yasal metinlerde doldurulmamış alan yok"
else
  warn "$placeholders doldurulmamış alan var — işletme kaydı sonrası tamamlanmalı"
fi

# --- Özet -------------------------------------------------------------------
echo
echo "────────────────────────────────────────"
printf "  \033[32m%d geçti\033[0m · \033[33m%d uyarı\033[0m · \033[31m%d başarısız\033[0m\n" "$PASS" "$WARN" "$FAIL"
echo "────────────────────────────────────────"

[ "$FAIL" -eq 0 ] || exit 1
