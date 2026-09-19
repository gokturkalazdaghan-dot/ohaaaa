-- ============================================================================
-- ARTIK TABLO: "Ohaaaa.com"
-- ============================================================================
-- Supabase Studio'dan elle acilmis, hic kullanilmamis bir tablo: varsayilan
-- `id` + `created_at` ikilisi, baska sutun yok. Hicbir gocte tanimli degil,
-- bu yuzden depoda da karsiligi yoktu.
--
-- SILMEDEN ONCE OLCULDU, TAHMIN EDILMEDI:
--   satir sayisi        0
--   ona bakan yabanci anahtar  0
--   kendi yabanci anahtari     0
--   bagimli view               0
--   RLS politikasi             0
-- Yani kaybolacak veri ve kirilacak bag YOK.
--
-- NEDEN SILINIYOR
-- public semasinda duran, adi bir alan adina benzeyen, hicbir sey tarafindan
-- kullanilmayan bir tablo su isi goruyor: semayi okuyan herkesin "bu ne?"
-- diye durup bakmasini saglamak. Uc kez bakildi, uc kez ayni cevap cikti.
-- Bundan sonrakiler icin de ayni maliyeti birakmaya gerek yok.
--
-- Tersi de dusunuldu: kalsin, zararsiz. Ama zararsizligi ancak OLCEREK
-- anlasiliyor ve o olcum her defasinda yeniden yapiliyor. Bos bir tablonun
-- bedeli, sakladigi veri degil; yarattigi supheden.
--
-- GERI ALINABILIR: icinde veri yok, ayni tanimla yeniden olusturulabilir.
-- ============================================================================
do $$
declare
  v_satir int;
begin
  -- Tablo yoksa (temiz replay) yapacak bir sey yok.
  if to_regclass('public."Ohaaaa.com"') is null then
    raise notice 'artik tablo zaten yok';
    return;
  end if;

  execute 'select count(*) from public."Ohaaaa.com"' into v_satir;

  /*
   * BOS OLMAYAN BIR TABLOYU BU GOC SILMEZ.
   * Bir satir bile varsa, o satirin ne oldugunu bilmeden silmek veri
   * kaybidir. O durumda goc DUSER ve kararı insana birakir.
   */
  if v_satir <> 0 then
    raise exception
      'Artik sanilan tabloda % satir var -- silinmedi. Icerigi incelenmeden kaldirilamaz.',
      v_satir;
  end if;

  drop table public."Ohaaaa.com";
  raise notice 'artik tablo kaldirildi (0 satir, 0 bagimlilik)';
end $$;