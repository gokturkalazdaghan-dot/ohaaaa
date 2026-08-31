#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Agent araç kurulumu — Claude Code için beş yardımcı aracı tek komutta hazırlar.
#
# Bu betik yeniden çalıştırılabilir (idempotent): kurulu olanı atlar, eksik
# olanı kurar. Ephemeral (geçici) container'larda oturum başında çalıştırın.
#
# Kurulan araçlar:
#   1. Playwright CLI  — ajanlar için token-verimli tarayıcı sürücüsü
#   2. Supabase eklentisi — Claude Code plugin (skills + MCP)
#   3. Context7        — güncel kütüphane dokümanı MCP sunucusu
#   4. SkillUI         — web sitesinden tasarım sistemi çıkarır (statik)
#   5. Strix           — otonom AI penetrasyon testi ajanı (opsiyonel, docker)
#
# Kullanım:
#   ./tools/agent-setup/setup.sh            # varsayılan araçları kur
#   ./tools/agent-setup/setup.sh --all      # Strix dahil her şeyi kur
#   ./tools/agent-setup/setup.sh --check    # sadece durumu raporla, kurma
#
# Ortam değişkenleri (opsiyonel):
#   SUPABASE_ACCESS_TOKEN   Supabase MCP için kişisel erişim token'ı
#   CONTEXT7_API_KEY        Context7 için API anahtarı (daha yüksek limit)
#   STRIX_LLM, LLM_API_KEY  Strix için LLM sağlayıcısı
# ---------------------------------------------------------------------------
set -uo pipefail

# ----- bayraklar -----------------------------------------------------------
INSTALL_STRIX=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --all)   INSTALL_STRIX=1 ;;
    --strix) INSTALL_STRIX=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '3,23p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Bilinmeyen argüman: $arg" >&2
      exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ----- yardımcılar ---------------------------------------------------------
c_green() { printf '\033[32m%s\033[0m\n' "$1"; }
c_yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
c_red() { printf '\033[31m%s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

require_node() {
  if ! have node; then
    c_red "node bulunamadı. Node.js 20+ gerekli."; exit 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 18 ]; then
    c_red "Node $major çok eski; 18+ gerekli."; exit 1
  fi
}

# `claude` CLI kuruluysa MCP/plugin adımlarını yapabiliriz.
HAVE_CLAUDE=0
have claude && HAVE_CLAUDE=1

# ---------------------------------------------------------------------------
# 1) Playwright CLI
# ---------------------------------------------------------------------------
setup_playwright() {
  step "Playwright CLI (@playwright/cli)"
  if have playwright-cli; then
    c_green "zaten kurulu: $(playwright-cli --version 2>/dev/null || echo '?')"
  else
    [ "$CHECK_ONLY" = 1 ] && { c_yellow "eksik (kurulacak)"; return; }
    npm install -g @playwright/cli@latest \
      && c_green "kuruldu" \
      || { c_red "kurulum başarısız"; return; }
  fi
  # Bu container'da Chromium /opt/pw-browsers altında hazır; yeniden indirmeyin.
  if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    c_green "tarayıcı yolu ayarlı: $PLAYWRIGHT_BROWSERS_PATH (indirme atlanıyor)"
  else
    c_yellow "PLAYWRIGHT_BROWSERS_PATH ayarlı değil; gerekirse: npx playwright install chromium"
  fi
}

# ---------------------------------------------------------------------------
# 2) Supabase eklentisi (Claude Code plugin)
# ---------------------------------------------------------------------------
setup_supabase() {
  step "Supabase eklentisi (supabase-community/supabase-plugin)"
  if [ "$HAVE_CLAUDE" = 0 ]; then
    c_yellow "claude CLI yok; eklenti atlanıyor. Manuel: npx plugins add supabase-community/supabase-plugin"
    return
  fi
  if claude plugin list 2>/dev/null | grep -qi supabase; then
    c_green "eklenti zaten kurulu"
  else
    [ "$CHECK_ONLY" = 1 ] && { c_yellow "eksik (kurulacak)"; return; }
    claude plugin marketplace add supabase-community/supabase-plugin >/dev/null 2>&1 || true
    if claude plugin install supabase@supabase-plugin -y >/dev/null 2>&1 \
       || claude plugin install supabase-plugin -y >/dev/null 2>&1; then
      c_green "eklenti kuruldu"
    else
      c_yellow "eklenti otomatik kurulamadı; manuel: npx plugins add supabase-community/supabase-plugin"
    fi
  fi
  # Supabase MCP sunucusu — erişim token'ı gerekir.
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    c_yellow "SUPABASE_ACCESS_TOKEN ayarlı değil; MCP sunucusu okuma/yazma yapamaz."
    c_yellow "  Token: https://supabase.com/dashboard/account/tokens"
  else
    c_green "SUPABASE_ACCESS_TOKEN mevcut"
  fi
  c_yellow "NOT: Bu Claude Code oturumu zaten yönetilen bir Supabase MCP'sine bağlı olabilir."
}

# ---------------------------------------------------------------------------
# 3) Context7 MCP
# ---------------------------------------------------------------------------
setup_context7() {
  step "Context7 (güncel kütüphane dokümanı MCP)"
  if [ "$HAVE_CLAUDE" = 0 ]; then
    c_yellow "claude CLI yok; MCP eklenemiyor. Manuel: npx ctx7 setup"
    return
  fi
  if claude mcp list 2>/dev/null | grep -qi context7; then
    c_green "MCP zaten ekli"
    return
  fi
  [ "$CHECK_ONLY" = 1 ] && { c_yellow "eksik (eklenecek)"; return; }
  if [ -n "${CONTEXT7_API_KEY:-}" ]; then
    # API anahtarı ile remote (HTTP) sunucu — daha yüksek limit.
    claude mcp add --transport http context7 https://mcp.context7.com/mcp \
      --header "Authorization: Bearer ${CONTEXT7_API_KEY}" \
      && c_green "MCP eklendi (remote, API anahtarı ile)" \
      || c_red "MCP eklenemedi"
  else
    # Anahtarsız yerel stdio sunucu — anahtar gerekmez, limit daha düşük.
    claude mcp add context7 -- npx -y @upstash/context7-mcp \
      && c_green "MCP eklendi (yerel npx, anahtarsız)" \
      || c_red "MCP eklenemedi"
    c_yellow "  Daha yüksek limit için: CONTEXT7_API_KEY (https://context7.com/dashboard)"
  fi
}

# ---------------------------------------------------------------------------
# 4) SkillUI
# ---------------------------------------------------------------------------
setup_skillui() {
  step "SkillUI (web sitesinden tasarım sistemi çıkarır)"
  if have skillui; then
    c_green "zaten kurulu"
  else
    [ "$CHECK_ONLY" = 1 ] && { c_yellow "eksik (kurulacak)"; return; }
    npm install -g skillui \
      && c_green "kuruldu" \
      || { c_red "kurulum başarısız"; return; }
  fi
  c_yellow "Kullanım: npx skillui --url https://ornek.com  (statik; API anahtarı gerekmez)"
}

# ---------------------------------------------------------------------------
# 5) Strix (opsiyonel — otonom pentest ajanı)
# ---------------------------------------------------------------------------
setup_strix() {
  step "Strix (otonom AI penetrasyon testi ajanı)"
  if [ "$INSTALL_STRIX" = 0 ]; then
    c_yellow "atlandı (etkinleştirmek için --all veya --strix)"
    return
  fi
  if have strix; then
    c_green "zaten kurulu"
  else
    [ "$CHECK_ONLY" = 1 ] && { c_yellow "eksik (kurulacak)"; return; }
    if ! have docker; then
      c_red "docker gerekli ama bulunamadı; Strix atlanıyor."; return
    fi
    curl -sSL https://strix.ai/install | bash \
      && c_green "kuruldu" \
      || { c_red "kurulum başarısız"; return; }
  fi
  if [ -z "${STRIX_LLM:-}" ] || [ -z "${LLM_API_KEY:-}" ]; then
    c_yellow "STRIX_LLM ve LLM_API_KEY ayarlanmalı (örn: export STRIX_LLM=\"anthropic/claude-sonnet-4-6\")"
  else
    c_green "LLM yapılandırması mevcut ($STRIX_LLM)"
  fi
  c_yellow "UYARI: Yalnızca sahibi olduğunuz veya yetkiniz olan hedeflere karşı kullanın."
}

# ---------------------------------------------------------------------------
# ana akış
# ---------------------------------------------------------------------------
require_node

printf '\033[1mAgent araç kurulumu\033[0m'
[ "$CHECK_ONLY" = 1 ] && printf ' (yalnızca kontrol)'
printf '\n'
[ "$HAVE_CLAUDE" = 0 ] && c_yellow "claude CLI bulunamadı; plugin ve MCP adımları atlanacak."

setup_playwright
setup_supabase
setup_context7
setup_skillui
setup_strix

step "Bitti"
c_green "Kurulum tamamlandı. Ayrıntılar için: tools/agent-setup/README.md"
if [ "$HAVE_CLAUDE" = 1 ]; then
  echo "MCP durumunu görmek için: claude mcp list"
  echo "Eklentileri görmek için:  claude plugin list"
fi
