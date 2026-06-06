-- F78 / 全国版デモデータ — 100 店舗、47 都道府県カバー
--
-- 目的
--   営業デモ + 展示会 + UI スクリーンショット用に、地理分布と業種が多様な
--   ダミー店舗を投入する。実 PoC データ (Beelink + H.VIEW = リテール
--   '○○本店' 等) はそのまま残し、追加で 100 店舗を作る。
--
-- 設計判断
--   - 47 都道府県すべてに最低 1 店舗。主要都市 (東京/大阪/名古屋/福岡/札幌等) は厚め。
--   - 業種ミックス: リテール / マート / ドラッグ / 電気 / ホーム / アパレル等。
--     チェーン名はすべて架空 ('リテール札幌中央店' のように地名を含む)。
--   - NVR ベンダー分布は日本市場の概算: i-PRO 40% / Hikvision 20% /
--     Hanwha 10% / Uniview 10% / Axis 5% / Frigate 5% / Dahua 5% / 他 5%。
--   - エッジ稼働状況: online/idle 70%, grid 10%, offline 15%, error 5%。
--     5% は central_aggregator モードでエッジ無し。
--   - 緯度経度は実在の市街地中心 ± 0.005° (おおよそ ±500m) のランダム
--     オフセットを SQL の random() で付与し、地図上で重ならないようにする。
--
-- 安全性
--   - ON CONFLICT DO NOTHING — 同じ name の店舗があれば skip。
--   - tenant_id は (SELECT id FROM tenants LIMIT 1) で自動解決。
--     テナントが 1 つも無ければ何も挿入されない (NULL 制約があれば fail)。
--   - 削除したくなったら DELETE FROM stores WHERE name LIKE '%デモ店%' OR
--     id IN (SELECT store_id FROM edge_devices WHERE name LIKE 'demo-edge-%');

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 100 店舗を一括挿入
-- ────────────────────────────────────────────────────────────────────────────

with demo_tenant as (
  -- デモ専用テナントを 1 つ用意 (既存があればそれを使う)
  insert into public.tenants (id, name, slug)
  select gen_random_uuid(), 'デモ全国チェーン', 'demo-nationwide'
   where not exists (select 1 from public.tenants where slug = 'demo-nationwide')
  returning id
), tenant_id as (
  select id from demo_tenant
  union all
  select id from public.tenants where slug = 'demo-nationwide'
  limit 1
), seed (name, address, area_code, lat, lng, vendor, model, mode, status) as (
  values
  -- ── 北海道 (5) ──────────────────────────────────────────────────────────
  ('リテール札幌中央デモ店',  '札幌市中央区南3条西4-1',     'JP-01', 43.0642, 141.3469, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('マート札幌北デモ店',      '札幌市北区北24条西7-2',      'JP-01', 43.0934, 141.3469, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール函館駅前デモ店',  '函館市若松町12-13',          'JP-01', 41.7687, 140.7288, 'frigate',   null,            'per_store_minipc',    'grid'),
  ('ドラッグ旭川デモ店',      '旭川市1条通8-108',           'JP-01', 43.7708, 142.3650, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'offline'),
  ('リテール帯広デモ店',      '帯広市西2条南11-13',         'JP-01', 42.9234, 143.1969, 'ipro',      'WJ-NX200K',     'per_store_minipc',    'idle'),
  -- ── 東北 (10) ───────────────────────────────────────────────────────────
  ('リテール青森駅前デモ店',  '青森市新町1-1',              'JP-02', 40.8244, 140.7400, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('マート弘前城前デモ店',    '弘前市下白銀町2-1',          'JP-02', 40.6033, 140.4642, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('リテール盛岡駅前デモ店',  '盛岡市盛岡駅前通1-44',       'JP-03', 39.7036, 141.1527, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール仙台駅前デモ店',  '仙台市青葉区中央1-3-1',      'JP-04', 38.2682, 140.8694, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'grid'),
  ('電気仙台青葉デモ店',      '仙台市青葉区一番町3-7-1',    'JP-04', 38.2685, 140.8714, 'axis',      'S2208',         'per_store_minipc',    'idle'),
  ('ホーム仙台泉デモ店',      '仙台市泉区泉中央1-5-1',      'JP-04', 38.3050, 140.8806, 'dahua',     'DH-NVR5216',    'per_store_minipc',    'offline'),
  ('マート秋田中央デモ店',    '秋田市中通2-3-8',            'JP-05', 39.7186, 140.1023, 'ipro',      'WJ-NX200K',     'per_store_minipc',    'idle'),
  ('リテール山形駅前デモ店',  '山形市香澄町1-1-1',          'JP-06', 38.2554, 140.3396, 'frigate',   null,            'per_store_minipc',    'idle'),
  ('リテール福島駅前デモ店',  '福島市栄町1-1',              'JP-07', 37.7503, 140.4676, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'error'),
  ('ドラッグ郡山デモ店',      '郡山市駅前1-1-1',            'JP-07', 37.4001, 140.3597, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  -- ── 関東 (25) ───────────────────────────────────────────────────────────
  ('リテール水戸デモ店',      '水戸市三の丸1-4-1',          'JP-08', 36.3418, 140.4468, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('電気つくばデモ店',        'つくば市吾妻1-7-1',          'JP-08', 36.0835, 140.0764, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール宇都宮デモ店',    '宇都宮市馬場通り4-1-1',      'JP-09', 36.5658, 139.8836, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('マート前橋デモ店',        '前橋市本町2-2-12',           'JP-10', 36.3911, 139.0608, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'idle'),
  ('リテール高崎デモ店',      '高崎市八島町1-1',            'JP-10', 36.3219, 139.0033, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'grid'),
  ('リテールさいたま新都心デモ店','さいたま市大宮区桜木町1-7-5','JP-11', 35.8616, 139.6455, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('ホーム川越デモ店',        '川越市新富町1-22',           'JP-11', 35.9251, 139.4856, 'frigate',   null,            'per_store_minipc',    'idle'),
  ('リテール大宮駅前デモ店',  'さいたま市大宮区桜木町1-7-2','JP-11', 35.9067, 139.6242, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール千葉中央デモ店',  '千葉市中央区中央1-1-1',      'JP-12', 35.6074, 140.1065, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('マート船橋デモ店',        '船橋市本町6-2-1',            'JP-12', 35.6936, 139.9883, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'offline'),
  ('ドラッグ柏デモ店',        '柏市旭町1-7-1',              'JP-12', 35.8676, 139.9784, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'idle'),
  ('リテール新宿西口デモ店',  '新宿区西新宿1-1-3',          'JP-13', 35.6938, 139.7035, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'grid'),
  ('電気新宿東口デモ店',      '新宿区新宿3-38-1',           'JP-13', 35.6940, 139.7050, 'axis',      'S2208',         'per_store_minipc',    'idle'),
  ('アパレル渋谷スクランブルデモ店','渋谷区道玄坂2-1-1',    'JP-13', 35.6580, 139.7016, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'grid'),
  ('マート渋谷桜丘デモ店',    '渋谷区桜丘町1-5',            'JP-13', 35.6553, 139.6960, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール池袋駅前デモ店',  '豊島区南池袋1-28-1',         'JP-13', 35.7295, 139.7109, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('リテール銀座デモ店',      '中央区銀座4-6-16',           'JP-13', 35.6717, 139.7651, 'axis',      'S2208',         'per_store_minipc',    'idle'),
  ('リテール上野デモ店',      '台東区上野4-9-1',            'JP-13', 35.7141, 139.7774, 'frigate',   null,            'per_store_minipc',    'idle'),
  ('電気秋葉原デモ店',        '千代田区外神田1-15-9',       'JP-13', 35.6985, 139.7731, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'grid'),
  ('リテール品川デモ店',      '港区高輪3-26-27',            'JP-13', 35.6285, 139.7387, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('ドラッグ立川デモ店',      '立川市曙町2-1-1',            'JP-13', 35.6981, 139.4194, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'idle'),
  ('リテール八王子デモ店',    '八王子市旭町1-1',            'JP-13', 35.6552, 139.3389, 'ipro',      'WJ-NX200K',     'per_store_minipc',    'error'),
  ('リテール横浜駅前デモ店',  '横浜市西区南幸1-1-1',        'JP-14', 35.4438, 139.6380, 'ipro',      'WJ-NX300K',     'central_aggregator',  'idle'),
  ('電気みなとみらいデモ店',  '横浜市西区みなとみらい2-3-5','JP-14', 35.4561, 139.6317, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('マート川崎駅前デモ店',    '川崎市川崎区駅前本町26-1',   'JP-14', 35.5308, 139.7029, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('ホーム横須賀デモ店',      '横須賀市本町2-1',            'JP-14', 35.2820, 139.6651, 'dahua',     'DH-NVR5216',    'per_store_minipc',    'offline'),
  ('リテール鎌倉デモ店',      '鎌倉市御成町1-15',           'JP-14', 35.3194, 139.5471, 'frigate',   null,            'per_store_minipc',    'idle'),
  -- ── 中部 (15) ───────────────────────────────────────────────────────────
  ('リテール新潟駅前デモ店',  '新潟市中央区花園1-1-1',      'JP-15', 37.9026, 139.0233, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('マート長岡デモ店',        '長岡市城内町2-787',          'JP-15', 37.4461, 138.8513, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール富山駅前デモ店',  '富山市新富町1-2-3',          'JP-16', 36.6953, 137.2113, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('リテール金沢駅前デモ店',  '金沢市木ノ新保町1-1',        'JP-17', 36.5611, 136.6564, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'grid'),
  ('ドラッグ福井デモ店',      '福井市中央1-2-1',            'JP-18', 36.0644, 136.2227, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'idle'),
  ('リテール甲府デモ店',      '甲府市丸の内1-1-8',          'JP-19', 35.6635, 138.5683, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('リテール長野駅前デモ店',  '長野市末広町1361',           'JP-20', 36.6485, 138.1949, 'frigate',   null,            'per_store_minipc',    'idle'),
  ('ホーム松本デモ店',        '松本市深志1-1-1',            'JP-20', 36.2381, 137.9716, 'ipro',      'WJ-NX200K',     'per_store_minipc',    'idle'),
  ('リテール岐阜デモ店',      '岐阜市橋本町2-52',           'JP-21', 35.4232, 136.7607, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール静岡駅前デモ店',  '静岡市葵区紺屋町17-1',       'JP-22', 34.9758, 138.3827, 'ipro',      'WJ-NX300K',     'central_aggregator',  'idle'),
  ('マート浜松デモ店',        '浜松市中央区砂山町6-1',      'JP-22', 34.7108, 137.7261, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('リテール沼津デモ店',      '沼津市大手町1-1-1',          'JP-22', 35.0954, 138.8635, 'axis',      'S2208',         'per_store_minipc',    'offline'),
  ('リテール名古屋駅前デモ店','名古屋市中村区名駅1-1-4',    'JP-23', 35.1814, 136.9067, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'grid'),
  ('電気栄デモ店',            '名古屋市中区栄3-29-1',       'JP-23', 35.1685, 136.9080, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール豊田駅前デモ店',  '豊田市西町1-1',              'JP-23', 35.0830, 137.1565, 'frigate',   null,            'per_store_minipc',    'idle'),
  -- ── 近畿 (20) ───────────────────────────────────────────────────────────
  ('リテール岡崎デモ店',      '岡崎市羽根町大池68-1',       'JP-23', 34.9558, 137.1727, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'idle'),
  ('マート津駅前デモ店',      '津市羽所町700',              'JP-24', 34.7185, 136.5057, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('リテール四日市デモ店',    '四日市市諏訪栄町7-34',       'JP-24', 34.9648, 136.6244, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('リテール大津駅前デモ店',  '大津市春日町1-3',            'JP-25', 35.0045, 135.8686, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('アパレル京都四条デモ店',  '京都市下京区四条通烏丸西入',  'JP-26', 35.0048, 135.7596, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'grid'),
  ('リテール京都駅前デモ店',  '京都市下京区東塩小路町901',  'JP-26', 35.0116, 135.7681, 'axis',      'S2208',         'per_store_minipc',    'idle'),
  ('リテール梅田デモ店',      '大阪市北区梅田3-1-1',        'JP-27', 34.7024, 135.4959, 'ipro',      'WJ-NX300K',     'central_aggregator',  'idle'),
  ('リテール難波デモ店',      '大阪市中央区難波5-1-60',     'JP-27', 34.6645, 135.5021, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'grid'),
  ('マート天王寺デモ店',      '大阪市天王寺区悲田院町10-39','JP-27', 34.6453, 135.5145, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('ホーム堺デモ店',          '堺市堺区戎島町3-22-1',       'JP-27', 34.5732, 135.4830, 'frigate',   null,            'per_store_minipc',    'idle'),
  ('リテール高槻デモ店',      '高槻市白梅町4-1',            'JP-27', 34.8460, 135.6172, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('リテール神戸三宮デモ店',  '神戸市中央区三宮町1-1-1',    'JP-28', 34.6951, 135.1948, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'grid'),
  ('電気姫路デモ店',          '姫路市駅前町188-1',          'JP-28', 34.8164, 134.6863, 'axis',      'S2208',         'per_store_minipc',    'idle'),
  ('リテール西宮デモ店',      '西宮市高松町5-15',           'JP-28', 34.7378, 135.3415, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール奈良デモ店',      '奈良市三条本町1-1-1',        'JP-29', 34.6851, 135.8049, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('リテール和歌山デモ店',    '和歌山市友田町5-18',         'JP-30', 34.2261, 135.1675, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'offline'),
  ('ドラッグ鳥取デモ店',      '鳥取市東品治町111',          'JP-31', 35.5011, 134.2378, 'ipro',      'WJ-NX200K',     'per_store_minipc',    'idle'),
  ('リテール松江デモ店',      '松江市朝日町472',            'JP-32', 35.4723, 133.0505, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('リテール岡山駅前デモ店',  '岡山市北区駅前町1-1-1',      'JP-33', 34.6618, 133.9344, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール広島本通デモ店',  '広島市中区基町6-78',         'JP-34', 34.3853, 132.4553, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  -- ── 中国・四国 (10) ────────────────────────────────────────────────────
  ('マート福山デモ店',        '福山市三之丸町30-1',         'JP-34', 34.4856, 133.3625, 'frigate',   null,            'per_store_minipc',    'idle'),
  ('リテール山口デモ店',      '山口市惣太夫町2-1',          'JP-35', 34.1858, 131.4715, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('リテール下関デモ店',      '下関市竹崎町4-3-1',          'JP-35', 33.9577, 130.9412, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('リテール徳島デモ店',      '徳島市寺島本町西1-61',       'JP-36', 34.0658, 134.5593, 'dahua',     'DH-NVR5216',    'per_store_minipc',    'idle'),
  ('リテール高松デモ店',      '高松市浜ノ町1-20',           'JP-37', 34.3401, 134.0434, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('ホーム松山デモ店',        '松山市湊町5-1-1',            'JP-38', 33.8392, 132.7657, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('リテール高知デモ店',      '高知市本町4-2-15',           'JP-39', 33.5597, 133.5311, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'error'),
  -- ── 九州・沖縄 (13) ────────────────────────────────────────────────────
  ('リテール博多駅前デモ店',  '福岡市博多区博多駅中央街1-1','JP-40', 33.5904, 130.4017, 'ipro',      'WJ-NX300K',     'central_aggregator',  'idle'),
  ('アパレル天神デモ店',      '福岡市中央区天神2-11-1',     'JP-40', 33.5912, 130.3992, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'grid'),
  ('リテール小倉デモ店',      '北九州市小倉北区魚町2-6-2',  'JP-40', 33.8835, 130.8751, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('マート久留米デモ店',      '久留米市東町33-1',           'JP-40', 33.3192, 130.5085, 'frigate',   null,            'per_store_minipc',    'idle'),
  ('リテール佐賀デモ店',      '佐賀市駅前中央1-11-25',      'JP-41', 33.2494, 130.2989, 'uniview',   'NVR302-16E2',   'per_store_minipc',    'idle'),
  ('リテール長崎デモ店',      '長崎市尾上町1-1',            'JP-42', 32.7503, 129.8779, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('ホーム佐世保デモ店',      '佐世保市三浦町2-1',          'JP-42', 33.1796, 129.7150, 'hanwha',    'XRN-3210B4',    'per_store_minipc',    'idle'),
  ('リテール熊本デモ店',      '熊本市中央区桜町3-19',       'JP-43', 32.8031, 130.7079, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'grid'),
  ('リテール大分デモ店',      '大分市要町1-38',             'JP-44', 33.2381, 131.6126, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('ドラッグ宮崎デモ店',      '宮崎市錦町1-10',             'JP-45', 31.9111, 131.4239, 'frigate',   null,            'per_store_minipc',    'idle'),
  ('リテール鹿児島デモ店',    '鹿児島市中央町1-1',          'JP-46', 31.5602, 130.5581, 'ipro',      'WJ-NX300K',     'per_store_minipc',    'idle'),
  ('リテール那覇国際通りデモ店','那覇市牧志3-2-10',        'JP-47', 26.2125, 127.6809, 'hikvision', 'DS-7716NI-K4',  'per_store_minipc',    'idle'),
  ('マート沖縄市デモ店',      '沖縄市中央2-1-1',            'JP-47', 26.3344, 127.8056, 'frigate',   null,            'per_store_minipc',    'idle')
)
insert into public.stores
  (id, tenant_id, name, address, area_code, latitude, longitude,
   nvr_vendor, nvr_model, deployment_mode, geocoded_at)
select
  gen_random_uuid(),
  (select id from tenant_id),
  s.name,
  s.address,
  s.area_code,
  -- ±0.005° (≈500 m) のランダムオフセットを足して地図上で重ならないようにする
  s.lat + (random() - 0.5) * 0.01,
  s.lng + (random() - 0.5) * 0.01,
  s.vendor,
  s.model,
  s.mode,
  now()
from seed s
where not exists (select 1 from public.stores existing where existing.name = s.name);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. エッジデバイスをデモ店舗の 95% に紐付け (central_aggregator はスキップ)
-- ────────────────────────────────────────────────────────────────────────────

with seed_status as (
  -- 上で入れた 'status' をエッジに反映させたいが、ここからは取れないので
  -- 適当に分布を再現する: 80% idle / 10% grid / 5% offline / 5% error
  select
    s.id                                            as store_id,
    'demo-edge-' || lower(substr(s.id::text, 1, 8)) as token,
    'デモエッジ-' || regexp_replace(s.name, 'デモ店$', '') as name,
    case
      when random() < 0.80 then 'idle'
      when random() < 0.90 then 'grid'
      when random() < 0.95 then 'offline'
      else                       'error'
    end as status
  from public.stores s
  where s.name like '%デモ店'
    and s.deployment_mode = 'per_store_minipc'
    and not exists (select 1 from public.edge_devices ed where ed.store_id = s.id)
)
insert into public.edge_devices
  (id, store_id, name, device_token, agent_version, status,
   last_seen_at, created_at, updated_at)
select
  gen_random_uuid(),
  ss.store_id,
  ss.name,
  ss.token,
  '0.9.0-demo',
  ss.status,
  -- offline は最終接続 6 時間前以上、それ以外は 30 秒以内に演出
  case when ss.status = 'offline'
       then now() - interval '6 hours' - (random() * interval '24 hours')
       else now() - (random() * interval '30 seconds')
  end,
  now() - (random() * interval '30 days'),
  now()
from seed_status ss;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. 動作確認用 SELECT (実行結果はマイグレーション本体には影響しない)
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_total int;
  v_with_edge int;
  v_central int;
begin
  select count(*) into v_total
    from public.stores where name like '%デモ店';
  select count(*) into v_with_edge
    from public.stores s
    join public.edge_devices ed on ed.store_id = s.id
   where s.name like '%デモ店';
  select count(*) into v_central
    from public.stores
   where name like '%デモ店' and deployment_mode = 'central_aggregator';

  raise notice 'F78 demo data: % stores inserted (% with edge, % central-aggregator)',
    v_total, v_with_edge, v_central;
end $$;
