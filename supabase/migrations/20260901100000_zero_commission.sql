-- ============================================================================
-- SIFIR KOMİSYON — kod, iş modeliyle aynı şeyi söylesin
-- ----------------------------------------------------------------------------
-- BULUNAN ÇELİŞKİ
-- `vendors.commission_rate` varsayılanı 0.0800 idi ve `create_order()` her
-- sipariş satırında bu oranı uygulayıp `commission_cents` yazıyordu. Yani
-- kod satıcıdan %8 kesiyordu.
--
-- Oysa platformun satıcıya verdiği söz SIFIR KOMİSYON; sitenin var olma
-- sebebi bu. İki taraf ayrışmış hâlde: satıcı sayfası "listeleme ücretsiz,
-- komisyon yok" diyor, veritabanı %8 hesaplıyordu.
--
-- Bu ayrışma sessizdi ve pahalıydı: ilk gerçek sipariş geldiğinde satıcının
-- hakedişi beklediğinden %8 eksik çıkacak, sözleşmeye aykırı bir kesinti
-- yapılmış olacaktı.
--
-- SÜTUN KALDIRILMIYOR, SIFIRLANIYOR
-- `commission_rate` yapısı duruyor çünkü ORTAK MAĞAZA (affiliate) tarafında
-- komisyon gerçekten var ve ileride satıcıya özel bir anlaşma yapılması da
-- mümkün. Kaldırmak, var olan bir iş gerçeğini şemadan silmek olurdu.
-- Değişen yalnızca VARSAYILAN: yeni satıcı sıfırla açılır ve aksi ancak
-- açıkça yazılırsa olur.
-- ============================================================================

alter table public.vendors
  alter column commission_rate set default 0;

comment on column public.vendors.commission_rate is
  'Platformun saticidan aldigi komisyon orani. VARSAYILAN 0: is modeli sifir '
  'komisyon uzerine kurulu. Sifirdan farkli bir deger ancak o saticiyla '
  'yapilmis acik bir anlasmayla yazilir.';

-- Mevcut satırlar da hizalanır: varsayılanı değiştirmek eski satırlara
-- dokunmaz ve %8'i taşımaya devam ederlerdi.
update public.vendors set commission_rate = 0 where commission_rate = 0.0800;
