#!/usr/bin/env node
/**
 * IMPACT ANAHTAR YOKLAMASI — eklenen API anahtarı gerçekten çalışıyor mu?
 *
 * ÇÖZDÜĞÜ SORUN
 * Impact panelinde "Ohaaaa-Production-API" adıyla bir anahtar açıldı. Panel
 * anahtarı ADIYLA listeler; adın görünmesi anahtarın doğru hesaba bağlı ve
 * okuma yetkili olduğunu KANITLAMAZ. Bu betik tek bir salt-okur çağrı yapar
 * ve cevabı ölçer.
 *
 * Impact kimlik doğrulaması iki parçalı: Account SID (kullanıcı adı) +
 * Auth Token (parola), HTTP Basic. Anahtarın ADI isteğe hiç girmez.
 *
 * DEPO PUBLIC — GÜNLÜĞE VERİ YAZILMAZ
 * Günlüğe yalnızca HTTP durumu ve SAYILAR düşer. Kampanya/reklamveren
 * adları yazılmaz. `awin-feed-probe.mjs` ile aynı kural.
 *
 * KULLANIM
 *   IMPACT_ACCOUNT_SID=... IMPACT_AUTH_TOKEN=... node scripts/impact-probe.mjs
 */

export const IMPACT_API_BASE = 'https://api.impact.com';

/** Salt-okur, yan etkisiz uç nokta: yayıncının katıldığı kampanyalar. */
export function campaignsUrl(accountSid) {
  return `${IMPACT_API_BASE}/Mediapartners/${encodeURIComponent(accountSid)}/Campaigns?PageSize=100`;
}

export function basicAuth(accountSid, authToken) {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

/**
 * Cevabı yalnızca SAYILARA indirger. İsim alanları bilerek dışarıda.
 * Impact sayfalı listelerde toplamı `@total` alanında verir.
 */
export function summarize(status, body) {
  if (status === 401 || status === 403) {
    return { ok: false, status, reason: 'yetki reddedildi (SID/Token eşleşmiyor ya da yetkisiz)' };
  }
  if (status !== 200 || !body || typeof body !== 'object') {
    return { ok: false, status, reason: 'beklenmeyen cevap' };
  }
  const list = Array.isArray(body.Campaigns) ? body.Campaigns : [];
  const total = Number.parseInt(body['@total'] ?? String(list.length), 10);
  return {
    ok: true,
    status,
    campaigns_total: Number.isFinite(total) ? total : list.length,
    campaigns_on_page: list.length,
  };
}

async function main() {
  const sid = process.env.IMPACT_ACCOUNT_SID?.trim();
  const token = process.env.IMPACT_AUTH_TOKEN?.trim();
  if (!sid || !token) {
    console.error('IMPACT_ACCOUNT_SID ve IMPACT_AUTH_TOKEN gizlileri tanımlı değil.');
    process.exitCode = 1;
    return;
  }

  const res = await fetch(campaignsUrl(sid), {
    headers: {
      Authorization: basicAuth(sid, token),
      Accept: 'application/json',
      'User-Agent': process.env.OHAAAA_USER_AGENT ?? 'OhaaaaBot/1.0',
    },
    signal: AbortSignal.timeout(30_000),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Gövde JSON değilse özet "beklenmeyen cevap" der; gövde günlüğe yazılmaz.
  }

  const ozet = summarize(res.status, body);
  console.log(JSON.stringify(ozet));
  if (!ozet.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Yoklama düştü: ${err?.name ?? 'Error'}`);
    process.exitCode = 1;
  });
}
