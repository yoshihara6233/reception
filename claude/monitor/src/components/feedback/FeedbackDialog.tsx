'use client'

/**
 * 要望・困りごとの入力（基本設計 §3.1・§3.2・§7）。テナント管理者だけが開ける。
 *
 * 2 段で送る: 入力 → 「この内容を送ります」の確認（本文と自動で添える項目をそのまま見せる）→ 送信。
 * 自動で添える項目は確認へ進むときに一度だけ作り、見せたものをそのまま送る。
 * 本文・返事はどこでも文として出す（HTML として解釈しない）。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BODY_MAX, FEEDBACK_KINDS, FEEDBACK_URGENCIES, KIND_LABEL, URGENCY_LABEL, USER_DAILY_LIMIT, charCount,
  type FeedbackContext, type FeedbackKind, type FeedbackUrgency,
} from '@/lib/feedback/schema'
import { CONTEXT_LABEL, buildClientContext } from '@/lib/feedback/client-context'

type Step = 'form' | 'confirm' | 'done'

const fmtNum = (n: number) => n.toLocaleString('ja-JP')

const ERROR_TEXT: Record<number, string> = {
  401: 'ログインの期限が切れました。もう一度ログインしてください。',
  403: '要望を送れるのはテナント管理者だけです。',
  409: 'このテナントでは要望の受付が止められています。',
  429: `1 日に送れる件数（${USER_DAILY_LIMIT} 件）を超えました。明日あらためて送ってください。`,
}

export function FeedbackDialog({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent?: () => void }) {
  const pathname = usePathname() ?? '/'
  const [step, setStep] = useState<Step>('form')
  const [kind, setKind] = useState<FeedbackKind>('request')
  const [urgency, setUrgency] = useState<FeedbackUrgency>('inconvenient')
  const [body, setBody] = useState('')
  const [contactOk, setContactOk] = useState(false)
  const [context, setContext] = useState<FeedbackContext | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 閉じるときに入力の段へ戻す（次に開いたとき入力から始める）。入力中の本文は残す。
  const close = () => {
    if (busy) return
    setStep('form'); setErr(null)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      setStep('form'); setErr(null)
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const len = charCount(body)
  const bodyOk = body.trim().length > 0 && len <= BODY_MAX

  function toConfirm() {
    if (!bodyOk) return
    setContext(buildClientContext({
      pathname,
      userAgent: navigator.userAgent,
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    setErr(null)
    setStep('confirm')
  }

  async function send() {
    if (!context) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, urgency, body, contact_ok: contactOk, context }),
      })
      if (!res.ok) {
        setErr(ERROR_TEXT[res.status] ?? '送れませんでした。時間をおいてもう一度お試しください。')
        return
      }
      setStep('done')
      setBody(''); setKind('request'); setUrgency('inconvenient'); setContactOk(false)
      onSent?.()
    } catch {
      setErr('送れませんでした。通信の状態を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const radio = 'h-3.5 w-3.5 accent-ge-accent'
  const btn = 'rounded px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50'
  const btnPrimary = `${btn} bg-ge-accent text-white hover:bg-ge-ink-2 dark:bg-gedaccent dark:text-gedbg`
  const btnSecondary = `${btn} border border-ge-line bg-white text-ge-ink-2 hover:bg-ge-paper-2 dark:border-gedline dark:bg-gedbg3 dark:text-gedink`

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto bg-ge-ink/50 p-3 sm:items-center sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        className="w-full max-w-lg rounded-[10px] border border-ge-line bg-white text-ge-ink shadow-xl dark:border-gedline dark:bg-gedbg2 dark:text-gedink"
      >
        <div className="border-b border-ge-line px-5 py-3 dark:border-gedline">
          <h2 id="feedback-dialog-title" className="text-sm font-bold">
            {step === 'confirm' ? 'この内容を送ります' : '要望・困りごと'}
          </h2>
        </div>

        {step === 'form' && (
          <div className="space-y-4 px-5 py-4 text-xs">
            <p className="text-ge-ink-3 dark:text-gedink2">
              G・VMS-Cloud への要望・不具合・質問を運営へ送ります。送った内容と運営からの返事は、設定の「要望」で確かめられます。
            </p>

            <fieldset>
              <legend className="mb-1.5 font-bold">種類</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {FEEDBACK_KINDS.map((k) => (
                  <label key={k} className="inline-flex items-center gap-1.5">
                    <input type="radio" name="fb-kind" className={radio} checked={kind === k} onChange={() => setKind(k)} />
                    {KIND_LABEL[k]}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 font-bold">困っている度合い</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {FEEDBACK_URGENCIES.map((u) => (
                  <label key={u} className="inline-flex items-center gap-1.5">
                    <input type="radio" name="fb-urgency" className={radio} checked={urgency === u} onChange={() => setUrgency(u)} />
                    {URGENCY_LABEL[u]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1.5 flex items-baseline justify-between">
                <span className="font-bold">内容</span>
                <span className={`font-ge-mono tabular-nums ${len > BODY_MAX ? 'text-ge-danger' : 'text-ge-ink-3 dark:text-gedink3'}`}>
                  {fmtNum(len)} / {fmtNum(BODY_MAX)} 字
                </span>
              </span>
              <textarea
                autoFocus
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="w-full resize-y rounded border border-ge-line-2 bg-white px-2 py-1.5 text-[13px] leading-relaxed text-ge-ink dark:border-gedline dark:bg-gedbg dark:text-gedink"
                placeholder="例: 64 分割にすると時刻の表示が小さくて読めません。"
              />
            </label>
            <p className="rounded border border-ge-line bg-ge-paper-2 px-3 py-2 text-ge-ink-2 dark:border-gedline dark:bg-gedbg3 dark:text-gedink2">
              人の名前・連絡先・パスワードは書かないでください。電話番号・メールアドレス・URL は伏せ字にして保存します。
            </p>

            <fieldset>
              <legend className="mb-1.5 font-bold">運営から連絡してよいか</legend>
              <div className="flex gap-4">
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="fb-contact" className={radio} checked={contactOk} onChange={() => setContactOk(true)} />
                  はい
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="fb-contact" className={radio} checked={!contactOk} onChange={() => setContactOk(false)} />
                  いいえ
                </label>
              </div>
              <p className="mt-1 text-[11px] text-ge-ink-3 dark:text-gedink3">
                「はい」のとき、運営からテナントの登録連絡先へ連絡します。
              </p>
            </fieldset>
          </div>
        )}

        {step === 'confirm' && context && (
          <div className="space-y-3 px-5 py-4 text-xs">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-ge-ink-3 dark:text-gedink3">種類</dt><dd>{KIND_LABEL[kind]}</dd>
              <dt className="text-ge-ink-3 dark:text-gedink3">困っている度合い</dt><dd>{URGENCY_LABEL[urgency]}</dd>
              <dt className="text-ge-ink-3 dark:text-gedink3">運営から連絡</dt><dd>{contactOk ? 'はい' : 'いいえ'}</dd>
            </dl>
            <div>
              <div className="mb-1 text-ge-ink-3 dark:text-gedink3">内容</div>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded border border-ge-line bg-ge-paper px-3 py-2 text-[13px] leading-relaxed dark:border-gedline dark:bg-gedbg">
                {body}
              </p>
            </div>
            <div>
              <div className="mb-1 text-ge-ink-3 dark:text-gedink3">自動で添える項目</div>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 rounded border border-ge-line px-3 py-2 dark:border-gedline">
                {(Object.keys(CONTEXT_LABEL) as (keyof typeof CONTEXT_LABEL)[])
                  .filter((k) => context[k])
                  .map((k) => (
                    <div key={k} className="contents">
                      <dt className="text-ge-ink-3 dark:text-gedink3">{CONTEXT_LABEL[k]}</dt>
                      <dd className="break-all font-ge-mono">{context[k]}</dd>
                    </div>
                  ))}
              </dl>
              <p className="mt-1 text-[11px] text-ge-ink-3 dark:text-gedink3">
                画面の写し・映像・カメラの名前は添えません。
              </p>
            </div>
            <p className="rounded border border-ge-line bg-ge-paper-2 px-3 py-2 text-ge-ink-2 dark:border-gedline dark:bg-gedbg3 dark:text-gedink2">
              人の名前・連絡先・パスワードが含まれていないか、もう一度確かめてください。
            </p>
            {err && <p role="alert" className="text-ge-danger">{err}</p>}
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-2 px-5 py-5 text-xs">
            <p>送りました。運営が確かめて、状態と返事をお知らせします。</p>
            <p className="text-ge-ink-3 dark:text-gedink2">
              送った要望の状態は
              <Link href="/settings/feedback" onClick={close} className="mx-1 text-ge-accent underline dark:text-gedaccent">設定の「要望」</Link>
              で確かめられます。
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-ge-line px-5 py-3 dark:border-gedline">
          {step === 'form' && (
            <>
              <button type="button" className={btnSecondary} onClick={close}>キャンセル</button>
              <button type="button" className={btnPrimary} onClick={toConfirm} disabled={!bodyOk}>内容を確かめる</button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button type="button" className={btnSecondary} onClick={() => setStep('form')} disabled={busy}>戻る</button>
              <button type="button" className={btnPrimary} onClick={send} disabled={busy}>{busy ? '送信中…' : '送信'}</button>
            </>
          )}
          {step === 'done' && (
            <button type="button" className={btnSecondary} onClick={close}>閉じる</button>
          )}
        </div>
      </div>
    </div>
  )
}
