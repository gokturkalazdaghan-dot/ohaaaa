/**
 * Kargo firmaları listesi.
 *
 * Liste VERİTABANINDAN okunur, kodda sabit tutulmaz: takip numarası biçim
 * denetimi (`carriers.number_pattern`) de aynı satırda yaşıyor. İki yerde
 * ayrı listeler olsaydı, arayüzde seçilebilen ama veritabanının tanımadığı
 * bir firma çıkardı ve satıcı, kabul edilen bir formdan sonra anlaşılmaz bir
 * hata alırdı.
 *
 * Okuma anonim rolle yapılabilir: `carriers_read` politikası herkese açık,
 * çünkü firma adları ve numara biçimleri gizli bilgi değil.
 */

import { createClient } from '@/lib/supabase/server';

export interface CarrierOption {
  code: string;
  name: string;
}

export async function getCarriers(): Promise<CarrierOption[]> {
  const supabase = await createClient();

  // Demo modu: veritabanı hiç yok. Ekranın gerçeğinden sapmaması için aynı
  // kodlar gösterilir; bu satırlar hiçbir siparişi ilerletmez.
  if (!supabase) return DEMO_CARRIERS;

  const { data, error } = await supabase
    .from('carriers')
    .select('code, name')
    .eq('is_active', true)
    .order('name');

  /*
   * Canlı modda okuma başarısızsa BOŞ liste döner, yedek bir kopya değil.
   * Elde olmayan bir listeyi uydurmak şu demek olurdu: satıcı bir firma
   * seçer, form gider, veritabanı o kodu tanımaz ve hata seçimden çok sonra
   * ortaya çıkar. Boş listede ise durum baştan bellidir.
   */
  if (error || !data) return [];

  return data.map((row) => ({ code: String(row.code), name: String(row.name) }));
}

const DEMO_CARRIERS: CarrierOption[] = [
  { code: 'aras', name: 'Aras Kargo' },
  { code: 'mng', name: 'MNG Kargo' },
  { code: 'ptt', name: 'PTT Kargo' },
  { code: 'surat', name: 'Sürat Kargo' },
  { code: 'yurtici', name: 'Yurtiçi Kargo' },
  { code: 'diger', name: 'Diğer' },
];
