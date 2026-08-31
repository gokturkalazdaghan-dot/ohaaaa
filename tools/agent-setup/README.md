# Agent araç kurulumu

Claude Code ile birlikte kullanılan beş yardımcı aracı **tek komutta** ve
**yeniden çalıştırılabilir** biçimde kurar. Amaç: geçici (ephemeral)
container'larda her oturum başında aynı ortamı hızlıca geri getirmek.

```bash
./tools/agent-setup/setup.sh          # varsayılan araçlar
./tools/agent-setup/setup.sh --all    # Strix dahil
./tools/agent-setup/setup.sh --check  # kurmadan durum raporu
```

## Neden bu klasör var?

Bu oturumlar geçici bir container'da çalışır: `npm install -g ...` ile
kurduğunuz her şey oturum bitince kaybolur. Kurulum adımlarını bir betiğe
yazıp repoya koyarak, her yeni oturumda (veya yerel makinede) tek komutla
aynı ortamı geri getirebilirsiniz. Betik idempotent'tir; kurulu olanı atlar.

## Araçlar

| # | Araç | Ne işe yarar | Kurulum | Anahtar/gereksinim |
|---|------|--------------|---------|--------------------|
| 1 | **Playwright CLI** | Ajanlar için token-verimli tarayıcı sürücüsü (`open`, `type`, `screenshot`) | `npm i -g @playwright/cli` | Chromium bu container'da `/opt/pw-browsers` altında hazır |
| 2 | **Supabase eklentisi** | Supabase rehber skill'leri + MCP adaptörü | Claude Code plugin | MCP yazma için `SUPABASE_ACCESS_TOKEN` |
| 3 | **Context7** | Güncel, sürüme özel kütüphane dokümanını prompt'a enjekte eden MCP | `claude mcp add` | Opsiyonel `CONTEXT7_API_KEY` (yüksek limit) |
| 4 | **SkillUI** | Bir web sitesinden tasarım sistemini (renk, tipografi, bileşen) çıkarıp Claude'a hazır doküman üretir | `npm i -g skillui` | Yok (statik analiz) |
| 5 | **Strix** | Otonom AI penetrasyon testi ajanı | `curl .../install \| bash` | `docker`, `STRIX_LLM`, `LLM_API_KEY` — **opsiyonel** |

### 1. Playwright CLI
```bash
playwright-cli open https://ornek.com --headed
playwright-cli type "merhaba"
playwright-cli screenshot
```
Bu container'da `PLAYWRIGHT_BROWSERS_PATH` zaten ayarlı; tarayıcıyı yeniden
indirmeyin (`playwright install` çalıştırmayın).

### 2. Supabase eklentisi
- Hızlı kurulum: `npx plugins add supabase-community/supabase-plugin`
- Claude Code içinden: `claude plugin marketplace add supabase-community/supabase-plugin`
- MCP okuma/yazma için erişim token'ı:
  <https://supabase.com/dashboard/account/tokens>
- **Dikkat:** Bu Claude Code oturumu çoğu zaman zaten yönetilen bir Supabase
  MCP'sine bağlıdır (`list_projects`, `execute_sql`, `apply_migration` …). O
  durumda eklentinin MCP kısmı gereksizdir; skill'ler yine faydalıdır.

### 3. Context7
İki mod (yalnızca birini seçin):
```bash
# Remote (API anahtarı ile, yüksek limit)
claude mcp add --transport http context7 https://mcp.context7.com/mcp \
  --header "Authorization: Bearer $CONTEXT7_API_KEY"

# Yerel (anahtarsız)
claude mcp add context7 -- npx -y @upstash/context7-mcp
```
Kolay yol: `npx ctx7 setup` (OAuth ile anahtar üretir ve skill'i kurar).

### 4. SkillUI
```bash
npx skillui --url https://notion.so       # statik
npx skillui --url https://notion.so --ultra   # Playwright ekran görüntüsü ile
```
Çıktı klasöründe `CLAUDE.md`, `SKILL.md`, `DESIGN.md` üretir; API anahtarı
gerekmez.

### 5. Strix (opsiyonel, güvenlik)
```bash
export STRIX_LLM="anthropic/claude-sonnet-4-6"
export LLM_API_KEY="..."
strix --target ./app-directory
```
Otonom sızma testi aracı. **Yalnızca sahibi olduğunuz ya da açıkça yetki
aldığınız hedeflere karşı çalıştırın.** Varsayılan kurulumda atlanır;
`--all` ya da `--strix` ile etkinleşir. İlk çalıştırmada docker imajını çeker.

## MCP yapılandırması

`mcp.example.json` elle kurulum ya da `.mcp.json`'a kopyalama içindir.
Gerçek anahtarları dosyaya yazmayın; ortam değişkeni kullanın. `claude mcp add`
komutları bu girdileri sizin için yazar.

## Bonus: `/codex` skill'i

`skills/codex/SKILL.md`, OpenAI Codex'i Claude Code içinden "Rocket Fuel"
sistemiyle çalıştıran hardened bir sarmalayıcıdır (Claude planlar ve gözden
geçirir, Codex kod yazar). Kullanıcı skill dizinine kurmak için:

```bash
mkdir -p ~/.claude/skills/codex
cp tools/agent-setup/skills/codex/SKILL.md ~/.claude/skills/codex/SKILL.md
```

Motor dosyaları ayrı bir repodadır:
```bash
git clone https://github.com/NulightJens/rocket-fuel-skill.git ~/rocket-fuel-skill
```
`codex` CLI'nin kurulu ve `codex login` ile oturum açılmış olması gerekir;
aksi halde skill'in Integrator adımları çalışmaz.

## Ortam değişkenleri özeti

| Değişken | Kimin için | Zorunlu mu |
|----------|-----------|-----------|
| `SUPABASE_ACCESS_TOKEN` | Supabase MCP | MCP yazma için evet |
| `CONTEXT7_API_KEY` | Context7 | Hayır (limit artırır) |
| `STRIX_LLM`, `LLM_API_KEY` | Strix | Strix kullanılacaksa evet |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright | Bu container'da hazır |
