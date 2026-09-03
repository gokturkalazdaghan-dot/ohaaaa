import type { OhaaaaScore, ScoreComponent } from '@ohaaaa/shared';

/**
 * Ohaaaa Skoru paneli.
 *
 * PANELİN ASIL İŞİ SAYIYI GÖSTERMEK DEĞİL, NEYE DAYANDIĞINI GÖSTERMEK.
 * Bu yüzden ölçülemeyen ölçütler sayının hemen ALTINDA, bir açılır kutunun
 * arkasında değil, düz metin olarak duruyor. "3 ölçütten 2'si" bilgisi
 * gizlenirse sayı olduğundan güçlü görünür.
 *
 * Skor üretilemediğinde panel kaybolmuyor: neden üretilemediğini yazıyor.
 * Sessizce kaybolan bir bölüm, kullanıcıya hiçbir şey söylemez.
 */

const ETIKETLER: Record<string, string> = {
  fiyat_konumu: 'Fiyat konumu',
  toplam_maliyet: 'Kargo dahil toplam',
  satici_degerlendirmesi: 'Satıcı değerlendirmesi',
  teslimat: 'Teslimat süresi',
};

const SEBEPLER: Record<string, string> = {
  yeterli_fiyat_olcumu_yok: 'bu üründe henüz yeterli fiyat ölçümümüz yok',
  fiyat_hic_degismedi: 'ölçtüğümüz sürede fiyat hiç değişmedi',
  karsilastirilacak_teklif_yok: 'karşılaştırılacak başka teklif yok',
  yeterli_degerlendirme_yok: 'satıcının yeterli değerlendirmesi yok',
  ortak_magazanin_puani_bizde_yok: 'ortak mağazanın puanını biz toplamıyoruz',
};

const GUVEN_METNI: Record<OhaaaaScore['confidence'], string> = {
  yuksek: 'Yüksek dayanak',
  orta: 'Orta dayanak',
  dusuk: 'Zayıf dayanak',
  yetersiz: 'Yetersiz veri',
};

function etiket(key: string): string {
  return ETIKETLER[key] ?? key;
}

function sebep(reason: string): string {
  return SEBEPLER[reason] ?? 'ölçemedik';
}

export function OhaaaaScorePanel({ score }: { score: OhaaaaScore }) {
  const olculen = score.components.filter((c): c is Extract<ScoreComponent, { available: true }> =>
    c.available,
  );
  const olculemeyen = score.components.filter(
    (c): c is Extract<ScoreComponent, { available: false }> => !c.available,
  );

  return (
    <section
      aria-labelledby="ohaaaa-skoru-basligi"
      className="mt-6 rounded-2xl border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="ohaaaa-skoru-basligi" className="text-sm font-semibold text-fg">
          Ohaaaa Skoru
        </h2>
        <span className="text-2xs text-subtle">{GUVEN_METNI[score.confidence]}</span>
      </div>

      {score.score !== null ? (
        <>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="tabular text-3xl font-black leading-none text-fg">{score.score}</span>
            <span className="text-sm text-muted">/ {score.maxScore}</span>
          </p>

          {/*
            Sayının kapsamı hemen yanında. "4 ölçütten 3'ü" cümlesi olmadan
            97 ile 97 arasındaki fark görünmez olur.
          */}
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {score.components.length} ölçütten{' '}
            <strong className="text-fg">{olculen.length} tanesi</strong> değerlendirildi
            {olculemeyen.length > 0 && <> — kalanı ölçemedik, aşağıda yazıyor</>}. Skor yalnızca
            ölçebildiğimiz ölçütler üzerinden hesaplanır.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          <strong className="text-fg">Bu teklif için skor üretemedik.</strong> Ölçütlerin çoğunu
          ölçemediğimizde sayı vermiyoruz; eksik veriyle üretilen bir skor, olmayan bir bilgiyi
          varmış gibi gösterir.
        </p>
      )}

      <ul className="mt-4 space-y-2 text-xs">
        {olculen.map((component) => (
          <li key={component.key} className="flex items-baseline justify-between gap-3">
            <span className="text-muted">
              {etiket(component.key)}
              {/* Beyan ile ölçüm ayrımı kullanıcının görebileceği yerde. */}
              {component.source === 'beyan' && (
                <span className="ml-1.5 text-subtle">(mağaza beyanı)</span>
              )}
            </span>
            <span className="tabular shrink-0 font-semibold text-fg">
              {Math.round(component.points)} / {component.weight}
            </span>
          </li>
        ))}

        {olculemeyen.map((component) => (
          <li key={component.key} className="flex items-baseline justify-between gap-3">
            <span className="text-subtle">{etiket(component.key)}</span>
            <span className="shrink-0 text-right text-subtle">
              Veri yok — {sebep(component.reason)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
