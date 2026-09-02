'use client';

/**
 * Ürün soruları.
 *
 * Yorumdan AYRI bir şey: yorum satın aldıktan sonra yazılır, soru almadan
 * önce sorulur. Bu yüzden burada "teslim almış olma" şartı yok — şartı
 * koymak, özelliğin var olma sebebini yok ederdi.
 */

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ProductQuestion } from '@/data/catalog';

import { answerQuestion, askQuestion, type QuestionResult } from '@/app/urun/questionActions';

export function ProductQuestions({
  groupId,
  slug,
  questions,
  canAnswer,
  answerVendorId,
}: {
  groupId: string;
  slug: string;
  questions: ProductQuestion[];
  /** Bu ürünü satan onaylı bir mağazanın sahibi mi? */
  canAnswer: boolean;
  /** Cevabın hangi mağaza adına yazılacağı. */
  answerVendorId: string | null;
}) {
  return (
    <section aria-labelledby="sorular" className="mt-12">
      <h2 id="sorular" className="text-lg font-bold tracking-tight text-fg">
        Soru &amp; cevap
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Ürünle ilgili sorunuzu satıcıya sorabilirsiniz. Satın almış olmanız
        gerekmez — cevabı mağaza yazar.
      </p>

      <AskForm groupId={groupId} slug={slug} />

      {questions.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          Bu ürüne henüz soru sorulmamış. İlk soruyu siz sorabilirsiniz.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {questions.map((question) => (
            <li key={question.id} className="card p-5">
              <p className="text-sm leading-relaxed text-fg">{question.body}</p>
              <p className="mt-1.5 text-xs text-subtle">
                {question.askerName} · {formatDate(question.createdAt)}
              </p>

              {question.answer ? (
                <div className="mt-4 border-l-2 border-brand/40 pl-4">
                  <p className="text-xs font-semibold text-brand">
                    {question.answerVendorName ?? 'Mağaza'} yanıtladı
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-fg">{question.answer}</p>
                  {question.answeredAt && (
                    <p className="mt-1 text-xs text-subtle">{formatDate(question.answeredAt)}</p>
                  )}
                </div>
              ) : canAnswer && answerVendorId ? (
                <AnswerForm
                  questionId={question.id}
                  slug={slug}
                  vendorId={answerVendorId}
                />
              ) : (
                <p className="mt-3 text-xs text-subtle">Mağazanın yanıtı bekleniyor.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AskForm({ groupId, slug }: { groupId: string; slug: string }) {
  const [state, formAction] = useActionState<QuestionResult, FormData>(askQuestion, {});

  if (state.needsAuth) {
    return (
      <p className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm text-muted">
        Soru sormak için{' '}
        <Link href={`/giris?devam=/urun/${slug}`} className="text-brand hover:underline">
          giriş yapın
        </Link>
        . Sorular herkese açık görünür, adınız kısaltılarak gösterilir.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="slug" value={slug} />

      {/*
        Kutu, başarılı her gönderimde YENİDEN KURULUR (`key` = damga).
        Sıfırlamayı bir efektle yapmak, React'in "efekt içinde setState"
        uyarısını tetikliyor ve gereksiz bir render turu üretiyordu; burada
        işi anahtar yapıyor.
      */}
      <QuestionField key={state.stamp ?? 0} error={state.fieldErrors?.body} />

      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-3">
        <AskButton />
      </div>

      <p aria-live="polite" className="mt-2 text-xs">
        {state.fieldErrors?.body && (
          <span id="soru-hata" className="text-danger">
            {state.fieldErrors.body}
          </span>
        )}
        {state.error && <span className="text-danger">{state.error}</span>}
        {state.ok && <span className="text-success">Sorunuz gönderildi.</span>}
      </p>
    </form>
  );
}

function QuestionField({ error }: { error?: string }) {
  const [value, setValue] = useState('');

  return (
    <>
      <label htmlFor="soru" className="text-xs font-medium text-muted">
        Sorunuz
      </label>
      <textarea
        id="soru"
        name="body"
        rows={3}
        required
        minLength={10}
        maxLength={500}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-describedby={error ? 'soru-hata' : 'soru-sayac'}
        aria-invalid={error ? true : undefined}
        placeholder="Örn. Kutunun içinde şarj aleti var mı?"
        className={`mt-1.5 w-full rounded-xl border bg-bg px-3.5 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-subtle focus:border-brand ${
          error ? 'border-danger' : 'border-line'
        }`}
      />
      {/* Sayaç sesli DUYURULMAZ: her tuş vuruşunda konuşan bir sayaç, ekran
          okuyucu kullanan birinin yazmasını imkânsız kılar. */}
      <p id="soru-sayac" className="mt-1.5 text-xs text-subtle">
        {value.trim().length}/500
      </p>
    </>
  );
}

function AskButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl press bg-brand-cta px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? 'Gönderiliyor…' : 'Soruyu gönder'}
    </button>
  );
}

function AnswerForm({
  questionId,
  slug,
  vendorId,
}: {
  questionId: string;
  slug: string;
  vendorId: string;
}) {
  const [state, formAction] = useActionState<QuestionResult, FormData>(answerQuestion, {});

  return (
    <form action={formAction} className="mt-4 border-l-2 border-line pl-4">
      <input type="hidden" name="question_id" value={questionId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="vendor_id" value={vendorId} />

      <label htmlFor={`cevap-${questionId}`} className="text-xs font-medium text-muted">
        Mağaza olarak yanıtlayın
      </label>
      <textarea
        id={`cevap-${questionId}`}
        name="answer"
        rows={2}
        required
        minLength={2}
        maxLength={2000}
        aria-invalid={state.fieldErrors?.answer ? true : undefined}
        className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-fg outline-none transition-colors focus:border-brand"
      />

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <AnswerButton />
        <p aria-live="polite" className="text-xs">
          {state.fieldErrors?.answer && (
            <span className="text-danger">{state.fieldErrors.answer}</span>
          )}
          {state.error && <span className="text-danger">{state.error}</span>}
          {state.ok && <span className="text-success">Yanıtınız yayınlandı.</span>}
        </p>
      </div>
    </form>
  );
}

function AnswerButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl border border-line px-4 py-1.5 text-xs font-semibold transition-colors hover:border-brand/50 disabled:opacity-60"
    >
      {pending ? 'Kaydediliyor…' : 'Yanıtla'}
    </button>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
