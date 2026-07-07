-- 映像閲覧アクセスログ(G3)に「ページ閲覧」種別を追加。
-- patrol_view = 巡回レポートの画像閲覧（モーダル）、bcp_view = BCP詳細ページ閲覧。
-- 既存: alarm_snapshot / alarm_frame / patrol_snapshot / bcp_export。

alter table footage_access_log drop constraint if exists footage_access_log_access_type_check;
alter table footage_access_log add constraint footage_access_log_access_type_check
  check (access_type in (
    'alarm_snapshot','alarm_frame','patrol_snapshot','bcp_export','patrol_view','bcp_view'
  ));
