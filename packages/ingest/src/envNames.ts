/**
 * Bir sırrın OKUNACAĞI DEĞİŞKEN ADININ çözümlenmesi.
 *
 * NEDEN VAR
 * Aynı sır, ortama farklı adlarla enjekte ediliyor. Bu bir varsayım değil,
 * İKİ KEZ ÖLÇÜLDÜ:
 *
 *   Awin kimlik bilgisi   panoda `AWIN_OAUTH2`, ortamda `awin_OAuth2`
 *   Supabase servis rolü  kodda `SUPABASE_SERVICE_ROLE_KEY`,
 *                         hesap sahibinin eklediği ad `my_supabase_role_key`
 *
 * Tek ada kilitlenen bir okuyucu, sır ORTAMDA DURURKEN "tanımlı değil" der --
 * ve o hata, sırrın hiç eklenmemiş olmasıyla BİREBİR aynı görünür. İki durum
 * ayırt edilemeyince yanlış yerde aranır: ilkinde tam olarak bu oldu.
 *
 * LİSTEYE TAHMİNLE AD EKLENMEZ. Buradaki her ad ya kodun kendi sözleşmesidir
 * ya da o adla enjekte edildiği GÖRÜLMÜŞTÜR. "Belki şöyle de denir" tahminleri
 * listeyi çöplüğe çevirir ve hangi adın gerçekten gözlemlendiğini kaybettirir.
 */

/** Adı ÇÖZER; değeri döndürmez. Bulunamazsa null. */
export function resolveEnvName(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const ad of names) {
    const deger = env[ad];
    if (typeof deger === 'string' && deger.trim().length > 0) return ad;
  }
  return null;
}

/** Değeri okur; hiçbir adla bulunamazsa null. */
export function readEnvValue(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const ad = resolveEnvName(names, env);
  return ad === null ? null : env[ad]!.trim();
}

/**
 * Supabase servis rolü anahtarı.
 *
 * İlk ad kodun sözleşmesi ve `.env.example`da yazan addır; ikincisi hesap
 * sahibinin gerçekten eklediği ad.
 */
export const SUPABASE_SERVICE_KEY_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'my_supabase_role_key',
] as const;

/** Supabase proje adresi. */
export const SUPABASE_URL_ENV_NAMES = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'] as const;
