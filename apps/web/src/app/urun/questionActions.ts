'use server';

/**
 * Ürün sorusu gönderimi ve cevaplama.
 *
 * Yazma OTURUMLA yapılır. Kimin cevaplayabileceği kuralı veritabanında
 * (`can_answer_question` + `tg_questions_guard`): o ürün grubunda onaylı
 * mağazası olan satıcı ya da yönetici. Servis anahtarı kullansaydık,
 * buradaki bir mantık hatası herkesin "satıcı ağzından" konuşabilmesi
 * demek olurdu.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

const askSchema = z.object({
  group_id: z.string().uuid(),
  slug: z.string().trim().min(1).max(200),
  body: z
    .string()
    .trim()
    .min(10, 'Soru en az 10 karakter olmalı')
    .max(500, 'Soru en fazla 500 karakter olabilir'),
});

const answerSchema = z.object({
  question_id: z.string().uuid(),
  slug: z.string().trim().min(1).max(200),
  vendor_id: z.string().uuid(),
  answer: z
    .string()
    .trim()
    .min(2, 'Cevap en az 2 karakter olmalı')
    .max(2000, 'Cevap en fazla 2000 karakter olabilir'),
});

export interface QuestionResult {
  ok?: boolean;
  /*
   * Başarılı her gönderim FARKLI bir damga taşır.
   *
   * Arayüz soru kutusunu bu damgayı `key` olarak vererek sıfırlıyor. `ok`
   * tek başına yetmezdi: ikinci gönderimde değeri yine `true` olur, `key`
   * değişmez ve kutu dolu kalırdı -- kullanıcı da sorusunun gitmediğini
   * sanıp aynı soruyu ikinci kez sorardı.
   */
  stamp?: number;
  error?: string;
  fieldErrors?: Record<string, string>;
  needsAuth?: boolean;
}

export async function askQuestion(
  _prev: QuestionResult,
  formData: FormData,
): Promise<QuestionResult> {
  const supabase = await createClient();
  if (!supabase) return { error: 'Soru şu an alınamıyor.' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needsAuth: true };

  const parsed = askSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const { error } = await supabase.from('product_questions').insert({
    group_id: parsed.data.group_id,
    user_id: user.id,
    body: parsed.data.body,
  });

  if (error) return { error: 'Soru kaydedilemedi.' };

  revalidatePath(`/urun/${parsed.data.slug}`);
  return { ok: true, stamp: Date.now() };
}

export async function answerQuestion(
  _prev: QuestionResult,
  formData: FormData,
): Promise<QuestionResult> {
  const supabase = await createClient();
  if (!supabase) return { error: 'Cevap şu an kaydedilemiyor.' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needsAuth: true };

  const parsed = answerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const { error } = await supabase
    .from('product_questions')
    .update({
      answer: parsed.data.answer,
      answered_by: user.id,
      answer_vendor_id: parsed.data.vendor_id,
    })
    .eq('id', parsed.data.question_id);

  if (error) return { error: 'Cevap kaydedilemedi.' };

  /*
   * Yetkisiz bir kullanıcı da buraya kadar gelebilir: satır RLS'e göre
   * güncellenebilir (kendi sorusu olabilir) ama cevap alanları tetikleyici
   * tarafından geri alınır. Bu durumda hata DÖNMEZ, çünkü yazma başarısız
   * olmadı; okuyup gerçekten yazıldığını doğruluyoruz ki kullanıcı
   * "kaydedildi" yazısına aldanmasın.
   */
  const { data: check } = await supabase
    .from('product_questions')
    .select('answer')
    .eq('id', parsed.data.question_id)
    .maybeSingle();

  if (!check?.answer) {
    return { error: 'Bu soruyu cevaplama yetkiniz yok.' };
  }

  revalidatePath(`/urun/${parsed.data.slug}`);
  return { ok: true };
}
