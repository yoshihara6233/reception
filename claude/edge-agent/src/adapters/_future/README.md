# adapters/_future

このディレクトリは Phase 5+ で追加予定の NVR ベンダーアダプタ用の **拡張枠** です。

## 追加方法 (テンプレート)

新ベンダー `foo` の adapter を追加する場合:

1. **ディレクトリ作成**
   ```
   adapters/foo/
   ├── _common/             # ベンダー固有のクライアント・型
   ├── foo-adapter.ts       # NvrAdapter 実装
   └── index.ts             # public API
   ```

2. **adapters/_registry/registry.ts に登録**
   ```ts
   'foo': async (cfg) => {
     const mod = await import('../foo/foo-adapter')
     return mod.createFooAdapter(cfg)
   },
   ```

3. **NvrVendor 型に追加** (`_base/nvr-adapter.ts`)
   ```ts
   export type NvrVendor =
     | ...
     | 'foo'
   ```

4. **monitor UI のベンダー選択肢に追加** (`src/lib/i18n/messages.ts` の `nvrVendor`)

5. **契約テスト通過** (`adapters/_base/contract-tests.ts` を使う)

## Phase 5+ で追加候補

| vendor | 機種 | 優先度 |
|---|---|---|
| `i-pro-gxe500` | WJ-GXE500 アナログ→IP 変換 | 高 (Phase 1 末で実装目標) |
| `hikvision` | DS-7616NI-K2/16P 等 | 中 (国内シェア大) |
| `hanwha-wisenet` | PRN-1610S2 等 | 中 (国内市場) |
| `synology-surveillance` | DS423+ + Surveillance Station | 中 |
| `axis-vapix` | Axis 全ラインナップ | 低〜中 |
| `onvif-generic` | ONVIF Profile S/T 汎用 | 高 (fallback として有用) |

## 禁止事項

- このディレクトリ配下のコードを **直接 import しない** (registry 経由のみ)
- 既存 adapter のコードを **触らない** (Open/Closed 原則)
- `commands/`, `modes/`, `webhook/` などベンダー非依存コードに **ベンダー名を直書きしない**
