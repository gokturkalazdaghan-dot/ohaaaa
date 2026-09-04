'use client';

import { useState } from 'react';

import { API_SCOPES, type ApiScope } from '@ohaaaa/shared';

import { AlertIcon, CheckIcon, CopyIcon, KeyIcon, TrashIcon } from './Icons';
import { apiBaseUrl } from '@/lib/env';

export interface ApiKeyRow {
  id: string;
  name: string;
  environment: 'live' | 'test';
  key_prefix: string;
  last_four: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  lastUsedAt: string | null;
  requestCount: number;
}

const SCOPE_LABELS: Record<ApiScope, string> = {
  'products:read': 'Ürünleri okuma',
  'products:write': 'Ürün ekleme ve güncelleme',
  'orders:read': 'Siparişleri okuma',
  'orders:write': 'Sipariş durumu güncelleme',
};

/*
 * SAHTE ANAHTAR YOK.
 *
 * Burada `INITIAL_KEYS` adında iki UYDURMA anahtar duruyordu -- "Üretim —
 * ERP senkronu", 184.209 istek, gerçekçi bir önek. Panele giren satıcı,
 * hiç oluşturmadığı iki anahtarı KENDİ anahtarı sanıyordu. Sahte kullanım
 * sayısı ayrıca "bu entegrasyon çalışıyor" izlenimi veriyordu.
 *
 * Liste artık sunucudan, o satıcının GERÇEK anahtarlarıyla geliyor; hiç
 * anahtar yoksa boş durum gösterilir. Boş bir liste, uydurma bir listeden
 * iyidir.
 */

export function ApiKeyManager({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const [keys, setKeys] = useState<ApiKeyRow[]>(initialKeys);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Yeni üretilen ham anahtar — yalnızca bir kez gösterilir. */
  const [revealed, setRevealed] = useState<{ name: string; plaintext: string } | null>(null);

  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<'live' | 'test'>('live');
  const [scopes, setScopes] = useState<ApiScope[]>([
    'products:read',
    'products:write',
    'orders:read',
  ]);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/vendor/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, environment, scopes }),
      });

      const body = (await response.json()) as
        | { data: ApiKeyRow & { plaintext: string } }
        | { error: { message: string } };

      if (!response.ok || 'error' in body) {
        setError('error' in body ? body.error.message : 'Anahtar oluşturulamadı.');
        return;
      }

      setKeys((current) => [
        {
          ...body.data,
          revoked: false,
          lastUsedAt: null,
          requestCount: 0,
        },
        ...current,
      ]);

      setRevealed({ name: body.data.name, plaintext: body.data.plaintext });
      setCreating(false);
      setName('');
    } catch {
      setError('Bağlantı hatası. Lütfen tekrar deneyin.');
    } finally {
      setSubmitting(false);
    }
  }

  function revoke(id: string) {
    setKeys((current) =>
      current.map((key) => (key.id === id ? { ...key, revoked: true } : key)),
    );
  }

  function toggleScope(scope: ApiScope) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  }

  return (
    <div className="space-y-5">
      {revealed && <RevealedKey revealed={revealed} onDismiss={() => setRevealed(null)} />}

      {creating ? (
        <form onSubmit={createKey} className="card space-y-5 p-5">
          <div>
            <label htmlFor="key-name" className="text-xs font-medium text-muted">
              Anahtar adı
            </label>
            <input
              id="key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Örn. Üretim — ERP senkronu"
              required
              minLength={2}
              className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm outline-none focus:border-brand"
            />
            <p className="mt-1 text-2xs text-subtle">
              Sonradan hangi sistemin kullandığını hatırlamanızı sağlar.
            </p>
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-muted">Ortam</legend>
            <div className="mt-2 flex gap-2">
              {(['live', 'test'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setEnvironment(option)}
                  aria-pressed={environment === option}
                  className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                    environment === option
                      ? 'border-brand bg-brand/12 text-brand-soft'
                      : 'border-line bg-surface text-muted hover:text-fg'
                  }`}
                >
                  {option === 'live' ? 'Canlı' : 'Test'}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-medium text-muted">Yetkiler</legend>
            <p className="mt-1 text-2xs text-subtle">
              En az yetki ilkesi: anahtara yalnızca gerçekten ihtiyaç duyduğu izinleri verin.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {API_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${
                    scopes.includes(scope)
                      ? 'border-brand/50 bg-brand/8'
                      : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="mt-0.5 accent-[var(--brand)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{SCOPE_LABELS[scope]}</span>
                    <code className="font-mono text-2xs text-subtle">{scope}</code>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertIcon className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || scopes.length === 0 || name.trim().length < 2}
              className="rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Oluşturuluyor…' : 'Anahtarı oluştur'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-xl border border-line px-5 py-2.5 text-sm font-medium text-muted hover:text-fg"
            >
              Vazgeç
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-xl press bg-brand-cta px-5 py-2.5 text-sm font-semibold text-white"
        >
          <KeyIcon className="h-4 w-4" />
          Yeni anahtar oluştur
        </button>
      )}

      {/*
        BOŞ DURUM.
        Liste sahte anahtarlarla doldurulduğu sürece bu duruma hiç
        düşülmüyordu; gerçek veriye geçince ilk karşılaşılan ekran bu oldu.
        Boş bir <ul>, satıcıya sayfanın bozuk olduğunu düşündürür.
      */}
      {keys.length === 0 && (
        <p className="rounded-2xl border border-line bg-surface-2 p-5 text-sm leading-relaxed text-muted">
          Henüz API anahtarınız yok. Kataloğunuzu kendi sisteminizden otomatik
          göndermek için yukarıdan bir anahtar oluşturun.
        </p>
      )}

      <ul className="space-y-3">
        {keys.map((key) => (
          <li
            key={key.id}
            className={`card p-5 ${key.revoked ? 'opacity-55' : ''}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{key.name}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-3xs font-bold uppercase ${
                      key.environment === 'live'
                        ? 'bg-success/12 text-success'
                        : 'bg-warning/12 text-warning'
                    }`}
                  >
                    {key.environment === 'live' ? 'Canlı' : 'Test'}
                  </span>
                  {key.revoked && (
                    <span className="rounded-full bg-danger/12 px-2 py-0.5 text-3xs font-bold uppercase text-danger">
                      İptal edildi
                    </span>
                  )}
                </div>

                <code className="mt-2 block break-all font-mono text-xs text-muted">
                  {key.key_prefix}_••••••••••••••••{key.last_four}
                </code>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {key.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-3xs text-muted"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4 text-right">
                <div className="text-2xs text-muted">
                  <p className="tabular font-semibold text-fg">
                    {key.requestCount.toLocaleString('tr-TR')}
                  </p>
                  <p>istek</p>
                  <p className="mt-1">
                    {key.lastUsedAt
                      ? `Son: ${formatRelative(key.lastUsedAt)}`
                      : 'Henüz kullanılmadı'}
                  </p>
                </div>

                {!key.revoked && (
                  <button
                    type="button"
                    onClick={() => revoke(key.id)}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-line text-subtle transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
                    aria-label={`${key.name} anahtarını iptal et`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="card p-5">
        <h3 className="text-sm font-semibold">Anahtarı kullanma</h3>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-bg p-4 font-mono text-2xs leading-relaxed text-muted">
          <code>{`curl ${apiBaseUrl}/api/v1/me \\
  -H "x-api-key: ohk_live_..."`}</code>
        </pre>
        <p className="mt-3 text-xs text-muted">
          Bu uç nokta anahtarınızın hangi taşerona ait olduğunu ve yetkilerini döner —
          entegrasyonu doğrulamak için ilk çağıracağınız adres.
        </p>
      </div>
    </div>
  );
}

/**
 * Yeni üretilen anahtarın tek seferlik gösterimi.
 * Kullanıcının anahtarı kopyalamadan sayfadan ayrılması geri alınamaz
 * olduğu için uyarı belirgin ve kapatması bilinçli bir eylemdir.
 */
function RevealedKey({
  revealed,
  onDismiss,
}: {
  revealed: { name: string; plaintext: string };
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(revealed.plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="card-glow p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
          <CheckIcon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">“{revealed.name}” anahtarı oluşturuldu</h3>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
            <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Bu anahtar bir daha gösterilmeyecek. Şimdi kopyalayıp güvenli bir yere kaydedin.
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-bg p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg">
              {revealed.plaintext}
            </code>
            <button
              type="button"
              onClick={copy}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                copied ? 'bg-success text-on-success' : 'bg-surface-2 text-fg hover:bg-surface-hover'
              }`}
            >
              {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
              {copied ? 'Kopyalandı' : 'Kopyala'}
            </button>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            className="mt-3 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Kaydettim, kapat
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 60) return `${minutes} dk önce`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} sa önce`;
  return `${Math.round(minutes / 1440)} gün önce`;
}
