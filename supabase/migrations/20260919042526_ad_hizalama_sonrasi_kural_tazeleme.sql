-- Ad hizalamasi yeni kanonik adlar uretti ("Anne Urunleri", "Kisisel Bakim
-- Urunleri", "Bebek Giyim", "Emzirme Urunleri", "Seks Oyuncaklari &
-- Yetiskin Urunleri"). Esleme kurallari KATALOG ADLARINDAN turetildigi
-- icin, adlar degisince turetme yeniden kosmali.
--
-- Kosmasaydi: bir kaynak "Anne Urunleri" yazdiginda hicbir kurala dusmez
-- ve urun siniflandirilmamis kalirdi. Yani ad hizalamasi, eslemeyi
-- SESSIZCE eksik birakirdi.
--
-- Ayri bir goc olmasinin sebebi: tazeleme uretimde elle cagrildi ve
-- depoda karsiligi yoktu. Temiz bir veritabanina gocler sirayla
-- uygulandiginda 5 kural eksik kalirdi -- uretimle depo arasinda sessiz
-- bir ayrisma. Bu goc o ayrismayi kapatiyor.
--
-- Idempotent: `on conflict do nothing` sayesinde uretimde 0 satir ekler
-- (zaten var), temiz replay'de 5 ekler.
do $$
declare n integer;
begin
  select public.kategori_ad_kurallarini_tazele() into n;
  raise notice 'ad hizalamasi sonrasi turetilen kural: %', n;
end $$;