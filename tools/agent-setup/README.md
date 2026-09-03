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
| 5 | **codebase-memory** | Kod tabanından kalıcı bilgi grafiği kurar (yapısal + semantik arama, ölü kod, mimari); 162 dil | `curl .../install.sh \| bash` | Yok (yerel, gömülü embedding) |
| 6 | **Strix** | Otonom AI penetrasyon testi ajanı | `curl .../install \| bash` | `docker`, `STRIX_LLM`, `LLM_API_KEY` — **opsiyonel** |
| 7 | **jcode** | Claude Code'a **alternatif** ajan harness'ı (Rust); MCP/eklenti değil | `curl .../install \| bash` | Sağlayıcı login — **opsiyonel** |

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

### 5. codebase-memory
Kod tabanından kalıcı bir bilgi grafiği kurar; ajan yapısal (Cypher benzeri)
ve semantik sorgular çalıştırabilir, ölü kod ve mimariyi çıkarabilir. Tek
statik binary, **API key/DB/runtime gerekmez**, `~/.cache/` altında saklar.
```bash
# MCP olarak Claude Code'a eklenir; ajana şunu söyleyin:
"Bu projeyi indeksle"
# Yerel CLI ile de kullanılabilir:
codebase-memory-mcp cli index_repository '{"repo_path":"/yol/proje"}'
codebase-memory-mcp cli index_status    '{"project":"proje-adi"}'
```
Doğrulandı: ohaaaa monorepo → **1470 düğüm / 4067 kenar** indekslendi.
NOT: SQL migration'lar tree-sitter'ın sınırlı Postgres grameri nedeniyle
kısmi ayrıştırılır (`parse_partial`); bu dosyalarda metin araması (grep) tercih
edin. Kurulum `--skip-config` olmadan Claude Code'u otomatik yapılandırır.

### 6. Strix (opsiyonel, güvenlik)
```bash
export STRIX_LLM="anthropic/claude-sonnet-4-6"
export LLM_API_KEY="..."
strix --target ./app-directory
```
Otonom sızma testi aracı. **Yalnızca sahibi olduğunuz ya da açıkça yetki
aldığınız hedeflere karşı çalıştırın.** Varsayılan kurulumda atlanır;
`--all` ya da `--strix` ile etkinleşir. İlk çalıştırmada docker imajını çeker.

### 7. jcode (opsiyonel, alternatif harness)
```bash
jcode                          # TUI başlat
jcode login --provider claude  # sağlayıcı girişi
jcode run "merhaba de"         # tek komut
```
**Bu bir Claude Code eklentisi/MCP'si DEĞİL** — Claude Code'a alternatif, ayrı
bir ajan CLI'sidir (Rust; Claude Code/Codex oturumlarını devralabilir).
Kategorisi farklı olduğu için varsayılanda atlanır; `--all` ya da `--jcode`
ile etkinleşir. Kurulum üçüncü-parti alan adından (`jcode.sh`) `curl … | bash`
olduğundan bu ortamın proxy'si engelleyebilir.

> **Uzak betik güvenliği:** codebase-memory ve jcode kurulumları uzak
> `curl … | bash` kullanır. Betikleri kurmadan önce inceledik; yine de
> güvendiğiniz sürümleri sabitlemek isterseniz install betiklerini repoya
> vendor'layabilirsiniz.

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
| _(yok)_ | codebase-memory | Anahtar gerekmez (yerel) |
| _(sağlayıcı login)_ | jcode | `jcode login` ile; anahtar gerekmez |
