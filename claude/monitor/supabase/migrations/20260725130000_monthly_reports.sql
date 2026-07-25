-- 月次確定レポート C: monthly_reports（月次スナップショット＋PDF）。
-- report_day（毎月）に前月分を確定＝usage_daily を集計して JSON で凍結し PDF を作る。
-- 過去月は usage_daily が後で変わっても確定値のまま（監査対応）。

CREATE TABLE IF NOT EXISTS public.monthly_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ym           text NOT NULL,                 -- 'YYYY-MM'
  totals       jsonb NOT NULL,                -- テナント全体の確定合計（指標）
  stores       jsonb NOT NULL DEFAULT '[]'::jsonb, -- 店舗別の確定合計
  contract     jsonb,                         -- 契約 vs 登録スナップショット
  pdf_url      text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid,                          -- 確定した admin（auth uid）。cronは NULL
  UNIQUE (tenant_id, ym)
);
CREATE INDEX IF NOT EXISTS monthly_reports_tenant_ym ON public.monthly_reports (tenant_id, ym DESC);

ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "monthly_reports_select" ON public.monthly_reports;
CREATE POLICY "monthly_reports_select" ON public.monthly_reports
  FOR SELECT TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (public.auth_user_role() = 'tenant_admin' AND public.auth_user_tenant_id() = tenant_id)
  );
-- 書込は service client（確定API/cron）のみ＝RLS の insert/update ポリシーは置かない。
