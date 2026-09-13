/**
 * GEZİNME LİSTELEMESİNİN SIRALAMA KURALLARI.
 *
 * NEDEN BU DOSYA VAR
 * `search_products` RPC'si sıralamayı şu biçimde yazıyor:
 *
 *   order by
 *     case when p_sort = 'price_asc'  then m.min_price_cents end asc  nulls last,
 *     case when p_sort = 'price_desc' then m.min_price_cents end desc nulls last,
 *     case when p_sort = 'offers'     then m.offer_count     end desc nulls last,
 *     case when p_sort = 'relevance'  then m.relevance       end desc nulls last,
 *     m.title asc
 *
 * Bu ifade ÇALIŞMA ANINDAKİ BİR PARAMETREYE bağlı. PostgreSQL böyle bir
 * sıralamayı HİÇBİR indeksle karşılayamaz -- `p_sort` ne olursa olsun.
 * Sonuç: her listeleme, filtreye uyan BÜTÜN satırları okuyup belleğe alıp
 * sıralamak zorunda; `limit 24` ancak sıralama bittikten sonra devreye
 * giriyor. Üretimde ölçüldü (anon, kulaklık kategorisi, 541 satır):
 *
 *   sıralama YOK,  limit 24  →      0,185 ms  (24 satır okundu, tarama durdu)
 *   sıralama VAR,  limit 24  →  2.762,8  ms  (541 satırın tamamı okundu)
 *
 * 32.845 satırlık `bilgisayar` kategorisinde aynı sorgu anon rolünün 3 sn
 * `statement_timeout` sınırını aşıyor ve sayfa HTTP 500 / 57014 dönüyor.
 *
 * Buradaki dönüşüm, sıralamayı DÜZ SÜTUNLARA çevirir; yani bir indeksin
 * karşılayabileceği bir biçime. İndeksin kendisi ayrı bir karardır --
 * bu modül onu gerektirmez, yalnızca MÜMKÜN kılar.
 */

/** Listeleme sıralaması seçenekleri (`SortOption` ile aynı küme). */
export type ListelemeSiralamaSecenegi = 'relevance' | 'price_asc' | 'price_desc' | 'offers';

/** Sıralanabilir `product_groups` sütunları. */
export type SiralamaSutunu = 'offer_count' | 'min_price_cents' | 'title';

/** Tek bir sıralama anahtarı. */
export interface SiralamaAnahtari {
  sutun: SiralamaSutunu;
  artan: boolean;
}

/**
 * Bir sıralama seçeneğini düz sütun anahtarlarına çevirir.
 *
 * RPC'nin davranışıyla BİREBİR aynı olmalı; aradaki her fark kullanıcıya
 * sayfa sayfa gezinirken tekrar eden ya da atlanan ürün olarak yansır:
 *
 *   • Dört `case` teriminin üçü, seçili olmayan sıralamalarda her satır için
 *     `null` üretir. Sabit `null` sütunu sıralamayı DEĞİŞTİRMEZ; yani
 *     etkin sıralama yalnızca seçili terim + `title asc`'tir.
 *   • `relevance`, serbest metin YOKKEN her satır için sabit `1.0` döner
 *     (fonksiyonun `case when pr.q is null then 1.0` dalı). Sabit değer de
 *     sıralamayı değiştirmez, geriye yalnızca `title asc` kalır.
 *   • Dört terimin dördünde de `nulls last` YAZILI. PostgreSQL'in varsayılanı
 *     `desc` için `nulls first` olduğundan bu, azalan sıralamalarda açıkça
 *     belirtilmesi ZORUNLU bir fark.
 *
 * `title` her zaman son anahtardır: eşit değerli satırların sırası aksi
 * hâlde belirsiz kalır ve sayfalama tutarsızlaşır.
 */
export function listelemeSiralamasi(
  sort: ListelemeSiralamaSecenegi,
): SiralamaAnahtari[] {
  switch (sort) {
    case 'price_asc':
      return [{ sutun: 'min_price_cents', artan: true }, { sutun: 'title', artan: true }];
    case 'price_desc':
      return [{ sutun: 'min_price_cents', artan: false }, { sutun: 'title', artan: true }];
    case 'offers':
      return [{ sutun: 'offer_count', artan: false }, { sutun: 'title', artan: true }];
    case 'relevance':
    default:
      return [{ sutun: 'title', artan: true }];
  }
}

/** `rpcsiz` kararının baktığı alanlar. */
export interface ListelemeAdayi {
  query?: string;
  brands?: string[];
  freeShipping?: boolean;
}

/**
 * Bu istek RPC'siz karşılanabilir Mİ?
 *
 * SADECE anlamı BİREBİR korunabilen durumlarda `true`. Korunamayan üç durum
 * RPC'de kalır -- yavaş kalmaları, yanlış sonuç vermelerinden iyidir:
 *
 *   1) SERBEST METİN. `relevance` puanı `ts_rank` + `similarity` +
 *      `word_similarity` bileşimi; PostgREST ile üretilemez.
 *   2) MARKA FİLTRESİ. SQL `lower(g.brand) = any(...)` diyor, yani büyük/
 *      küçük harf duyarsız. PostgREST `in.(...)` duyarlıdır; "Apple" seçili
 *      iken "APPLE" markalı ürünler sessizce kaybolurdu.
 *   3) ÜCRETSİZ KARGO. `exists (select 1 from products ...)` bir alt sorgu;
 *      PostgREST'te gömülü kaynak filtresiyle karşılığı yok.
 */
export function rpcsizListelenebilir(params: ListelemeAdayi): boolean {
  if (params.query !== undefined && params.query.trim().length > 0) return false;
  if (params.brands !== undefined && params.brands.length > 0) return false;
  if (params.freeShipping === true) return false;
  return true;
}
