# `main` branch koruma ayarlari

Bu dosya bir talimat degil, bir KONTROL LISTESI. Ayarlarin kendisi GitHub
depo ayarlarinda yapilir ve kod tarafindan degistirilemez; burada yalnizca
neyin neden gerektigi yaziyor.

## Neden gerekli

`main` production'a otomatik dagitiliyor ve depo herkese acik. Koruma
olmadan tek bir yanlis itme (push) dogrudan production'a cikar. Para
tasiyan bir sistemde inceleme kapisi olmadan dagitim, hizlandirdigindan
cok daha fazlasini riske atar.

Denetim aninda olculen durum: `main` dahil bes dalin hicbirinde koruma
yoktu (`protected: false`).

## Acilmasi gereken kurallar

GitHub: **Settings -> Branches -> Add branch ruleset** (ya da klasik
*Branch protection rules*), hedef dal: `main`.

| Ayar | Deger | Gerekce |
|---|---|---|
| Require a pull request before merging | acik | Dogrudan itme kapanir |
| Require approvals | en az 1 | Inceleme kapisi |
| Require review from Code Owners | acik | `.github/CODEOWNERS` ancak bu ayarla zorunlu olur |
| Dismiss stale approvals on new commits | acik | Onaydan sonra eklenen commit incelenmemis kalmasin |
| Require status checks to pass | acik + `test` isi | CI kirmizyken birlestirme olmasin |
| Require branches to be up to date | acik | Birlesme sonrasi kirilmayi engeller |
| Block force pushes | acik | Gecmis yeniden yazilamaz |
| Restrict deletions | acik | `main` silinemez |
| Require linear history | istege bagli | Gecmis okunabilirligi |

## Depo geneli

- **Settings -> Code security**: *Secret scanning* ve *Push protection* acik
  olmali. Depo herkese acik oldugu icin ikisi de ucretsiz.
- **Settings -> Actions -> General -> Workflow permissions**: *Read
  repository contents permission* secili olmali. Is akislarinin kendisi
  zaten `permissions: contents: read` yaziyor, ama depo varsayilanini da
  daraltmak ikinci katman.
- **Dependabot alerts** acik olmali; `.github/dependabot.yml` guncelleme
  PR'larini zaten aciyor.

## Eylem SHA sabitleme — TAMAMLANDI

Is akislari `actions/checkout@v4` gibi DEGISEBILIR etiketler kullaniyordu:
`v4` bir surum degil, bakimcinin her yayinda tasidigi bir takma ad. Yani
dun denetlenen kod, bugun haber vermeden baska bir kod olabilirdi.

Su an sabitlenmis SHA'lar (`git ls-remote` ile dogrulandi; her ikisi de
sabitleme anindaki `v4` takma adiyla birebir ayni commit):

| Eylem | SHA | Surum |
|---|---|---|
| `actions/checkout` | `11d5960a326750d5838078e36cf38b85af677262` | v4.4.0 |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0 |

Davranis degismedi: sabitleme, o an zaten calisan commit'i sabitledi.

Sabitlemenin bilinen bedeli guncellemelerin donmasidir; onu
`.github/dependabot.yml` odiyor: yeni surum ciktiginda SHA'yi guncelleyen
bir PR acilir ve degisiklik insan incelemesinden gecer.

### Dependabot ve "Actions PR olusturma" ayari

Depo ayarlarinda *Allow GitHub Actions to create and approve pull requests*
KAPALI. Bu Dependabot'u ETKILEMEZ: Dependabot PR'lari `GITHUB_TOKEN` ile
degil Dependabot'un kendi kimligiyle acilir. Ayarin kapali olmasi dogru ve
daha guvenli.
