/**
 * 地図の拠点の吹き出しの中身 (HTML)。
 *
 * Leaflet の setContent は文字列を **HTML としてそのまま描く**。拠点の名前と住所は管理者が
 * 入れる値なので、必ず HTML の特別な文字を逃がしてから埋め込む (2026-10-28・自主診断 ASVS 3.2.2)。
 * 色と状態の言葉はアプリが決める値だが、同じく逃がす。
 */

/** HTML の本文と属性の値に埋め込むために & < > " ' を逃がす。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function storePopupHtml(
  s: { id: string; name: string; address?: string | null },
  disp: { color: string; label: string },
): string {
  const id = escapeHtml(s.id)
  const href = escapeHtml(`/stores/${encodeURIComponent(s.id)}`)
  return `
        <div style="font-size:13px;line-height:1.5">
          <div style="font-weight:600;margin-bottom:2px">${escapeHtml(s.name)}</div>
          ${s.address ? `<div style="font-size:11px;color:#64748b">${escapeHtml(s.address)}</div>` : ''}
          <div style="margin:4px 0">
            <span style="display:inline-block;padding:1px 6px;border-radius:8px;color:white;font-size:11px;background:${escapeHtml(disp.color)}">${escapeHtml(disp.label)}</span>
          </div>
          <a href="${href}" data-store-id="${id}" class="intereco-popup-go-store" style="display:block;text-align:center;margin-top:4px;padding:4px 8px;border-radius:4px;background:#2C4A7E;color:white;font-size:11px;text-decoration:none">16分割で見る</a>
        </div>
      `
}
