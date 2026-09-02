'use server';

/**
 * Satıcı belgesi yükleme.
 *
 * DOSYA SUNUCUDAN YÜKLENİR, tarayıcıdan doğrudan değil. Tarayıcıdan
 * yükletseydik istemciye Storage yazma yetkisi vermek gerekirdi; burada
 * dosya oturumlu sunucu istemcisiyle konuyor ve yetki `storage.objects`
 * politikalarında kalıyor.
 *
 * KAYIT DOSYADAN SONRA AÇILIR. Ters sırada yapılsaydı, yükleme başarısız
 * olduğunda ortada dosyası olmayan bir "belge" satırı kalırdı ve yönetici
 * açamadığı bir belgeyi incelemeye çalışırdı.
 */

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

const KOVA = 'satici-belgeleri';

/** Kabul edilen türler: belge okunabilir olmalı, çalıştırılabilir değil. */
const IZINLI_TURLER = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BAYT = 8 * 1024 * 1024;

const BELGE_TURLERI = new Set(['vergi_levhasi', 'imza_sirkuleri', 'kimlik', 'diger']);

export interface DocumentResult {
  ok?: boolean;
  error?: string;
}

export async function uploadVendorDocument(
  _prev: DocumentResult,
  formData: FormData,
): Promise<DocumentResult> {
  const supabase = await createClient();
  if (!supabase) return { error: 'Belge yükleme yalnızca onaylı mağaza hesabında yapılabilir.' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Oturum bulunamadı.' };

  const vendorId = String(formData.get('vendor_id') ?? '').trim();
  const docType = String(formData.get('doc_type') ?? '').trim();
  const file = formData.get('file');

  if (!vendorId || !BELGE_TURLERI.has(docType)) return { error: 'Geçersiz istek.' };
  if (!(file instanceof File) || file.size === 0) return { error: 'Dosya seçin.' };

  if (!IZINLI_TURLER.has(file.type)) {
    return { error: 'Yalnızca PDF, JPEG veya PNG yükleyebilirsiniz.' };
  }
  if (file.size > MAX_BAYT) {
    return { error: 'Dosya 8 MB’tan büyük olamaz.' };
  }

  /*
   * Yol `<kullanıcı kimliği>/...` ile BAŞLAMAK ZORUNDA: `storage.objects`
   * politikası sahipliği yoldan okuyor. Dosya adı da temizleniyor --
   * kullanıcının verdiği ad yola doğrudan girerse ".." ya da eğik çizgiyle
   * başka bir klasöre yazmak mümkün olurdu.
   */
  const uzanti = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin';
  const temizUzanti = /^[a-z0-9]{1,8}$/.test(uzanti) ? uzanti : 'bin';
  const yol = `${user.id}/${docType}-${Date.now()}.${temizUzanti}`;

  const { error: uploadError } = await supabase.storage
    .from(KOVA)
    .upload(yol, file, { contentType: file.type, upsert: false });

  if (uploadError) return { error: 'Dosya yüklenemedi.' };

  const { error } = await supabase.from('vendor_documents').insert({
    vendor_id: vendorId,
    uploaded_by: user.id,
    doc_type: docType,
    storage_path: yol,
    // Görüntülenen ad kullanıcının verdiği addır; yol ondan bağımsız.
    file_name: file.name.slice(0, 255),
  });

  if (error) {
    // Kayıt açılamadıysa dosya da bırakılmaz: sahipsiz dosya, kimsenin
    // göremeyeceği ama yer kaplayan bir artıktır.
    await supabase.storage.from(KOVA).remove([yol]);
    return { error: 'Belge kaydı oluşturulamadı.' };
  }

  revalidatePath('/tasoron/panel/belgeler');
  revalidatePath('/yonetim/belgeler');
  return { ok: true };
}

/** Yöneticinin belgeyi görebilmesi için kısa ömürlü bir bağlantı. */
export async function signedDocumentUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  // 60 saniye: belgeyi açmaya yeter, paylaşılan bir bağlantı olarak
  // yaşamaya yetmez.
  const { data } = await supabase.storage.from(KOVA).createSignedUrl(path, 60);
  return data?.signedUrl ?? null;
}

export async function reviewVendorDocument(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const id = String(formData.get('document_id') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim();
  const note = String(formData.get('review_note') ?? '').trim();

  if (!id || (status !== 'approved' && status !== 'rejected')) return;

  /*
   * Yetki denetimi BURADA YAPILMIYOR ve yapılması da gerekmiyor: karar
   * alanlarını yalnızca yöneticinin değiştirebilmesi veritabanı
   * tetikleyicisinde. Yönetici olmayan biri bu eylemi çağırırsa yazma
   * sessizce geri alınır.
   */
  await supabase
    .from('vendor_documents')
    .update({
      status,
      review_note: note || null,
      reviewed_by: user.id,
    })
    .eq('id', id);

  revalidatePath('/yonetim/belgeler');
  revalidatePath('/tasoron/panel/belgeler');
}
