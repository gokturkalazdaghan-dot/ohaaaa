'use server';

/**
 * Kimlik doğrulama sunucu eylemleri (Server Actions).
 *
 * NEDEN SUNUCU EYLEMİ: Oturum çerezleri `HttpOnly` olmalıdır — JavaScript
 * tarafından okunamayan çerez, XSS ile jeton çalınmasını engeller. Bu ancak
 * sunucuda yazılabilir. İstemciden `supabase.auth.signIn` çağırmak da çalışır
 * ama jetonu tarayıcı depolamasına koyar ve o korumayı kaybettirir.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { tuketButce } from '@/lib/rateBudget';
import { hashWithDailySalt } from '@/lib/clientHash';

/**
 * HIZ SINIRI — kaba kuvvet ve credential stuffing kapısı.
 *
 * Giriş eylemi kullanıcı numaralandırmaya karşı zaten korumalıydı ("E-posta
 * veya parola hatalı" — hangisinin yanlış olduğunu söylemiyor). Ama deneme
 * SAYISI sınırsızdı: bir sözlük saldırısı için tek gereken zamandı.
 *
 * İKİ AYRI KOVA SAYILIYOR ve ikisi farklı saldırıyı durduruyor:
 *
 *   IP kovası     — tek kaynaktan yapılan sözlük saldırısı
 *   E-POSTA kovası — çok sayıda IP'den TEK hesaba yapılan saldırı
 *                    (dağıtık kaba kuvvet; IP sınırı bunu hiç görmez)
 *
 * E-posta HAM SAKLANMAZ: günlük tuzlanmış özeti kova anahtarı olur. Böylece
 * sayaç tablosu, hangi adreslerin denendiğinin listesine dönüşmez.
 *
 * SINIR AŞILINCA MESAJ AYNI KALMIYOR ama hesap varlığını da ele vermiyor:
 * "çok fazla deneme" demek, hangi hesabın var olduğunu söylemez.
 */
async function girisDenemesiSayilabilir(
  email: string,
): Promise<{ izin: boolean; mesaj?: string }> {
  const { headers } = await import('next/headers');
  const istekBasliklari = new Headers(await headers());

  const ip = await tuketButce('giris', istekBasliklari);
  if (!ip.izin) {
    return {
      izin: false,
      mesaj:
        ip.sebep === 'olculemedi'
          ? 'Giriş şu an yapılamıyor. Lütfen biraz sonra tekrar deneyin.'
          : 'Çok fazla giriş denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin.',
    };
  }

  /*
   * Hesap bazlı kova. `tuketButce` kova anahtarını IP'den kuruyor; burada
   * e-posta özetini sahte bir başlık olarak geçiriyoruz ki aynı sayaç
   * mekanizması ikinci boyut için de kullanılsın.
   */
  const eposta = new Headers();
  eposta.set('x-forwarded-for', `eposta:${hashWithDailySalt(email.toLowerCase())}`);

  const hesap = await tuketButce('giris', eposta);
  if (!hesap.izin) {
    return {
      izin: false,
      mesaj: 'Bu hesap için çok fazla deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.',
    };
  }

  return { izin: true };
}

export interface AuthResult {
  error?: string;
  /** Kayıt sonrası e-posta doğrulaması bekleniyorsa. */
  pendingConfirmation?: boolean;
}

const credentialsSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi girin'),
  password: z.string().min(8, 'Parola en az 8 karakter olmalı').max(200),
});

const signUpSchema = credentialsSchema.extend({
  fullName: z.string().min(2, 'Ad soyad girin').max(120),
});

export async function signIn(_prev: AuthResult, formData: FormData): Promise<AuthResult> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Bilgiler doğrulanamadı.' };
  }

  // Sayım, parola kontrolünden ÖNCE: reddedilecek bir denemeyi kimlik
  // sağlayıcısına göndermenin anlamı yok ve gönderirsek sınır sızdırır.
  const kapi = await girisDenemesiSayilabilir(parsed.data.email);
  if (!kapi.izin) return { error: kapi.mesaj };

  const supabase = await createClient();
  if (!supabase) return { error: 'Kimlik doğrulama yapılandırılmamış (demo modu).' };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    /*
     * Hata mesajı BİLEREK belirsizdir. "Bu e-posta kayıtlı değil" demek,
     * saldırganın hangi adreslerin sistemde olduğunu tek tek denemesine
     * izin verir (kullanıcı numaralandırma / user enumeration).
     */
    return { error: 'E-posta veya parola hatalı.' };
  }

  const next = String(formData.get('next') ?? '/tasoron/panel');

  // Açık yönlendirme koruması: yalnızca site içi yollar kabul edilir.
  // "//kotu-site.com" da geçerli bir dış adrestir, bu yüzden çift eğik
  // çizgi ayrıca elenir.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/tasoron/panel';

  revalidatePath('/', 'layout');
  redirect(safeNext);
}

export async function signUp(_prev: AuthResult, formData: FormData): Promise<AuthResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Bilgiler doğrulanamadı.' };
  }

  /*
   * Kayıt hız sınırı.
   *
   * Kayıt, girişten daha pahalı: her deneme bir DOĞRULAMA E-POSTASI
   * tetikler. Sınırsız bırakılırsa site, kendi alan adından üçüncü kişilere
   * spam gönderen bir araca dönüşür ve gönderim itibarı yanar.
   */
  {
    const { headers } = await import('next/headers');
    const butce = await tuketButce('kayit', new Headers(await headers()));
    if (!butce.izin) {
      return {
        error:
          butce.sebep === 'olculemedi'
            ? 'Kayıt şu an yapılamıyor. Lütfen biraz sonra tekrar deneyin.'
            : 'Çok fazla kayıt denemesi yapıldı. Lütfen bir süre sonra tekrar deneyin.',
      };
    }
  }

  const supabase = await createClient();
  if (!supabase) return { error: 'Kimlik doğrulama yapılandırılmamış (demo modu).' };

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // `users` tablosundaki profil, on_auth_user_created trigger'ı
      // tarafından bu veriden doldurulur.
      data: { full_name: parsed.data.fullName },
    },
  });

  if (error) {
    return { error: 'Kayıt tamamlanamadı. Bu adres zaten kayıtlı olabilir.' };
  }

  // E-posta doğrulaması açıksa oturum HENÜZ yoktur.
  if (!data.session) {
    return { pendingConfirmation: true };
  }

  revalidatePath('/', 'layout');
  redirect('/tasoron/panel');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/');
}
