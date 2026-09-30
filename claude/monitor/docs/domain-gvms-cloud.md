# クラウドの URL を専用ドメイン gvms-cloud.com へ移す手順

2026-09-30 に決定（発注者の判断）。会社ドメインのサブドメイン案（cloud.genesis-edge.com）ではなく、専用ドメインを買う。新しい URL は **https://gvms-cloud.com**。
旧 URL **https://intereco-monitor.vercel.app は Vercel の既定の URL として残り、当面は両方で動く**。
拠点の G・VMS と利用者を順に移してから、最後に旧 URL の画面だけを新 URL へ転送する。

本番の設定（Vercel・Cloudflare・Supabase）は発注者が行う。コードの変更は PR（既定の URL の書き換え）。

## 順番

| # | 作業 | 誰が | どこで |
|---|---|---|---|
| 0 | ドメインを買う | 発注者 | Cloudflare（Domain Registration） |
| 1 | Vercel にドメインを足す（apex と www） | 発注者 | Vercel |
| 2 | DNS にレコードを足す | 発注者 | Cloudflare（gvms-cloud.com） |
| 3 | 新 URL で画面が開くことを確かめる | 発注者 | ブラウザ |
| 4 | 環境変数 `NEXT_PUBLIC_SITE_URL` を新 URL にして再デプロイ | 発注者 | Vercel |
| 5 | Supabase の Auth の URL 設定 | 発注者 | Supabase |
| 6 | Supabase の Edge Function の環境変数 | 発注者 | Supabase |
| 7 | Vault の `app_url` | 発注者 | Supabase（SQL エディタ） |
| 8 | ~~R2 の CORS~~（不要と確認済み） | — | — |
| 9 | コードの PR をマージ | 発注者 | GitHub |
| 10 | 動作確認（ログイン・パスワード再設定・遠隔視聴・BCP のメールのリンク） | 開発 | 本番 |
| 11 | 拠点の G・VMS の接続先を順に移す | 開発・現地 | 各拠点 |
| 12 | 利用者へ案内（新 URL・ログインし直し・ホーム画面のアイコンの作り直し） | 発注者 | — |
| 13 | 旧 URL の画面を新 URL へ転送（API は転送しない） | 開発 | 別 PR |

## 0. ドメインを買う（Cloudflare Registrar）

Cloudflare → Domain Registration → Register Domains → `gvms-cloud.com` を検索して購入（原価・年ごと）。
登録者情報は会社（ジェネシス・エッジ）で。**WHOIS の情報の公開を伏せる設定（既定で有効）を確かめる。**
自動更新を有効にしておく（失効すると、拠点のアップリンクもメールのリンクも止まる）。
Cloudflare で買うと、同じアカウントに gvms-cloud.com の DNS の管理（ゾーン）が自動でできる。

購入前に、J-PlatPat で「GVMS」「G・VMS」の商標の重なりを一度確かめておく（第 9 類・第 42 類など）。

## 1. Vercel にドメインを足す

Vercel → プロジェクト（intereco-monitor）→ Settings → Domains → **Add** で次の 2 つを足す:

| ドメイン | 扱い |
|---|---|
| `gvms-cloud.com` | 本番（monitor-prod の配備に付ける） |
| `www.gvms-cloud.com` | `gvms-cloud.com` へ転送（Redirect を選ぶ） |

画面に、それぞれ登録すべき **DNS の値**が出るので控える（apex は A レコード `76.76.21.21` か、
プロジェクトごとの値。www は CNAME `cname.vercel-dns.com` かプロジェクトごとの値）。**画面に出た値を使う。**

## 2. DNS にレコードを足す（Cloudflare・gvms-cloud.com）

Cloudflare → gvms-cloud.com → DNS → レコードを追加:

| 種類 | 名前 | 内容 | プロキシ |
|---|---|---|---|
| A（または Vercel が示す種類） | `@` | 手順 1 で控えた値 | **DNS のみ（灰色の雲）** |
| CNAME | `www` | 手順 1 で控えた値 | **DNS のみ（灰色の雲）** |

- **橙色（プロキシ）にしない。** Vercel が証明書（Let’s Encrypt）を取れず、二重の CDN にもなる。
- 買ったばかりのゾーンに Cloudflare が自動で入れた既定のレコード（駐車ページ等）があれば消す。
- CAA レコードを入れる場合は `letsencrypt.org` を許す。
- **メールは送らない・受けないドメイン**にするなら、なりすまし防止に次を入れておく（任意だが推奨）:
  `TXT @ "v=spf1 -all"`、`TXT _dmarc "v=DMARC1; p=reject"`。通知メールの送り元は今まで通り
  `notify.genesis-edge.com` のまま（変えない）。

Vercel の Domains の画面で両方が「Valid Configuration」になり、証明書が出るまで数分〜数十分。

## 3. 新 URL で開くことを確かめる

`https://gvms-cloud.com/login` がブラウザの警告なしで開くこと。**この時点ではログインしない**
（手順 5 の前だと、ログイン後の戻り先が旧 URL になることがある）。

## 4. 環境変数（Vercel）

Vercel → Settings → Environment Variables → Production:

| 名前 | 値 |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://gvms-cloud.com` |

旧名 `NEXT_PUBLIC_APP_URL` が残っているなら同じ値にする（読む側は `NEXT_PUBLIC_SITE_URL` を優先）。
**保存したら Redeploy**（`NEXT_PUBLIC_` は組み立て時に埋め込まれるため、再デプロイしないと効かない）。
この値は、メール（パスワード再設定・BCP の発令と完了・運用アラート）の中のリンクに使われる。

## 5. Supabase の Auth の URL 設定

Supabase → Authentication → URL Configuration:

- **Site URL**: `https://gvms-cloud.com`
- **Redirect URLs**: `https://gvms-cloud.com/**` を**足す**（旧 `https://intereco-monitor.vercel.app/**` は移行が終わるまで残す）

Site URL は、パスワード再設定の戻り先と、拠点へのログインの一本化の同意画面（`/oauth/consent`）の置き場所に使われる。

## 6. Supabase の Edge Function の環境変数

Supabase → Edge Functions → Secrets（または `supabase secrets set`）:

| 名前 | 値 |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://gvms-cloud.com` |

J アラートの受信（jalert-poller）が BCP の発令メールに載せるリンクに使う。

## 7. Vault の `app_url`

Supabase → SQL Editor で実行（DB が BCP の報告書の作成をアプリへ頼むときの宛先）:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'app_url'),
  'https://gvms-cloud.com'
);
select name, decrypted_secret from vault.decrypted_secrets where name = 'app_url';
```

2 行目で新しい値になったことを確かめる。**ほかの秘密（service_role_key 等）は表示しない**こと。

## 8. R2 の CORS（不要と確認済み・2026-09-30）

遠隔の動画（HLS）は、視聴者へ署名付き URL を渡さず**クラウドのルートが中継する**（lib/storage/video-r2 の方針・§6）ので、
ブラウザが R2 を直接読むことはない。静止画も `<img>` の表示とクラウドの中継で、CORS の許可は要らない。
R2 のバケットの CORS は変えなくてよい。

## 9. PR のマージ

既定の URL（env が無いときの落ち先）を新 URL へ変え、パスワード再設定のリンクを新ドメインへ向けられるようにする PR。
**手順 0〜7 が済んでからマージする**（先にマージすると、env の無い経路のメールのリンクがまだ開けない URL を指す）。

## 10. 動作確認（新 URL で）

- ログイン → MONITOR の拠点ビュー
- パスワード再設定のメールのリンクが `https://gvms-cloud.com/...` になっていること
- 1 台のカメラのライブ（軽量・動画 HLS）と録画の再生
- BCP のテスト発令 → メールのリンク・報告書の PDF
- 拠点の G・VMS の「クラウドのアカウントでサインイン」（同意画面が新 URL で出ること）

## 11. 拠点の G・VMS の接続先を移す

旧 URL が生きているので急がない。保守のついでに拠点ごとに:

```
# /etc/nvms/nvmsd.env
NVMS_UPLINK_URL=https://gvms-cloud.com
```

を書き換えて `sudo systemctl restart nvmsd`。拠点の 設定 → 基本 → クラウド連携 で「接続中」を確かめる。
新しく立ち上げる拠点は、初回セットアップで新 URL を入れる。

影響しないもの: ログインの一本化の発行元（Supabase の URL）、拠点の https の名前（`*.sites.genesis-edge.com`・会社ドメインのまま）、
通知メールの送り元（`notify.genesis-edge.com`）。

## 12. 利用者への案内

- 新しい URL: https://gvms-cloud.com
- ログインの状態はドメインごとなので、**一度ログインし直し**になる
- スマートフォンのホーム画面のアイコンは、新 URL で「ホーム画面に追加」し直す
- ブックマークの差し替え

## 13. 旧 URL の転送（最後・別 PR）

全拠点と利用者が移ったら、旧 URL の**画面**だけを新 URL へ転送する。
**`/api/` は転送しない**（移し忘れた拠点のアップリンクが POST のリダイレクトで壊れるため）。
