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

## Eylem SHA sabitleme

Is akislari `actions/checkout@v4` gibi DEGISEBILIR etiketler kullaniyor:
`v4` bir surum degil, bakimcinin her yayinda tasidigi bir takma ad.
Guvenli hal commit SHA'sina sabitlemektir.

Bu calisma sirasinda sabitlenemedi: resmi eylem depolarina bu ortamdan
erisim yok (GitHub API 403, depo kapsami yalnizca bu depoyu iceriyor) ve
dogrulanmamis bir SHA yazmak CI'yi kirardi. SHA uydurulmadi.

Sabitleme yapildiginda `.github/dependabot.yml` guncellemeleri PR olarak
getirmeye devam eder; yani sabitlemenin bilinen bedeli (guncellemelerin
donmasi) zaten karsilanmis durumda.
