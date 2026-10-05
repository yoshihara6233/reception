'use client'

/**
 * 要望・困りごとの入力（基本設計 §3.1・§3.2・§7）。テナント管理者だけが開ける。
 *
 * 2 段で送る: 入力 → 「この内容を送ります」の確認（本文と自動で添える項目をそのまま見せる）→ 送信。
 * 自動で添える項目は確認へ進むときに一度だけ作り、見せたものをそのまま送る。
 * 本文・返事はどこでも文として出す（HTML として解釈しない）。
 *
 * 該当の画面の URL（任意・GVMS_CLOUD_SPEC §12.2）: 今いる画面のパスを初期値に入れる（編集できる）。
 * 画像 1 枚（任意・§12.6・2026-10-05 発注者の判断）: 管理者が自分で選んだファイルだけを添える
 * （自動では撮らない）。選んだら見本と「映像や人が写っていないか確かめてください」を出す。
 * 送る前に、先頭の印で PNG・JPEG・WebP か、3 MB 以内かを確かめる（受け口でも同じ決まりで確かめる）。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BODY_MAX, FEEDBACK_KINDS, FEEDBACK_URGENCIES, KIND_LABEL, URGENCY_LABEL, USER_DAILY_LIMIT, charCount,
  type FeedbackContext, type FeedbackKind, type FeedbackUrgency,
} from '@/lib/feedback/schema'
import { CONTEXT_LABEL, buildClientContext } from '@/lib/feedback/client-context'
import {
  ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, PAGE_URL_MAX, detectImageType, fmtBytes, normalizePageUrl,
} from '@/lib/feedback/image'

type Step = 'form' | 'confirm' | 'done'

const fmtNum = (n: number) => n.toLocaleString('ja-JP')

const ERROR_TEXT: Record<number, string> = {
  401: 'ログインの期限が切れました。もう一度ログインしてください。',
  403: '要望を送れるのはテナント管理者だけです。',
  409: 'このテナントでは要望の受付が止められています。',
  413: '画像が大きすぎます。3 MB までの画像を選んでください。',
  429: `1 日に送れる件数（${USER_DAILY_LIMIT} 件）を超えました。明日あらためて送ってください。`,
}
const ERROR_CODE_TEXT: Record<string, string> = {
  invalid_attachment: '画像の形式が違います。PNG・JPEG・WebP の画像を選んでください。',
}

interface Picked { file: File; preview: string }

export function FeedbackDialog({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent?: () => void }) {
  const pathname = usePathname() ?? '/'
  const [step, setStep] = useState<Step>('form')
  const [kind, setKind] = useState<FeedbackKind>('request')
  const [urgency, setUrgency] = useState<FeedbackUrgency>('inconvenient')
  const [body, setBody] = useState('')
  const [contactOk, setContactOk] = useState(false)
  const [context, setContext] = useState<FeedbackContext | null>(null)
  // 該当の画面の URL。null の間は今いる画面のパスを出す（触ったらその値）
  const [pageUrlEdited, setPageUrlEdited] = useState<string | null>(null)
  const [sentPageUrl, setSentPageUrl] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [fileErr, setFileErr] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pageUrl = pageUrlEdited ?? pathname

  // 見本の URL（object URL）は差し替え・外す・閉じるときに手放す
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.preview) }, [picked])

  // 閉じるときに入力の段へ戻す（次に開いたとき入力から始める）。入力中の本文と画像は残す。
  // URL は次に開いた画面のパスを入れ直す。
  const close = () => {
    if (busy) return
    setStep('form'); setErr(null); setPageUrlEdited(null)
    onClose()
  }

  async function pickFile(f: File | null) {
    setFileErr(null)
    if (!f) return
    if (f.size > ATTACHMENT_MAX_BYTES) { setFileErr(`画像が大きすぎます（${fmtBytes(f.size)}）。3 MB までの画像を選んでください。`); return }
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer())
    if (!detectImageType(head)) { setFileErr('PNG・JPEG・WebP の画像を選んでください。'); return }
    setPicked({ file: f, preview: URL.createObjectURL(f) })
  }

  function removeFile() {
    setPicked(null); setFileErr(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      setStep('form'); setErr(null); setPageUrlEdited(null)
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const len = charCount(body)
  const bodyOk = body.trim().length > 0 && len <= BODY_MAX
  const pageUrlTrim = pageUrl.trim()
  const pageUrlOk = pageUrlTrim === '' || normalizePageUrl(pageUrlTrim) !== null

  function toConfirm() {
    if (!bodyOk || !pageUrlOk) return
    setSentPageUrl(pageUrlTrim === '' ? null : normalizePageUrl(pageUrlTrim))
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
      const payload = { kind, urgency, body, contact_ok: contactOk, context, page_url: sentPageUrl ?? undefined }
      let res: Response
      if (picked) {
        // 画像つきは multipart（payload に JSON・attachment に画像）
        const form = new FormData()
        form.set('payload', JSON.stringify(payload))
        form.set('attachment', picked.file)
        res = await fetch('/api/feedback', { method: 'POST', body: form })
      } else {
        res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      if (!res.ok) {
        const code = ((await res.json().catch(() => ({}))) as { error?: string }).error
        setErr((code && ERROR_CODE_TEXT[code]) ?? ERROR_TEXT[res.status] ?? '送れませんでした。時間をおいてもう一度お試しください。')
        return
      }
      setStep('done')
      setBody(''); setKind('request'); setUrgency('inconvenient'); setContactOk(false)
      setPageUrlEdited(null); removeFile()
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

            <label className="block">
              <span className="mb-1.5 flex items-baseline justify-between">
                <span className="font-bold">該当の画面の URL（任意）</span>
                <span className={`text-[11px] ${pageUrlOk ? 'text-ge-ink-3 dark:text-gedink3' : 'text-ge-danger'}`}>
                  / で始まる画面の場所
                </span>
              </span>
              <input
                type="text"
                value={pageUrl}
                onChange={(e) => setPageUrlEdited(e.target.value)}
                maxLength={PAGE_URL_MAX + 200}
                className="w-full rounded border border-ge-line-2 bg-white px-2 py-1.5 font-ge-mono text-[12px] text-ge-ink dark:border-gedline dark:bg-gedbg dark:text-gedink"
                placeholder="例: /stores"
                aria-invalid={!pageUrlOk}
              />
              <span className="mt-1 block text-[11px] text-ge-ink-3 dark:text-gedink3">
                今いる画面の場所を入れています。別の画面のことなら書き換えてください。https:// から貼り付けたときは、画面の場所だけを送ります。
              </span>
              {!pageUrlOk && (
                <span role="alert" className="mt-1 block text-[11px] text-ge-danger">
                  / で始まる画面の場所を入れるか、空にしてください（{fmtNum(PAGE_URL_MAX)} 字まで・空白は使えません）。
                </span>
              )}
            </label>

            <div>
              <div className="mb-1.5 font-bold">画像を添える（1 枚・3 MB まで・PNG/JPEG/WebP）</div>
              {picked ? (
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={picked.preview}
                    alt="添える画像の見本"
                    className="h-24 w-auto max-w-[12rem] rounded border border-ge-line bg-ge-paper object-contain dark:border-gedline dark:bg-gedbg"
                  />
                  <div className="min-w-0 space-y-1">
                    <p className="break-all font-ge-mono text-[11px]">{picked.file.name}</p>
                    <p className="font-ge-mono text-[11px] tabular-nums text-ge-ink-3 dark:text-gedink3">{fmtBytes(picked.file.size)}</p>
                    <button type="button" className={btnSecondary} onClick={removeFile}>画像を外す</button>
                  </div>
                </div>
              ) : (
                <input
                  ref={fileInput}
                  type="file"
                  accept={ATTACHMENT_TYPES.join(',')}
                  onChange={(e) => { void pickFile(e.target.files?.[0] ?? null) }}
                  className="block text-xs file:mr-2 file:cursor-pointer file:rounded file:border file:border-ge-line file:bg-white file:px-3 file:py-1 file:text-xs file:text-ge-ink-2 dark:file:border-gedline dark:file:bg-gedbg3 dark:file:text-gedink"
                />
              )}
              {picked && (
                <p className="mt-2 rounded border border-ge-warning px-3 py-2 text-ge-ink-2 dark:text-gedink2">
                  映像や人が写っていないか確かめてください。カメラの映像・人の顔・名前の入った画面は添えないでください。
                </p>
              )}
              {fileErr && <p role="alert" className="mt-1 text-[11px] text-ge-danger">{fileErr}</p>}
              {!picked && !fileErr && (
                <p className="mt-1 text-[11px] text-ge-ink-3 dark:text-gedink3">
                  画面の写しなど、管理者が選んだ画像だけを添えます。自動では撮りません。
                </p>
              )}
            </div>

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
              <dt className="text-ge-ink-3 dark:text-gedink3">該当の画面の URL</dt>
              <dd className="break-all font-ge-mono">{sentPageUrl ?? 'なし'}</dd>
              <dt className="text-ge-ink-3 dark:text-gedink3">画像</dt>
              <dd>{picked ? `1 枚（${fmtBytes(picked.file.size)}）` : 'なし'}</dd>
            </dl>
            {picked && (
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={picked.preview}
                  alt="添える画像の見本"
                  className="h-24 w-auto max-w-[12rem] rounded border border-ge-line bg-ge-paper object-contain dark:border-gedline dark:bg-gedbg"
                />
                <p className="rounded border border-ge-warning px-3 py-2 text-ge-ink-2 dark:text-gedink2">
                  映像や人が写っていないか、もう一度確かめてください。
                </p>
              </div>
            )}
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
                {picked ? '映像・カメラの名前は添えません（画像は選んだ 1 枚だけ）。' : '画面の写し・映像・カメラの名前は添えません。'}
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
              <button type="button" className={btnPrimary} onClick={toConfirm} disabled={!bodyOk || !pageUrlOk}>内容を確かめる</button>
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
