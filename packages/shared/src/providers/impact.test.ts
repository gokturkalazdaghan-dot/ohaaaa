/**
 * Impact sağlayıcısı ve yetenek sözleşmesi testleri.
 *
 * FIXTURE'LARIN KAYNAĞI: alan adları resmî yayıncı API dokümantasyonundan
 * (`integrations.impact.com/partner-api-reference`, 2026-09-25). Hiçbir
 * gerçek kimlik bilgisi, hesap kimliği ya da canlı yanıt kullanılmadı --
 * aşağıdaki `SID` uydurma bir dizedir.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  IMPACT_API_BASE,
  IMPACT_MAX_PAGE_SIZE,
  IMPACT_MAX_RANGE_DAYS,
  IMPACT_SID_ENV,
  IMPACT_TOKEN_ENV,
  ProviderError,
  awinProvider,
  directProvider,
  getProvider,
  impactActionToConversion,
  impactActionsUrl,
  impactCampaignToProgram,
  impactCampaignsUrl,
  impactCatalogItemToOffer,
  impactCatalogItemsUrl,
  impactParseActions,
  impactParseCampaigns,
  impactParseCatalogItems,
  impactProvider,
  impactSonrakiSayfaUrl,
  impactSubId1ToSubid,
  knownNetworks,
} from './index.js';

/** FIXTURE — uydurma hesap kimliği. Gerçek bir hesabı göstermez. */
const SID = 'FixtureAccountSid0000';

// ===========================================================================
// KAYIT
// ===========================================================================

test('impact registry uzerinden cozulur', () => {
  assert.equal(getProvider('impact').network, 'impact');
  assert.equal(getProvider('impact').displayName, 'Impact');
});

test('impact eklenmesi awin ve direct ile birlikte yasar', () => {
  assert.deepEqual(knownNetworks(), ['awin', 'direct', 'impact']);
});

// ===========================================================================
// YETENEK SOZLESMESI — her saglayici neyi sundugunu ILAN ETMELI
// ===========================================================================

test('her saglayici yeteneklerini ve sinirlarini ilan eder', () => {
  for (const provider of [directProvider, awinProvider, impactProvider]) {
    assert.ok(provider.capabilities, `${provider.network}: capabilities yok`);
    assert.ok(provider.limits, `${provider.network}: limits yok`);

    // `conversionSource` ile `capabilities.conversions` AYRISAMAZ: ikisi
    // ayni gercegi soyluyor ve biri unutulursa route yanlis dala girer.
    assert.equal(
      provider.capabilities.conversions,
      provider.conversionSource,
      `${provider.network}: conversions ilani conversionSource ile celisiyor`,
    );
  }
});

test("deeplink 'template' diyen saglayici kendi buildDeeplink'ini YAZMAZ", () => {
  /*
   * Ikizlenmis bir mekanizma zamanla ayrisir. Ilan ile kod ayni seyi
   * soylemek zorunda: 'template' diyen bir aga ozel deeplink kodu varsa
   * ikisinden biri yanlis.
   */
  for (const provider of [directProvider, awinProvider, impactProvider]) {
    if (provider.capabilities.deeplink === 'template') {
      assert.equal(
        provider.buildDeeplink,
        undefined,
        `${provider.network}: 'template' ilan etti ama buildDeeplink tanimli`,
      );
    }
  }
});

test("catalog: 'api' diyen saglayici katalog istegini de kurabilmeli", () => {
  for (const provider of [directProvider, awinProvider, impactProvider]) {
    if (provider.capabilities.catalog === 'api') {
      assert.equal(typeof provider.catalogItemsRequest, 'function');
      assert.equal(typeof provider.parseCatalogItems, 'function');
    }
  }
});

test("programs: 'api' diyen saglayici kesif istegini de kurabilmeli", () => {
  for (const provider of [directProvider, awinProvider, impactProvider]) {
    if (provider.capabilities.programs === 'api' && provider.network === 'impact') {
      assert.equal(typeof provider.programsRequest, 'function');
      assert.equal(typeof provider.parsePrograms, 'function');
    }
  }
});

test('impact sinirlari resmi dokumanla ayni', () => {
  assert.equal(impactProvider.limits.requestsPerHour, 1_000);
  assert.equal(impactProvider.limits.maxRangeDays, 45);
  assert.equal(impactProvider.limits.maxPageSize, 1_000);
  assert.equal(impactProvider.limits.maxPagedResults, 20_000);
  // Dakikalik sinir YAYINLANMIYOR -- 'bilinmiyor' sifir ya da sonsuz degil.
  assert.equal(impactProvider.limits.requestsPerMinute, null);
});

// ===========================================================================
// SIR SIZINTISI — paket hicbir kosulda sir TASIMAZ
// ===========================================================================

test('istek yalnizca ortam degiskeninin ADINI tasir, degerini DEGIL', () => {
  const istek = impactProvider.programsRequest!({ accountSid: SID });

  assert.deepEqual(istek.credential, {
    kind: 'basic',
    usernameEnv: IMPACT_SID_ENV,
    passwordEnv: IMPACT_TOKEN_ENV,
  });

  // Hazir bir Authorization basligi URETILMEZ: sirrin bu pakete girdigi
  // tek an, girmedigi an olmali.
  assert.equal('headers' in istek, false);
  assert.equal(JSON.stringify(istek).toLowerCase().includes('authorization'), false);
});

test('impact varsayilani XML oldugu icin JSON acikca istenir', () => {
  const istek = impactProvider.catalogsRequest!({ accountSid: SID });
  assert.equal(istek.accept, 'application/json');
});

test('hesap kimligi verilmezse acik hata; sessizce kimliksiz istek kurulmaz', () => {
  assert.throws(
    () => impactProvider.programsRequest!({}),
    (error: unknown) =>
      error instanceof ProviderError && error.code === 'invalid_payload',
  );
});

test('bicimsiz hesap kimligi adrese girmez', () => {
  // Yol ayiriciyi tasiyan bir deger istegi baska bir kaynaga goturebilirdi.
  for (const kotu of ['../../Advertisers/1', 'a/b', 'sid with space']) {
    assert.throws(
      () => impactCampaignsUrl({ accountSid: kotu }),
      (error: unknown) =>
        error instanceof ProviderError && error.code === 'invalid_payload',
    );
  }
});

// ===========================================================================
// ADRES KURMA
// ===========================================================================

test('campaigns adresi resmi bicimde kurulur', () => {
  const url = new URL(impactCampaignsUrl({ accountSid: SID, insertionOrderStatus: 'Active' }));
  assert.equal(url.origin, IMPACT_API_BASE);
  assert.equal(url.pathname, `/Mediapartners/${SID}/Campaigns`);
  assert.equal(url.searchParams.get('InsertionOrderStatus'), 'Active');
});

test('catalog kalem adresi katalog kimligini yola koyar', () => {
  const url = new URL(impactCatalogItemsUrl({ accountSid: SID, catalogId: '4242', page: 2 }));
  assert.equal(url.pathname, `/Mediapartners/${SID}/Catalogs/4242/Items`);
  assert.equal(url.searchParams.get('Page'), '2');
});

test('sayfa boyutu ag tavaninin ustune cikamaz', () => {
  const url = new URL(
    impactCatalogItemsUrl({ accountSid: SID, catalogId: '1', pageSize: 999_999 }),
  );
  assert.equal(url.searchParams.get('PageSize'), String(IMPACT_MAX_PAGE_SIZE));
});

test('actions adresi olay tarihine gore sorar, guncelleme tarihine gore DEGIL', () => {
  const url = new URL(
    impactActionsUrl({
      accountSid: SID,
      startDate: new Date('2026-09-01T00:00:00Z'),
      endDate: new Date('2026-09-20T00:00:00Z'),
    }),
  );
  assert.equal(url.pathname, `/Mediapartners/${SID}/Actions`);
  assert.equal(url.searchParams.get('ActionDateStart'), '2026-09-01T00:00:00Z');
  assert.equal(url.searchParams.get('ActionDateEnd'), '2026-09-20T00:00:00Z');
  // `StartDate` KULLANILMIYOR: o "guncellenenler" sorusudur, baska bir soru.
  assert.equal(url.searchParams.get('StartDate'), null);
});

test('45 gunluk resmi sinir sabit olarak ilan edilmis', () => {
  assert.equal(IMPACT_MAX_RANGE_DAYS, 45);
});

// ===========================================================================
// SAYFALAMA
// ===========================================================================

test('sonraki sayfa agin kendi bildiriminden okunur', () => {
  const url = impactSonrakiSayfaUrl({
    '@nextpageuri': `/Mediapartners/${SID}/Actions?Page=2`,
    '@page': '1',
  });
  assert.equal(url, `${IMPACT_API_BASE}/Mediapartners/${SID}/Actions?Page=2`);
});

test('son sayfada sonraki istek URETILMEZ', () => {
  // Sayaci kendimiz artirsaydik burada bos bir istek daha atar, saatlik
  // kotadan yerdik.
  assert.equal(impactSonrakiSayfaUrl({ '@page': '3', '@numpages': '3' }), null);
  assert.equal(impactSonrakiSayfaUrl(null), null);
});

test('sonraki sayfa BASKA bir hosta cikamaz', () => {
  // Yanit dis veridir; adres olarak kullanilacaksa dogrulanmasi sart.
  assert.equal(
    impactSonrakiSayfaUrl({ '@nextpageuri': 'https://saldirgan.example/Actions' }),
    null,
  );
});

test('sonraki sayfa istegi kimligi ve Accept basligini tasir', () => {
  const ilk = impactProvider.conversionsRequest!({
    accountSid: SID,
    startDate: new Date('2026-09-01T00:00:00Z'),
    endDate: new Date('2026-09-10T00:00:00Z'),
  });

  const sonraki = impactProvider.nextPageRequest!(
    { '@nextpageuri': `/Mediapartners/${SID}/Actions?Page=2` },
    ilk,
  );

  assert.ok(sonraki);
  // Baslik dusseydi ikinci sayfa XML donerdi ve cozumleyici sessizce bos
  // liste verirdi.
  assert.equal(sonraki.accept, 'application/json');
  assert.deepEqual(sonraki.credential, ilk.credential);
});

// ===========================================================================
// PROGRAM KESFI
// ===========================================================================

test('campaign satiri ortak modele cevrilir', () => {
  const program = impactCampaignToProgram({
    CampaignId: '12345',
    CampaignName: 'Ornek Magaza',
    AdvertiserName: 'Ornek AS',
    AdvertiserUrl: 'https://ornek.example',
    ContractStatus: 'Active',
    ShippingRegions: ['DE', 'at', 'ZZZ9'],
    AllowsDeeplinking: 'true',
    TrackingLink: 'https://imp.example.net/c/1/2/3',
  });

  assert.ok(program);
  assert.equal(program.networkProgramId, '12345');
  assert.equal(program.merchantName, 'Ornek Magaza');
  assert.equal(program.homepageUrl, 'https://ornek.example');
  assert.equal(program.status, 'Active');
  assert.equal(program.deeplinkSupported, true);
  assert.equal(program.trackingLink, 'https://imp.example.net/c/1/2/3');
  // Bicimsiz ulke kodu ATILIR; `countries` tablosuna yazilamaz zaten.
  assert.deepEqual(program.countryCodes, ['DE', 'AT']);
});

test('kimliksiz ya da adsiz program onboardinge giremez', () => {
  assert.equal(impactCampaignToProgram({ CampaignName: 'Adsiz kimlik' }), null);
  assert.equal(impactCampaignToProgram({ CampaignId: '9' }), null);
});

test('tek kalem dizi disinda gelse de cozulur', () => {
  const programlar = impactParseCampaigns({
    Campaigns: { CampaignId: '7', CampaignName: 'Tek' },
  });
  assert.equal(programlar.length, 1);
  assert.equal(programlar[0]!.networkProgramId, '7');
});

test('cevrilemeyen program satiri turu dusurmez, yalnizca kendisi duser', () => {
  const programlar = impactParseCampaigns({
    Campaigns: [{ CampaignId: '1', CampaignName: 'Saglam' }, { bozuk: true }],
  });
  assert.equal(programlar.length, 1);
});

// ===========================================================================
// KATALOG
// ===========================================================================

test('katalog kalemi ortak modele cevrilir, tutarlar KURUS', () => {
  const teklif = impactCatalogItemToOffer({
    CatalogItemId: 'SKU-1',
    Name: 'Ornek Urun',
    Description: 'Aciklama',
    Manufacturer: 'Marka',
    Gtin: '05012345678900',
    Mpn: 'MPN-9',
    CurrentPrice: '49.99',
    OriginalPrice: '59.99',
    Currency: 'eur',
    StockAvailability: 'InStock',
    ImageUrl: 'https://ornek.example/a.jpg',
    Url: 'https://ornek.example/urun',
    Category: 'Elektronik',
  });

  assert.ok(teklif);
  // 49.99 * 100 ikilik tabanda 4998.999...; trunc her satirda bir kurus yerdi.
  assert.equal(teklif.priceCents, 4999);
  assert.equal(teklif.compareAtPriceCents, 5999);
  assert.equal(teklif.currency, 'EUR');
  assert.equal(teklif.inStock, true);
  assert.equal(teklif.gtin, '05012345678900');
});

test('fiyatsiz kalem DUSER, sifir fiyatla listelenmez', () => {
  assert.equal(
    impactCatalogItemToOffer({ CatalogItemId: 'x', Name: 'Ad', Currency: 'EUR' }),
    null,
  );
});

test('para birimi okunamayan kalem duser', () => {
  assert.equal(
    impactCatalogItemToOffer({
      CatalogItemId: 'x',
      Name: 'Ad',
      CurrentPrice: '10',
      Currency: 'EURO',
    }),
    null,
  );
});

test('olmayan indirim gosterilmez', () => {
  // OriginalPrice <= CurrentPrice ise ustu cizili fiyat YOK.
  for (const orijinal of ['49.99', '10.00']) {
    const teklif = impactCatalogItemToOffer({
      CatalogItemId: 'x',
      Name: 'Ad',
      CurrentPrice: '49.99',
      OriginalPrice: orijinal,
      Currency: 'EUR',
    });
    assert.equal(teklif?.compareAtPriceCents, null);
  }
});

test('taninmayan stok sozcugu "var" SAYILMAZ', () => {
  const teklif = impactCatalogItemToOffer({
    CatalogItemId: 'x',
    Name: 'Ad',
    CurrentPrice: '1',
    Currency: 'EUR',
    StockAvailability: 'PreOrderOnlyMaybe',
  });
  // null: "bilinmiyor". false ile karistirilmaz, true ile hic.
  assert.equal(teklif?.inStock, null);
});

test('stok bildirilmemisse null kalir', () => {
  const teklif = impactCatalogItemToOffer({
    CatalogItemId: 'x',
    Name: 'Ad',
    CurrentPrice: '1',
    Currency: 'EUR',
  });
  assert.equal(teklif?.inStock, null);
});

test('katalog yaniti cozulur ve bozuk kalemler dusurulur', () => {
  const teklifler = impactParseCatalogItems({
    Items: [
      { CatalogItemId: 'a', Name: 'A', CurrentPrice: '1.00', Currency: 'EUR' },
      { CatalogItemId: 'b', Name: 'B' },
    ],
  });
  assert.equal(teklifler.length, 1);
  assert.equal(teklifler[0]!.externalId, 'a');
});

// ===========================================================================
// DONUSUM
// ===========================================================================

const GECERLI_SUBID = 'aBcD1234_efGH-5678';

test('action satiri ortak modele cevrilir', () => {
  const donusum = impactActionToConversion({
    Id: 'ACT-1',
    CampaignId: '12345',
    State: 'APPROVED',
    Amount: '120.50',
    Payout: '6.02',
    Currency: 'USD',
    EventDate: '2026-09-20T10:30:00Z',
    ReferringDate: '2026-09-19T08:00:00Z',
    SubId1: GECERLI_SUBID,
  });

  assert.ok(donusum);
  assert.equal(donusum.orderId, 'ACT-1');
  assert.equal(donusum.networkMerchantId, '12345');
  assert.equal(donusum.status, 'approved');
  assert.equal(donusum.orderTotalCents, 12_050);
  assert.equal(donusum.commissionCents, 602);
  assert.equal(donusum.currency, 'USD');
  assert.equal(donusum.subid, GECERLI_SUBID);
  assert.equal(donusum.clickedAt, '2026-09-19T08:00:00.000Z');
});

test('REVERSED -> rejected (adlar ayrisiyor, esleme acik yazili)', () => {
  const donusum = impactActionToConversion({
    Id: '1',
    CampaignId: '2',
    State: 'REVERSED',
    Amount: '10',
    Payout: '1',
    Currency: 'USD',
    EventDate: '2026-09-20T10:30:00Z',
  });
  assert.equal(donusum?.status, 'rejected');
});

test('TANINMAYAN durum sessizce pending sayilmaz, satir DUSER', () => {
  assert.equal(
    impactActionToConversion({
      Id: '1',
      CampaignId: '2',
      State: 'SOME_NEW_STATE',
      Amount: '10',
      Payout: '1',
      Currency: 'USD',
      EventDate: '2026-09-20T10:30:00Z',
    }),
    null,
  );
});

test('eksik tutar satiri DUSURUR, sifir yazmaz', () => {
  assert.equal(
    impactActionToConversion({
      Id: '1',
      CampaignId: '2',
      State: 'APPROVED',
      Amount: '10',
      Currency: 'USD',
      EventDate: '2026-09-20T10:30:00Z',
    }),
    null,
  );
});

test('saat dilimi eki olmayan tarih UTC okunur, makinenin saatine gore kaymaz', () => {
  const donusum = impactActionToConversion({
    Id: '1',
    CampaignId: '2',
    State: 'PENDING',
    Amount: '10',
    Payout: '1',
    Currency: 'USD',
    EventDate: '2026-09-20T10:30:00',
  });
  assert.equal(donusum?.occurredAt, '2026-09-20T10:30:00.000Z');
});

test('bizim uretmedigimiz SubId1 atif kurmaz', () => {
  // 16 karakterden kisa, 64'ten uzun ya da izinsiz karakter tasiyan deger
  // bizim `clicks_subid_format` kisitimiza uymaz.
  for (const kotu of ['kisa', 'a'.repeat(65), 'gecerli ama bosluklu 1234']) {
    assert.equal(impactSubId1ToSubid(kotu), null);
  }
  assert.equal(impactSubId1ToSubid(GECERLI_SUBID), GECERLI_SUBID);
});

test('SubId1 hic yoksa donusum yine kaydedilir (atifsiz)', () => {
  const donusum = impactActionToConversion({
    Id: '1',
    CampaignId: '2',
    State: 'PENDING',
    Amount: '10',
    Payout: '1',
    Currency: 'USD',
    EventDate: '2026-09-20T10:30:00Z',
  });
  // Atifsiz bir donusum, yanlis atfedilmis bir donusumden iyidir.
  assert.equal(donusum?.subid, null);
});

test('actions yaniti cozulur ve bozuk satirlar dusurulur', () => {
  const donusumler = impactParseActions({
    Actions: [
      {
        Id: '1',
        CampaignId: '2',
        State: 'APPROVED',
        Amount: '10',
        Payout: '1',
        Currency: 'USD',
        EventDate: '2026-09-20T10:30:00Z',
      },
      { Id: '2' },
    ],
  });
  assert.equal(donusumler.length, 1);
});

// ===========================================================================
// POSTBACK KAPALI
// ===========================================================================

test('impact postback yolu KAPALI kalir ve sebebi acik soyler', () => {
  for (const cagri of [
    () => impactProvider.verifyPostback({ rawBody: '{}', headers: { get: () => null }, secret: 's' }),
    () => impactProvider.normalizePostback({}),
  ]) {
    assert.throws(cagri, (error: unknown) => {
      // "Imza yanlis" ile "bu agda postback kabul etmiyoruz" ayni yanit
      // olmamali.
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, 'verification_unavailable');
      assert.match(error.message, /CEKILIR/);
      return true;
    });
  }
});

// ===========================================================================
// AWIN BOZULMADI
// ===========================================================================

test('awin sozlesme uzerinden de ayni adresi kurar', () => {
  const istek = awinProvider.conversionsRequest!({
    startDate: new Date('2026-09-01T00:00:00Z'),
    endDate: new Date('2026-09-20T00:00:00Z'),
  });

  const url = new URL(istek.url);
  assert.equal(url.origin, 'https://api.awin.com');
  assert.equal(url.searchParams.get('dateType'), 'transaction');
  assert.equal(url.searchParams.get('timezone'), 'UTC');
  assert.deepEqual(istek.credential, { kind: 'bearer', tokenEnv: 'AWIN_API_TOKEN' });
});

test('awin yaniti duz dizidir, zarf beklenmez', () => {
  const donusumler = awinProvider.parsePulledConversions!([
    {
      id: 1,
      advertiserId: 61655,
      commissionStatus: 'approved',
      saleAmount: { amount: 5.59, currency: 'GBP' },
      commissionAmount: { amount: 0.28, currency: 'GBP' },
      transactionDate: '2026-09-20T10:30:00',
    },
  ]);
  assert.equal(donusumler.length, 1);
  assert.equal(donusumler[0]!.orderTotalCents, 559);
});

test('awin sayfalamaz: nextPageRequest bilerek tanimsiz', () => {
  assert.equal(awinProvider.nextPageRequest, undefined);
});
