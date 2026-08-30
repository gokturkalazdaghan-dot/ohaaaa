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
