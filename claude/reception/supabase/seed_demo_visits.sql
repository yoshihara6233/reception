-- ============================================================
-- Demo data v2: 手荷物検査（動画・未審査多数）を含む受付履歴
-- 実行: psql $DATABASE_URL -f supabase/seed_demo_visits.sql
--   または Supabase Dashboard > SQL Editor
-- ============================================================

DO $$
DECLARE
  v_tenant  UUID := '00000000-0000-0000-0000-000000000001';
  v_store1  UUID := '00000000-0000-0000-0000-000000000010';
  v_area1   UUID := '00000000-0000-0000-0000-000000000100';
  v_store2  UUID;
  v_store3  UUID;
  v_area2   UUID;
  v_area3   UUID;

  -- 来訪者データ
  companies  TEXT[] := ARRAY[
    '株式会社テクノソリューションズ','山田システム株式会社','株式会社グリーンロジスティクス',
    'フューチャーデザイン合同会社','東京マーケティング株式会社','株式会社ブルースカイ',
    'サンライズ電機株式会社','株式会社アルファテック','株式会社ネクストビジョン',
    'スマートリンク株式会社','有限会社タケダ商事','株式会社プロフィットウェア',
    '富士通サービス株式会社','株式会社グローバルオフィス','ミライ建設株式会社',
    '株式会社インフィニティ','京都クリエイティブ株式会社','株式会社デジタルブリッジ',
    'ノバエンジニアリング株式会社','株式会社ライトハウス'
  ];
  departments TEXT[] := ARRAY[
    '営業部','技術部','総務部','経理部','企画部',NULL,NULL,'システム部','サービス部','品質管理部'
  ];
  given_names TEXT[] := ARRAY[
    '太郎','花子','次郎','美咲','健一','由美','誠','奈々','浩','さくら',
    '翔','茜','大輔','恵','達也','杏','俊介','麻衣','賢司','亜希子',
    '修','彩','正樹','幸子','博','千恵','徹','和子','勇','恵美'
  ];
  family_names TEXT[] := ARRAY[
    '田中','鈴木','佐藤','山田','渡辺','中村','小林','加藤','吉田','松田',
    '伊藤','清水','高橋','橋本','近藤','岡田','遠藤','石川','坂本','後藤'
  ];
  purposes TEXT[] := ARRAY[
    '配送','メンテナンス','商談','監査','その他',
    '定期点検','機器設置','契約更新','打ち合わせ','納品確認'
  ];
  decl_texts TEXT[] := ARRAY[
    'ノートPC、電源アダプター、USBハブ',
    'カメラ機材（一眼レフ・レンズ2本）、三脚',
    '書類一式、iPad、スタイラスペン',
    'サンプル商品 3点（箱入り）',
    '工具セット、デジタル測定器',
    '保守部品（基板ユニット）、テスター',
    '販促資材、カタログ一式',
    '飲料水 6本、弁当',
    'ポータブル電源、延長ケーブル',
    '医療機器部品、滅菌袋入り'
  ];

  -- ループ変数
  i              INT;
  j              INT;
  v_day          DATE;
  v_hour         INT;
  v_min          INT;
  v_ci           TIMESTAMPTZ;
  v_co           TIMESTAMPTZ;
  v_status       TEXT;
  v_dur          INT;
  v_visitor      UUID;
  v_visit        UUID;
  v_company      TEXT;
  v_dept         TEXT;
  v_fname        TEXT;
  v_gname        TEXT;
  v_purpose      TEXT;
  v_store        UUID;
  v_area         UUID;
  v_dow          INT;
  v_visits_today INT;
  v_days_ago     INT;
  v_bd_status    TEXT;
  v_insp_mode    TEXT;
  v_decl_text    TEXT;
  v_bd_context   TEXT;
BEGIN

  -- ── 既存デモデータを削除 ─────────────────────────────────────────────────
  DELETE FROM baggage_declarations
    WHERE tenant_id = v_tenant;
  DELETE FROM visit_photos
    WHERE tenant_id = v_tenant;
  DELETE FROM visits
    WHERE tenant_id = v_tenant;
  DELETE FROM visitors
    WHERE tenant_id = v_tenant;

  RAISE NOTICE '既存デモデータを削除しました';

  -- ── 店舗2・3を確保 ───────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM stores WHERE tenant_id = v_tenant AND name = '新宿店') THEN
    v_store2 := gen_random_uuid();
    INSERT INTO stores (id, tenant_id, name, address)
      VALUES (v_store2, v_tenant, '新宿店', '東京都新宿区西新宿2-1-1');
    v_area2 := gen_random_uuid();
    INSERT INTO areas (id, store_id, tenant_id, name, qr_token)
      VALUES (v_area2, v_store2, v_tenant, '管理エリア入口', 'demo-qr-token-xyz789');
  ELSE
    SELECT id INTO v_store2 FROM stores WHERE tenant_id = v_tenant AND name = '新宿店';
    SELECT id INTO v_area2  FROM areas  WHERE store_id = v_store2 LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM stores WHERE tenant_id = v_tenant AND name = '池袋店') THEN
    v_store3 := gen_random_uuid();
    INSERT INTO stores (id, tenant_id, name, address)
      VALUES (v_store3, v_tenant, '池袋店', '東京都豊島区南池袋1-28-1');
    v_area3 := gen_random_uuid();
    INSERT INTO areas (id, store_id, tenant_id, name, qr_token)
      VALUES (v_area3, v_store3, v_tenant, 'バックヤード', 'demo-qr-token-ijk456');
  ELSE
    SELECT id INTO v_store3 FROM stores WHERE tenant_id = v_tenant AND name = '池袋店';
    SELECT id INTO v_area3  FROM areas  WHERE store_id = v_store3 LIMIT 1;
  END IF;

  -- ── 来訪者 30名を挿入 ────────────────────────────────────────────────────
  FOR i IN 1..30 LOOP
    v_company := companies[1 + ((i - 1) % array_length(companies, 1))];
    v_dept    := departments[1 + ((i * 3) % array_length(departments, 1))];
    v_fname   := family_names[1 + ((i - 1) % array_length(family_names, 1))];
    v_gname   := given_names [1 + ((i - 1) % array_length(given_names,  1))];

    INSERT INTO visitors (tenant_id, company, department, name, phone, email)
    VALUES (
      v_tenant,
      v_company,
      v_dept,
      v_fname || ' ' || v_gname,
      '0' || (90000000 + i * 123456 % 9999999)::TEXT,
      lower(v_fname) || i::TEXT || '@example.com'
    );
  END LOOP;

  RAISE NOTICE '来訪者 30名を挿入しました';

  -- ── 過去90日分の来訪データ ───────────────────────────────────────────────
  -- 手荷物検査（動画・未審査）を充実させる設計:
  --   - 手荷物申告率: 60%
  --   - 動画モード: 65% / 写真モード: 35%
  --   - 審査ステータス:
  --       直近7日:   pending 85%, flagged 10%, cleared 5%
  --       8〜30日前: pending 55%, flagged 25%, cleared 20%
  --       31〜90日前: pending 10%, flagged 30%, cleared 60%

  FOR v_day IN
    SELECT d::DATE
    FROM generate_series(
      (CURRENT_DATE - INTERVAL '90 days')::DATE,
      CURRENT_DATE,
      '1 day'::INTERVAL
    ) d
  LOOP
    v_dow     := EXTRACT(DOW FROM v_day)::INT;  -- 0=Sun, 6=Sat
    v_days_ago := (CURRENT_DATE - v_day)::INT;

    -- 土日は稀（約15%の確率で1件）
    IF v_dow IN (0, 6) THEN
      IF random() > 0.15 THEN CONTINUE; END IF;
      v_visits_today := 1;
    ELSE
      -- 平日: 2〜5件
      v_visits_today := 2 + floor(random() * 4)::INT;
    END IF;

    FOR j IN 1..v_visits_today LOOP

      -- 来訪者をランダムに選択
      SELECT id INTO v_visitor
      FROM visitors
      WHERE tenant_id = v_tenant
      ORDER BY random()
      LIMIT 1;

      IF v_visitor IS NULL THEN CONTINUE; END IF;

      -- 業務時間帯 (9:00〜18:00)
      v_hour := 9 + floor(random() * 9)::INT;
      v_min  := floor(random() * 60)::INT;
      v_ci   := (v_day::TIMESTAMPTZ + make_interval(hours => v_hour, mins => v_min))
                AT TIME ZONE 'Asia/Tokyo';

      -- 滞在時間: 20分〜2時間
      v_dur := 20 + floor(random() * 100)::INT;

      -- 退室状況
      IF v_days_ago > 7 THEN
        -- 7日より前: 全て退室済み
        v_status := CASE WHEN random() < 0.03 THEN 'auto_closed' ELSE 'checked_out' END;
        v_co := v_ci + make_interval(mins => v_dur);
      ELSIF v_day = CURRENT_DATE THEN
        -- 本日: 35%がまだ入室中
        v_status := CASE WHEN random() < 0.35 THEN 'checked_in' ELSE 'checked_out' END;
        v_co := CASE WHEN v_status = 'checked_out' THEN v_ci + make_interval(mins => v_dur) ELSE NULL END;
      ELSE
        v_status := 'checked_out';
        v_co := v_ci + make_interval(mins => v_dur);
      END IF;

      -- 店舗をランダム選択（均等配分）
      CASE (j + extract(doy from v_day)::INT) % 3
        WHEN 0 THEN v_store := v_store1; v_area := v_area1;
        WHEN 1 THEN v_store := v_store2; v_area := v_area2;
        ELSE        v_store := v_store3; v_area := v_area3;
      END CASE;

      v_purpose := purposes[1 + (j + extract(doy from v_day)::INT) % array_length(purposes, 1)];

      INSERT INTO visits (
        tenant_id, visitor_id, store_id, area_id,
        purpose, status, check_in_at, check_out_at
      )
      VALUES (
        v_tenant, v_visitor, v_store, v_area,
        v_purpose, v_status, v_ci, v_co
      )
      RETURNING id INTO v_visit;

      -- ── 手荷物申告: 60% の確率で追加 ────────────────────────────────────
      IF random() < 0.60 THEN

        -- 申告内容
        v_decl_text := decl_texts[1 + floor(random() * array_length(decl_texts, 1))::INT
                                      % array_length(decl_texts, 1)];

        -- 検査モード: 65% 動画、35% 写真
        v_insp_mode := CASE WHEN random() < 0.65 THEN 'video' ELSE 'photo' END;

        -- 審査ステータス（日数による重み付け）
        v_bd_status := CASE
          WHEN v_days_ago <= 7  THEN
            CASE WHEN random() < 0.85 THEN 'pending'
                 WHEN random() < 0.67 THEN 'flagged'
                 ELSE 'cleared' END
          WHEN v_days_ago <= 30 THEN
            CASE WHEN random() < 0.55 THEN 'pending'
                 WHEN random() < 0.56 THEN 'flagged'
                 ELSE 'cleared' END
          ELSE -- 31〜90日前
            CASE WHEN random() < 0.10 THEN 'pending'
                 WHEN random() < 0.33 THEN 'flagged'
                 ELSE 'cleared' END
        END;

        -- 入室時の申告
        INSERT INTO baggage_declarations (
          visit_id, tenant_id, context,
          inspection_mode, declaration_text, status,
          reviewed_at, staff_notes,
          created_at
        ) VALUES (
          v_visit, v_tenant, 'checkin',
          v_insp_mode,
          v_decl_text,
          v_bd_status,
          CASE WHEN v_bd_status != 'pending'
               THEN v_ci + make_interval(mins => floor(random() * 60 + 30)::INT)
               ELSE NULL END,
          CASE WHEN v_bd_status = 'flagged' AND random() < 0.6
               THEN CASE floor(random() * 4)::INT
                      WHEN 0 THEN '要確認: 申告外の品目が見受けられる'
                      WHEN 1 THEN '上長に報告済み'
                      WHEN 2 THEN '再検査実施、問題なしと判断'
                      ELSE        '経緯を記録中'
                    END
               ELSE NULL END,
          v_ci
        );

        -- 退室時の申告: 30% の確率で追加（退室済みの場合のみ）
        IF v_status IN ('checked_out', 'auto_closed') AND random() < 0.30 THEN

          v_insp_mode := CASE WHEN random() < 0.65 THEN 'video' ELSE 'photo' END;

          -- 退室時は入室時より少し審査済み比率を高める
          v_bd_status := CASE
            WHEN v_days_ago <= 7  THEN
              CASE WHEN random() < 0.75 THEN 'pending'
                   WHEN random() < 0.60 THEN 'flagged'
                   ELSE 'cleared' END
            WHEN v_days_ago <= 30 THEN
              CASE WHEN random() < 0.45 THEN 'pending'
                   WHEN random() < 0.50 THEN 'flagged'
                   ELSE 'cleared' END
            ELSE
              CASE WHEN random() < 0.08 THEN 'pending'
                   WHEN random() < 0.30 THEN 'flagged'
                   ELSE 'cleared' END
          END;

          INSERT INTO baggage_declarations (
            visit_id, tenant_id, context,
            inspection_mode, declaration_text, status,
            reviewed_at, staff_notes,
            created_at
          ) VALUES (
            v_visit, v_tenant, 'checkout',
            v_insp_mode,
            v_decl_text,
            v_bd_status,
            CASE WHEN v_bd_status != 'pending'
                 THEN v_co + make_interval(mins => floor(random() * 20 + 5)::INT)
                 ELSE NULL END,
            CASE WHEN v_bd_status = 'flagged' AND random() < 0.5
                 THEN '退室時フラグ: 追加品目を確認'
                 ELSE NULL END,
            COALESCE(v_co, v_ci + make_interval(mins => v_dur))
          );
        END IF;

      END IF; -- 手荷物申告

    END LOOP; -- j (visits per day)
  END LOOP; -- v_day

  -- ── サマリー出力 ─────────────────────────────────────────────────────────
  RAISE NOTICE '--- デモデータ生成完了 ---';
  RAISE NOTICE '来訪者: % 名', (SELECT count(*) FROM visitors WHERE tenant_id = v_tenant);
  RAISE NOTICE '来訪: % 件',   (SELECT count(*) FROM visits WHERE tenant_id = v_tenant);
  RAISE NOTICE '手荷物申告 合計: % 件', (SELECT count(*) FROM baggage_declarations WHERE tenant_id = v_tenant);
  RAISE NOTICE '  うち 動画モード: % 件', (SELECT count(*) FROM baggage_declarations WHERE tenant_id = v_tenant AND inspection_mode = 'video');
  RAISE NOTICE '  うち 写真モード: % 件', (SELECT count(*) FROM baggage_declarations WHERE tenant_id = v_tenant AND inspection_mode = 'photo');
  RAISE NOTICE '  うち 未審査(pending): % 件', (SELECT count(*) FROM baggage_declarations WHERE tenant_id = v_tenant AND status = 'pending');
  RAISE NOTICE '  うち フラグ(flagged): % 件', (SELECT count(*) FROM baggage_declarations WHERE tenant_id = v_tenant AND status = 'flagged');
  RAISE NOTICE '  うち 問題なし(cleared): % 件', (SELECT count(*) FROM baggage_declarations WHERE tenant_id = v_tenant AND status = 'cleared');
END $$;
