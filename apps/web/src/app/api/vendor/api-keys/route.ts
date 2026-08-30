/**
 * POST /api/vendor/api-keys — yeni taşeron API anahtarı üretir.
 *
 * Anahtar SUNUCUDA üretilir ve ham hâli yanıtta YALNIZCA BİR KEZ döner.
 * Veritabanına sadece SHA-256 özeti yazılır; kaybedilen anahtar kurtarılamaz,
 * yenisi üretilir. Bu, anahtar sızıntısının etkisini sınırlayan standart
 * yaklaşımdır (GitHub, Stripe ve Supabase aynı modeli kullanır).
 */

import { NextResponse } from 'next/server';

import { createApiKeySchema } from '@ohaaaa/shared';
import { generateApiKey } from '@ohaaaa/shared/api-key';

import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Geçersiz JSON gövdesi.' } },
      { status: 400 },
    );
  }

  const parsed = createApiKeySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Anahtar bilgileri doğrulanamadı.',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 422 },
    );
  }

  const input = parsed.data;
  const generated = generateApiKey(input.environment);

  const expiresAt = input.expires_in_days
    ? new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString()
    : null;

  const supabase = await createClient();

  // ---- Demo modu: üret, kalıcı yazma yapma ---------------------------------
  if (!supabase) {
    return NextResponse.json({
      data: {
        id: crypto.randomUUID(),
        name: input.name,
        environment: input.environment,
        key_prefix: generated.prefix,
        last_four: generated.lastFour,
        scopes: input.scopes,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
        // Yalnızca bu yanıtta görünür.
        plaintext: generated.plaintext,
        demo: true,
      },
    });
  }

  // ---- Canlı mod -----------------------------------------------------------
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Oturum açmanız gerekiyor.' } },
      { status: 401 },
    );
  }

  // Kullanıcının sahibi olduğu taşeron. RLS zaten başkasının kaydını
  // döndürmez; yine de sonucu açıkça kontrol ediyoruz.
  const { data: vendor } = await supabase
    .from('vendors')
    .select('id, status')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!vendor) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Hesabınıza bağlı bir taşeron kaydı yok.' } },
      { status: 403 },
    );
  }

  if (vendor.status !== 'approved') {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Başvurunuz onaylanmadan API anahtarı oluşturamazsınız.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      vendor_id: vendor.id,
      name: input.name,
      environment: input.environment,
      key_prefix: generated.prefix,
      key_hash: generated.hash,
      last_four: generated.lastFour,
      scopes: input.scopes,
      created_by: user.id,
      expires_at: expiresAt,
    })
    .select('id, name, environment, key_prefix, last_four, scopes, expires_at, created_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Anahtar oluşturulamadı.' } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: { ...data, plaintext: generated.plaintext, demo: false },
  });
}
