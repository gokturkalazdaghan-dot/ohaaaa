#!/usr/bin/env bash
# Doğrulama sunucusunu GÜVENİLİR şekilde yeniden başlatır.
#
# NEDEN AYRI BİR BETİK
# `next start` portu tutulmuş bulduğunda EADDRINUSE deyip ÇIKAR, ama bunu
# arka planda yaptığı için çağıran taraf başarılı sanır. Sonuç: eski yapıyı
# sunan bir sunucuya karşı test koşulur. Bu, testleri hem yalancı yeşil hem
# yalancı kırmızı yapar — kaynağı da uzaktan hiç belli olmaz (bir kez CSS
# parçası artık diskte olmadığı için `text/plain` dönüp bütün sayfayı
# stilsiz bıraktı ve 19 kontrol birden düştü).
#
# Bu yüzden: önce port GERÇEKTEN boşaltılır, sonra başlatılır, sonra da
# sunulan HTML'in diskteki yapıyla aynı parçayı gösterdiği DOĞRULANIR.
set -euo pipefail

PORT="${PORT:-3137}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${LOG:-/tmp/ohaaaa-next-${PORT}.log}"

cd "$ROOT/apps/web"

# --- Portu boşalt ----------------------------------------------------------
for _ in 1 2 3 4 5; do
  pids="$(pgrep -f "next start -p ${PORT}" || true)"
  extra="$(pgrep -f 'next-server' || true)"
  all="$(printf '%s\n%s\n' "$pids" "$extra" | tr ' ' '\n' | grep -E '^[0-9]+$' || true)"
  [ -z "$all" ] && break
  # shellcheck disable=SC2086
  kill -9 $all 2>/dev/null || true
  sleep 1
done

if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  echo "HATA: ${PORT} portu hâlâ dolu." >&2
  exit 1
fi

# --- Başlat ----------------------------------------------------------------
: > "$LOG"
npx next start -p "$PORT" > "$LOG" 2>&1 &

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then break; fi
  if grep -q 'EADDRINUSE\|Failed to start' "$LOG" 2>/dev/null; then
    echo "HATA: sunucu başlatılamadı:" >&2
    head -5 "$LOG" >&2
    exit 1
  fi
  sleep 1
done

# --- Sunulan yapı diskteki yapı mı? ---------------------------------------
# Bu kontrol olmadan, eski bir sunucuya karşı koşulan testin sonucu anlamsız.
served="$(curl -fsS "http://127.0.0.1:${PORT}/" | grep -m1 -o 'chunks/[a-z0-9_-]*\.css' | sed 's|chunks/||')"
if [ -n "$served" ] && [ ! -f ".next/static/chunks/${served}" ]; then
  echo "HATA: sunucu diskte olmayan bir yapıyı sunuyor (${served})." >&2
  echo "Eski bir süreç hâlâ ayakta olabilir." >&2
  exit 1
fi

echo "Sunucu hazır: http://127.0.0.1:${PORT} (yapı: ${served:-bilinmiyor})"
exit 0
