-- 命令の受領記録が「受け取った」だけで永久に決着しない不具合の是正。
--
-- ── 症状（2026-08-14・本番実機で発見）────────────────────────────────────
-- `20260813120000_evidence_gaps.sql` で入れた `edge_command_runs` に、エッジが
-- 行を **insert はできるのに update できない**。本番で `start_grid`/`stop_grid` の
-- 行が 3 件立ち、全て `finished_at` / `ok` が NULL のままだった。
--
-- ── 原因 ────────────────────────────────────────────────────────────────
-- **PostgreSQL は `UPDATE ... WHERE` に SELECT ポリシーも適用する**（WHERE で
-- 列を読む＝その行が「見える」ことが前提）。この表の SELECT ポリシーは
-- `edge_command_runs_admin_select`（super_admin のみ）だけだったので、
-- エッジは自分が書いた行を二度と見つけられない。
--   ・INSERT … with check だけ → 通る
--   ・UPDATE … using に加えて SELECT ポリシーが要る → 0 行一致
--
-- ⚠ **0 行一致の UPDATE はエラーではない。** PostgREST は 204 を返し、
--   supabase-js の `error` は null。エッジ側の `recordFinish` は
--   `if (error)` でしか見ていなかったので、**失敗を1行も記録できていない状態が
--   完全に無音**だった。書いたのは私で、外部レビュー #6 の是正そのものが
--   「仕組みはあるが動いておらず、沈黙が正常と区別できない」形になっていた。
--
-- ── 是正 ────────────────────────────────────────────────────────────────
-- エッジに自分の行の SELECT を許す。読めるのは**自分が書いた受領記録**だけで、
-- 他エッジ・他テナントには広がらない（edge_jobs と同じ形）。
--
-- 適用済み migration は書き換えない方針のため、新しい migration で足す。
--
-- 同じ形（エッジが UPDATE を持つが SELECT が無い表）が他に無いことは
-- pg_policies の掃き出しで確認済み。該当は本表のみで、`edge_jobs` は
-- 当初から `edge_jobs_edge_select` を持っている。
drop policy if exists edge_command_runs_edge_select on public.edge_command_runs;
create policy edge_command_runs_edge_select on public.edge_command_runs
  for select to authenticated
  using (((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid) = edge_id);

comment on policy edge_command_runs_edge_select on public.edge_command_runs is
  'エッジが自分の受領記録を決着（update）できるようにするために必須。UPDATE ... WHERE は SELECT ポリシーも要求するため、これが無いと update が 0 行一致で無音に失敗する。';
