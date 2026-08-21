// ─── Language types ───────────────────────────────────────────────────────────

export type Lang = 'ja' | 'en' | 'zh' | 'ko'

export const LANG_META: Record<Lang, { label: string; short: string; flag: string }> = {
  ja: { label: '日本語', short: '日本語', flag: '🇯🇵' },
  en: { label: 'English', short: 'EN',    flag: '🇺🇸' },
  zh: { label: '中文',   short: '中文',  flag: '🇨🇳' },
  ko: { label: '한국어', short: '한국어', flag: '🇰🇷' },
}

export const LANGS = Object.keys(LANG_META) as Lang[]

// ─── Message shape ────────────────────────────────────────────────────────────

export interface Msg {
  appName: string
  nav: {
    monitor:  string
    map:      string
    playback: string
    admin:    string
    logs:     string
    reports:  string
    settings: string
    // F22.1: top header tabs that were previously hardcoded JP
    infra:    string
    bcp:      string
    security: string
    // F24: header right-side icon labels (tooltips + aria-labels)
    logout:   string
  }
  kpi: {
    total:      string
    monitoring: string
    live:       string
    alerts:     string
    interrupted: string   // TC3: 監視中断のみのアラート数
    bcp:         string   // TC3: BCP/インシデント/巡回など監視中断以外
  }
  status: {
    offline: string
    idle:    string
    grid:    string
    live:    string
    vod:     string
    error:   string
    interrupted:   string   // TC3: 監視中断（異常）
    stopped:       string   // TC3: 監視停止（正常終了）
    recordingNote: string   // TC3: 録画は継続している旨
  }
  dashboard: {
    storeView:   string
    mapAlert:    string
    noStores:    string
    countUnit:   string            // appended after number: "10件" "10 stores"
    alertsN:     (n: number) => string
    noAlerts:    string
    allGood:     string
    loadingMap:  string
    // F26: map alert-zoom toggle
    alertZoomOn:  string   // 通常表示 → アラート店舗だけにズーム
    alertZoomOff: string   // ズーム中 → 全店舗表示に戻す
    alertZoomEmpty: string // 押せるが対象 0 件の時の補足
    // F26.2: バナー（zoomAlerts=ON だが地図に映せない時）
    alertZoomNoGeo: (n: number) => string  // アラートはあるが緯度経度未設定
    alertZoomNoAlerts: string              // そもそもアラート 0 件
  }
  alert: {
    edgeOffline:  string
    edgeError:    string
    unknownTime:  string
    secsAgo:      (n: number) => string
    minsAgo:      (n: number) => string
    hoursAgo:     (n: number) => string
    // F108: per-alert 種別ラベル
    kind: {
      edge_offline: string
      edge_error:   string
      bcp:          string
      incident:     string
      patrol:       string
    }
  }
  workspace: {
    split16:           string
    unclassified:      string
    edgeNotRegistered: string
    pressToStart:      string
    startMonitor:      string
    stopMonitor:       string
    mapLink:           string
    playbackBtn:       string
    playbackHint:      string
    cameras:           string   // "カメラ"
    camRange:          (from: number, to: number) => string
    gridUnavailable:     string   // grid composite fetch failed (404/502/edge offline)
    gridUnavailableHint: string   // reassure: auto-retrying + per-camera still works
    gridRetry:           string   // manual retry button
  }
  vod: {
    // ── Range picker modal (C4) ──
    modalTitle:  string   // "録画を再生"
    cameraLabel: string   // "カメラ"
    fromLabel:   string   // "開始時刻"
    rangeLabel:  string   // "再生時間"
    minutesUnit: string   // "分"
    maxLabel:    string   // "最大" (shown next to range cap)
    confirm:     string   // "再生する"
    cancel:      string   // "キャンセル"
    noVod:       string   // gate reason — no VOD-capable cameras (VOD_VENDORS 参照)
    // ── Player overlay states (DR2) ──
    connecting:       string   // initial black skeleton
    seeking:          string   // frozen frame + spinner (NEVER black)
    noRecordingTitle: string   // 録画なし
    cannotPlayTitle:  string   // 接続不可 / no-frames timeout
    endedTitle:       string   // 再生終了 (reached to_iso)
    retry:            string   // 接続不可 primary action
    watchAgain:       string   // 再生終了 primary action
    pickAnother:      string   // 録画なし primary action
    backToMonitor:    string   // secondary action (all states)
  }
  drawer: {
    title:    string
    noStores: string
  }
  offline: {
    title:  string
    body:   string
    retry:  string
  }
  // ── F22: per-section left-sidebar nav labels ──
  adminNav: { dashboard: string; stores: string; edges: string; recorders: string; users: string; csvImport: string; audit: string; limits: string }
  securityNav: { triage: string; reports: string; settings: string; cameras: string; glossary: string }
  // F38: /security 上部解説バナー
  securityHelp: {
    title: string
    body: string
    learnMore: string
  }
  // F38: /security/glossary 用語説明
  securityGlossary: {
    title: string
    intro: string
    crumb: string
  }
  bcpNav: { eventsReports: string; jalerts: string; testIssue: string; glossary: string }
  // F36: /bcp の上部に表示する J-Alert フロー解説 (短文)
  bcpHelp: {
    title: string
    body: string
    learnMore: string  // 用語集へのリンクラベル
  }
  // F36: /bcp/glossary 用語説明ページ
  bcpGlossary: {
    title: string
    intro: string
    crumb: string
  }
  infraNav: { dashboard: string; incidents: string; checks: string; reports: string; settings: string; glossary: string }
  navTitle: { admin: string; security: string; bcp: string; infra: string }
  // ── F22: common UI atoms ──
  common: { open: string; notGenerated: string; dash: string }
  // ── F22: /infra/incidents ──
  infraIncidents: {
    title: string
    sectionOpen:     (n: number) => string
    sectionAck:      (n: number) => string
    sectionResolved: (n: number) => string
    emptyOpen: string; emptyAck: string; emptyResolved: string
    statusOpen: string; statusAck: string; statusResolved: string
    severityInfo: string; severityWarn: string; severityDanger: string
    colTime: string; colStore: string; colTarget: string; colKind: string; colSeverity: string; colStatus: string; colDetail: string
    tenantLabel: string
  }
  // ── F22: /infra/checks ──
  infraChecks: {
    title: string
    statRegistered: string; statEnabled: string; statFailing: string
    empty: string
    colStore: string; colTarget: string; colCheckType: string; colInterval: string; colStatus: string; colConsecFail: string; colLastRun: string
    enabled: string; disabled: string; intervalSuffix: string
    checkLabel: { heartbeat: string; ping: string; probe_camera: string; storage: string; recording_gap: string; ntp: string; tamper: string; version: string }
  }
  // ── F22: /infra/reports ──
  infraReports: {
    title: string; empty: string
    colStore: string; colKind: string; colPeriod: string; colGenerated: string; colPdf: string; colEmails: string
    kindDaily: string; kindWeekly: string; kindMonthly: string
  }
  // ── F22: /security/reports ──
  securityReports: {
    title: string
    statRegistered: string; statTotalRuns: string; statTotalRunsSub: (done: number) => string
    statAnomalies: string; statReviews: string
    empty: string
    colStore: string; colPeriod: string; colGenerated: string; colRuns: string; colDone: string; colAnomalies: string; colReviews: string; colPdf: string; colEmails: string
  }
  breadcrumb: { admin: string; security: string; bcp: string; infra: string; infraIncidents: string; infraChecks: string; infraReports: string; securityReports: string }
  // ── F22.1: /infra dashboard ──
  infraDashboard: {
    title: string
    healthLabel: { ok: string; warn: string; fail: string; unk: string; maint: string }
    networkOutageTitle: string
    networkOutageBody: string
    statMonitored: string
    statOpen: string
    statUptime30d: string
    statActiveChecks: string
    activeChecksP2: string
    legendStatus: string
    allHealthyTitle: (n: number) => string
    allHealthyBody: string
    colStore: string; colEdge: string; colRecorder: string; colCamera: string; colOpen: string; colLastSeen: string
    notMonitored: string
    inMaintenance: string
    incidentCount: (n: number) => string
    clockSkew: (sec: string) => string
    emptyStores: string
    footerNote: string
  }
  // ── F22.1: /security triage dashboard ──
  securityTriage: {
    title: string
    statTotalStores: string
    statAlerting: string
    statAllNormal: string
    statRunsToday: string
    statUnconfirmed: string
    statAiCoverage: string
    sectionAlerts: string
    sectionNormal: string
    emptyAlerts: string
    emptyNormal: string
    colStore: string; colCam: string; colKind: string; colSnapshot: string; colTime: string; colReviewed: string
    snapshot: string
    reviewed: string
    notReviewed: string
    allNormalTitle: string
    allNormalBody: string
    colLastRun: string
    colStatus: string
    statusNormal: string
    waitingForPatrol: string
    noStoresYet: string
    noStoresSettingsLink: string
  }
  // ── F22.1: /security settings ──
  securitySettings: {
    title: string
    intro: string
    sectionStores: string
    colStore: string; colEnabled: string; colInterval: string; colReviewSla: string; colAutoReport: string
    empty: string
    noPatrol: string
  }
  // ── F22.1: /security cameras ──
  securityCameras: {
    title: string
    intro: string
    statCameras: string; statEnabled: string; statRecording: string
    colStore: string; colCamName: string; colVendor: string; colRecording: string; colPatrol: string
    empty: string
    promptNotice: string
    unassigned: string
    storeWithCount: (n: number) => string
    colCamera: string
    colPatrolShort: string
    colPrompt: string
    colSensitivity: string
    colBaselineUrls: string
  }
  // ── F22.1: /infra settings ──
  infraSettings: {
    title: string
    intro: string
    sectionStores: string
    colStore: string; colEnabled: string; colEdgeThreshold: string; colMaintUntil: string
    empty: string
    minutesUnit: string
  }
  // ── F22.1: /infra glossary ──
  infraGlossary: {
    title: string
    intro: string
  }
  // ── F22.1: /bcp dashboard ──
  bcpDashboard: {
    title: string
    testIssueBtn: string
    tabReports: string
    tabEvents: string
    statTotal: string; statOpen: string; statResolved: string; statClips: string
    statGeneratedReports: string
    statPdfDelivered: string
    sectionEvents: string
    sectionReports: string
    emptyEvents: string
    emptyEventsTitle: string
    emptyEventsBody: string
    emptyReports: string
    emptyReportsTitle: string
    emptyReportsBody: string
    colTime: string; colStore: string; colEventKind: string; colStatus: string; colReports: string
    colAlertType: string
    colIssuedAt: string
    colArea: string
    colIntensity: string
    colKind: string
    colGeneratedAt: string
    colRecipients: string
    colActions: string
    statusOpen: string; statusInProgress: string; statusResolved: string
    statusPending: string
    statusRecording: string
    statusClipsUploaded: string
    statusReportGenerated: string
    statusCompleted: string
    statusFailed: string
    severityInfo: string; severityWarn: string; severityDanger: string
    alertTypeSpecialWarning: string
    /** 過去イベントの表示にだけ使う（2026-08-21 に発動対象から外した）。 */
    alertTypeTsunami: string
    alertTypeEarthquake: string
    /** 過去イベントの表示にだけ使う（2026-08-21 に発動対象から外した）。 */
    alertTypeMissile: string
    alertTypeTest: string
    testBadge: string
    detail: string
    pdfLabel: string
    notSent: string
    recipientsCount: (n: number) => string
    open: string
    // F37: events tab tree view
    colStoreCount: string
    storeCountValue: (n: number) => string
    statusPartial: string
    expandAria: string
    collapseAria: string
  }
  // ── F22.1: /bcp/test ──
  bcpTest: {
    title: string
    intro: string
    formStoreLabel: string
    formKindLabel: string
    formSeverityLabel: string
    formNoteLabel: string
    formSubmit: string
    formCancel: string
    sentTitle: string
    sentBody: string
    crumb: string
    backLink: string
  }
  // ── F22.1: admin pages (master management) ──
  adminDashboard: {
    title: string
    statStores: string; statEdges: string; statRecorders: string; statUsers: string
    statCameras: string; statOnline: string; statOffline: string
    quickLinksTitle: string
  }
  adminStores: {
    title: string
    addBtn: string
    csvImportBtn: string
    searchPlaceholder: string
    areaPlaceholder: string
    filterBtn: string
    editLink: string
    notSet: string
    showingLimit: string
    colName: string; colCode: string; colArea: string; colEdges: string; colRecorders: string; colStatus: string
    colAddress: string
    colGeo: string
    colActive: string
    empty: string
  }
  adminEdges: {
    title: string
    addBtn: string
    searchPlaceholder: string
    allStatuses: string
    filterBtn: string
    editLink: string
    colName: string; colStore: string; colStatus: string; colLastSeen: string; colVersion: string
    colArea: string
    colRecorders: string
    empty: string
  }
  adminRecorders: {
    title: string
    colName: string; colStore: string; colVendor: string; colCameras: string
    empty: string
  }
  adminUsers: {
    title: string
    searchPlaceholder: string
    allRoles: string
    filterBtn: string
    clearBtn: string
    showingLimit: string
    colName: string
    colTenant: string
    colStoreCount: string
    colAuth: string
    colEmail: string; colRole: string; colCreated: string
    allStores: string
    authVerified: string
    authNotLinked: string
    roleSuperAdmin: string
    roleTenantAdmin: string
    roleStoreManager: string
    roleViewer: string
    empty: string
  }
  adminImport: {
    title: string
    intro: string
  }
  adminAudit: {
    title: string
    colTime: string; colActor: string; colAction: string; colTarget: string; colDetail: string
    empty: string
    totalSessions: (n: number) => string
    filterPrefix: string
    modeAll: string
    modeGrid: string
    modeLive: string
    modeVod: string
    colUserId: string
    colStore: string
    colMode: string
    colCamera: string
    colStartedAt: string
    colEndedAt: string
    colDuration: string
    sessionActive: string
    pagination: (curr: number, total: number) => string
    prev: string
    next: string
  }
}

// ─── Japanese ────────────────────────────────────────────────────────────────

const ja: Msg = {
  appName: 'Monitor',
  nav: {
    monitor:  'MONITOR',
    map:      '地図',
    playback: '再生',
    admin:    '設定',
    logs:     'ログ',
    reports:  'レポート',
    settings: '設定',
    infra:    '死活監視',
    bcp:      'BCP',
    security: 'PATROL',
    logout:   'ログアウト',
  },
  kpi: {
    total:      '全店舗',
    monitoring: '監視中',
    live:       'LIVE',
    alerts:     'アラート',
    interrupted: '監視中断',
    bcp:         'BCP・他',
  },
  status: {
    offline: 'オフ',
    idle:    '待機',
    grid:    '監視中',
    live:    'LIVE',
    vod:     '再生中',
    error:   'エラー',
    interrupted:   '監視中断',
    stopped:       '監視停止',
    recordingNote: '録画はレコーダ本体で継続中',
  },
  dashboard: {
    storeView:   '店舗ビュー',
    mapAlert:    '地図 + アラート',
    noStores:    '店舗データがありません',
    countUnit:   '件',
    alertsN:     (n) => `アラート ${n}件`,
    noAlerts:    '異常なし',
    allGood:     'すべての店舗が正常に稼働しています',
    loadingMap:  '地図を読み込み中…',
    alertZoomOn:  '⚠ アラート店舗にズーム',
    alertZoomOff: '⚠ 全店舗を表示',
    alertZoomEmpty: '対象なし',
    alertZoomNoGeo: (n) => `アラート店舗 ${n} 件の緯度・経度が未登録です。/admin/stores で座標を設定すると地図に表示できます。`,
    alertZoomNoAlerts: '現在、アラート対象の店舗はありません。',
  },
  alert: {
    edgeOffline:  'エッジオフライン',
    edgeError:    'エッジエラー',
    unknownTime:  '不明',
    secsAgo:      (n) => `${n}秒前`,
    minsAgo:      (n) => `${n}分前`,
    hoursAgo:     (n) => `${n}時間前`,
    kind: {
      edge_offline: 'エッジオフライン',
      edge_error:   'エッジエラー',
      bcp:          'BCP発令',
      incident:     '監視インシデント',
      patrol:       '巡回異常',
    },
  },
  workspace: {
    split16:           '16分割',
    unclassified:      '未分類',
    edgeNotRegistered: 'エッジサーバ未登録',
    pressToStart:      '監視ボタンで開始',
    startMonitor:      '▶ 監視',
    stopMonitor:       '■ 停止',
    mapLink:           '地図',
    playbackBtn:       '⏪ 録画',
    playbackHint:      '録画再生は「録画」ボタンで開始します。',
    cameras:           'カメラ',
    camRange:          (f, t) => `カメラ ${f}〜${t}`,
    gridUnavailable:     'グリッド映像を取得できません',
    gridUnavailableHint: '自動で再試行中です。各カメラはタップで個別表示できます。',
    gridRetry:           '再試行',
  },
  vod: {
    modalTitle:  '録画を再生',
    cameraLabel: 'カメラ',
    fromLabel:   '開始時刻',
    rangeLabel:  '再生時間',
    minutesUnit: '分',
    maxLabel:    '最大',
    confirm:     '再生する',
    cancel:      'キャンセル',
    noVod:       '録画再生に対応するカメラがありません',
    connecting:       '接続準備中…',
    seeking:          'シーク中…',
    noRecordingTitle: '指定範囲に録画がありません',
    cannotPlayTitle:  '再生できません',
    endedTitle:       '再生終了',
    retry:            '再試行',
    watchAgain:       'もう一度見る',
    pickAnother:      '別の時間を選ぶ',
    backToMonitor:    '監視に戻る',
  },
  drawer: {
    title:    '店舗を選択',
    noStores: '店舗なし',
  },
  offline: {
    title: 'オフライン',
    body:  'ネットワーク接続がありません。\n接続が回復したら自動的に再開します。',
    retry: '再試行',
  },
  adminNav: { dashboard: 'ダッシュボード', stores: '店舗', edges: 'エッジサーバ', recorders: 'レコーダ', users: 'ユーザ', csvImport: 'CSV 一括投入', audit: 'アクセスログ', limits: '視聴上限' },
  securityNav: { triage: '即時巡回', reports: '巡回レポート', settings: '巡回設定', cameras: 'カメラ設定', glossary: '用語説明' },
  securityHelp: {
    title: 'AI 警備トリアージ',
    body: '各店舗のカメラを定期巡回 (デフォルト 30 分間隔) し、ベースライン画像との差分を AI が解析して「異常 / 要確認 / 正常」に振り分けます。このページは全店舗の未確認・異常 finding を 1 つのキューに集約し、警備員が横断的に判断・対応できる「人の目」専用の画面です。AI が誤検知しがちな夜間や逆光時も、確認 SLA 内に人手で最終判断する設計です。',
    learnMore: '用語説明を見る',
  },
  securityGlossary: {
    title: '用語説明 (警備)',
    intro: '警備トリアージ・巡回機能で使われる用語の解説です。',
    crumb: '用語説明',
  },
  bcpNav: { eventsReports: 'アラート履歴', jalerts: 'Jアラート受信履歴', testIssue: 'テスト発令', glossary: '用語説明' },
  bcpHelp: {
    title: 'J-Alert 連動 BCP 自動記録',
    body: '気象庁・内閣府が発表する全国瞬時警報システム (Jアラート) を受信すると、対象エリアの店舗に対して自動で 8 枚の JPEG スナップショット (5分前 / 発生時 / 5分後 / 10分後 / 15分後 / 20分後 / 25分後 / 30分後) を保存し、PDF レポートを生成します。発令から人手を介さずに証跡を残せるため、保険・行政対応で活用できます。',
    learnMore: '用語説明を見る',
  },
  bcpGlossary: {
    title: '用語説明 (BCP)',
    intro: 'BCP（事業継続計画）ページで使用される用語の解説です。',
    crumb: '用語説明',
  },
  infraNav: { dashboard: 'ダッシュボード', incidents: 'インシデント', checks: 'チェック設定', reports: '稼働率レポート', settings: '監視設定', glossary: '用語説明' },
  navTitle: { admin: '設定', security: 'PATROL', bcp: 'BCP', infra: '死活監視' },
  common: { open: '開く', notGenerated: '未生成', dash: '—' },
  infraIncidents: {
    title: 'インシデント',
    sectionOpen:     (n) => `未対応 (${n})`,
    sectionAck:      (n) => `対応中 (${n})`,
    sectionResolved: (n) => `解決済み (直近 ${n})`,
    emptyOpen:     '現在、未対応のインシデントはありません。',
    emptyAck:      '対応中のインシデントはありません。',
    emptyResolved: '解決済みインシデントはまだありません。',
    statusOpen: '未対応', statusAck: '対応中', statusResolved: '解決済み',
    severityInfo: 'info', severityWarn: 'warn', severityDanger: 'danger',
    colTime: '発生時刻', colStore: '店舗', colTarget: '対象', colKind: '種別', colSeverity: '重大度', colStatus: '状態', colDetail: '詳細',
    tenantLabel: 'テナント',
  },
  infraChecks: {
    title: 'チェック設定',
    statRegistered: '登録チェック数', statEnabled: '有効', statFailing: '連続失敗中',
    empty: 'まだチェックが登録されていません。/infra/settings で対象店舗の監視を有効化するとチェックが自動登録されます。',
    colStore: '店舗', colTarget: '対象', colCheckType: 'チェック種別', colInterval: '間隔', colStatus: '状態', colConsecFail: '連続失敗', colLastRun: '最終実行',
    enabled: '有効', disabled: '無効', intervalSuffix: '分',
    checkLabel: { heartbeat: 'ハートビート', ping: 'Ping', probe_camera: 'カメラ プローブ', storage: 'ストレージ', recording_gap: '録画ギャップ', ntp: 'NTP 同期', tamper: '改ざん検知', version: 'バージョン' },
  },
  infraReports: {
    title: '稼働率レポート', empty: 'まだレポートが生成されていません。日次/週次/月次の集計ジョブが走ると、ここに一覧表示されます。',
    colStore: '店舗', colKind: '種別', colPeriod: '対象期間', colGenerated: '生成時刻', colPdf: 'PDF', colEmails: '送信先',
    kindDaily: '日次', kindWeekly: '週次', kindMonthly: '月次',
  },
  securityReports: {
    title: '巡回レポート',
    statRegistered: '登録レポート', statTotalRuns: '累計巡回回数', statTotalRunsSub: (d) => `(うち完了 ${d})`,
    statAnomalies: '異常検知', statReviews: '要確認キュー',
    empty: 'まだレポートが生成されていません。日次/週次の集計ジョブが走ると、ここに一覧表示されます。',
    colStore: '店舗', colPeriod: '対象期間', colGenerated: '生成時刻', colRuns: '巡回', colDone: '完了', colAnomalies: '異常', colReviews: '要確認', colPdf: 'PDF', colEmails: '送信先',
  },
  breadcrumb: {
    admin: '設定', security: 'PATROL', bcp: 'BCP', infra: '死活監視',
    infraIncidents: 'インシデント', infraChecks: 'チェック設定', infraReports: '稼働率レポート',
    securityReports: '巡回レポート',
  },
  infraDashboard: {
    title: 'インフラ ヘルス',
    healthLabel: { ok: '正常', warn: '注意', fail: '障害', unk: '未検証', maint: 'メンテ' },
    networkOutageTitle: 'ネットワーク/接続障害の疑い',
    networkOutageBody: '多数の拠点が同時に無応答です。個別機器の状態は確認できません（未検証表示）。',
    statMonitored: '監視拠点',
    statOpen: '未対応インシデント',
    statUptime30d: '平均稼働率 30日',
    statActiveChecks: '能動チェック',
    activeChecksP2: 'P2で有効化',
    legendStatus: '状態:',
    allHealthyTitle: (n) => `全 ${n} 拠点 正常稼働中`,
    allHealthyBody: '未対応インシデントはありません。各拠点の死活監視は継続中です。',
    colStore: '店舗', colEdge: 'エッジ', colRecorder: 'レコーダ', colCamera: 'カメラ', colOpen: '未対応', colLastSeen: '最終確認',
    notMonitored: '（未監視）',
    inMaintenance: 'メンテ中',
    incidentCount: (n) => `障害${n}`,
    clockSkew: (sec) => `NVR時計ズレ ${sec}秒`,
    emptyStores: '店舗がありません。先に管理画面で店舗を登録してください。',
    footerNote: 'P1: エッジ死活は last_seen_at から判定。レコーダ/カメラの能動チェック（ping/映像受信確認）は P2 で有効化されます。',
  },
  securityTriage: {
    title: '即時巡回',
    statTotalStores: '監視拠点',
    statAlerting: '異常検知中',
    statAllNormal: '全拠点正常',
    statRunsToday: '今日の巡回数',
    statUnconfirmed: '未確認異常',
    statAiCoverage: 'AI検証カバレッジ（今日）',
    sectionAlerts: '要対応の検出',
    sectionNormal: '正常稼働中',
    emptyAlerts: '現在、対応が必要な検出はありません。',
    emptyNormal: '監視中の拠点がありません。',
    colStore: '店舗', colCam: 'カメラ', colKind: '検出種別', colSnapshot: 'スナップショット', colTime: '時刻', colReviewed: '確認状況',
    snapshot: 'スナップショット',
    reviewed: '確認済み',
    notReviewed: '未確認',
    allNormalTitle: '全拠点 異常なし',
    allNormalBody: '未確認の異常はありません。各拠点の巡回は継続中です。',
    colLastRun: '最終巡回',
    colStatus: '状態',
    statusNormal: '正常',
    waitingForPatrol: '巡回待ち',
    noStoresYet: '巡回対象の店舗がまだありません。',
    noStoresSettingsLink: '巡回設定',
  },
  securitySettings: {
    title: '巡回設定',
    intro: '店舗ごとの巡回有効/無効、巡回間隔、確認 SLA、自動レポート設定。',
    sectionStores: '店舗別 巡回設定',
    colStore: '店舗', colEnabled: '有効', colInterval: '巡回間隔', colReviewSla: '確認 SLA', colAutoReport: '自動レポート',
    empty: '店舗が登録されていません。',
    noPatrol: '未設定',
  },
  securityCameras: {
    title: 'カメラ設定',
    intro: 'カメラごとの録画/巡回参加設定。',
    statCameras: 'カメラ総数', statEnabled: '巡回対象', statRecording: '録画中',
    colStore: '店舗', colCamName: 'カメラ', colVendor: 'ベンダ', colRecording: '録画', colPatrol: '巡回参加',
    empty: 'カメラがありません。先に管理画面でレコーダ・カメラを登録してください。',
    promptNotice: '比較プロンプトは「扉は閉まっているか」等の状態検出のみを記述してください。個人特定・顔認識は行いません。',
    unassigned: '未割当',
    storeWithCount: (n) => `（${n}台）`,
    colCamera: 'カメラ',
    colPatrolShort: '巡回',
    colPrompt: '比較プロンプト（状態検出のみ）',
    colSensitivity: '感度',
    colBaselineUrls: '基準画像(昼/夜) URL',
  },
  infraSettings: {
    title: '監視設定',
    intro: '店舗ごとの監視有効/無効、エッジオフライン判定時間、メンテナンス期間の設定。',
    sectionStores: '店舗別 監視設定',
    colStore: '店舗', colEnabled: '有効', colEdgeThreshold: 'エッジ オフライン閾値', colMaintUntil: 'メンテ期限',
    empty: '店舗が登録されていません。',
    minutesUnit: '分',
  },
  infraGlossary: {
    title: '用語説明',
    intro: 'インフラ監視で使用される用語の解説。',
  },
  bcpDashboard: {
    title: 'BCP',
    testIssueBtn: '🚨 テスト発令',
    tabReports: 'レポート',
    tabEvents: 'イベント一覧',
    statTotal: 'BCP イベント総数', statOpen: '未解決', statResolved: '解決済み', statClips: '保存クリップ',
    statGeneratedReports: '生成済みレポート',
    statPdfDelivered: 'PDF 配信済み',
    sectionEvents: '最近のイベント',
    sectionReports: '最近のレポート',
    emptyEvents: 'まだイベントがありません。',
    emptyEventsTitle: 'BCPイベントはありません',
    emptyEventsBody: 'Jアラートが発令されると、ここにイベントが表示されます。',
    emptyReports: 'まだレポートがありません。',
    emptyReportsTitle: 'レポートがありません',
    emptyReportsBody: 'BCP イベント発生後、レポートが自動生成されるとここに表示されます。',
    colTime: '時刻', colStore: '店舗名', colEventKind: 'イベント種別', colStatus: 'ステータス', colReports: 'レポート',
    colAlertType: 'アラート種別',
    colIssuedAt: '発令日時',
    colArea: 'エリアコード',
    colIntensity: '震度',
    colKind: '種別',
    colGeneratedAt: '生成日時',
    colRecipients: '送信先',
    colActions: '操作',
    statusOpen: '対応中', statusInProgress: '進行中', statusResolved: '解決済み',
    statusPending: '処理中',
    statusRecording: '録画中',
    statusClipsUploaded: 'アップロード済',
    statusReportGenerated: '報告書生成済',
    statusCompleted: '完了',
    statusFailed: '失敗',
    severityInfo: 'info', severityWarn: 'warn', severityDanger: 'danger',
    alertTypeSpecialWarning: '特別警報',
    alertTypeTsunami: '津波情報',
    alertTypeEarthquake: '震度情報',
    alertTypeMissile: 'ミサイル情報',
    alertTypeTest: 'テスト',
    testBadge: 'テスト',
    detail: '詳細',
    pdfLabel: 'PDF',
    notSent: '未送信',
    recipientsCount: (n) => `${n}件`,
    open: '開く',
    colStoreCount: '対象店舗',
    storeCountValue: (n) => `${n} 店舗`,
    statusPartial: '一部完了',
    expandAria: '対象店舗を展開',
    collapseAria: '対象店舗を折りたたむ',
  },
  bcpTest: {
    title: 'テストアラート発令',
    intro: '本番イベントを誤って起こさないため、テスト発令はステージング用のみ可能です。',
    formStoreLabel: '対象店舗',
    formKindLabel: 'イベント種別',
    formSeverityLabel: '重大度',
    formNoteLabel: 'メモ',
    formSubmit: 'テスト発令を作成',
    formCancel: 'キャンセル',
    sentTitle: 'テスト発令を作成しました',
    sentBody: 'BCP ダッシュボードでステータス遷移を確認してください。',
    crumb: 'テスト発令',
    backLink: '← BCP イベント一覧に戻る',
  },
  adminDashboard: {
    title: 'マスタ管理ダッシュボード',
    statStores: '店舗', statEdges: 'エッジサーバ', statRecorders: 'レコーダ', statUsers: 'ユーザ',
    statCameras: 'カメラ', statOnline: 'オンライン', statOffline: 'オフライン',
    quickLinksTitle: 'クイックリンク',
  },
  adminStores: {
    title: '店舗マスタ',
    addBtn: '＋ 店舗を追加',
    csvImportBtn: '⇪ CSV 一括投入',
    searchPlaceholder: '店舗名で検索',
    areaPlaceholder: 'エリアコード',
    filterBtn: '絞り込み',
    editLink: '編集',
    notSet: '未設定',
    showingLimit: '最大 500 件表示中。検索条件を絞ってください。',
    colName: '店舗名', colCode: 'コード', colArea: 'エリア', colEdges: 'エッジ', colRecorders: 'レコーダ', colStatus: '状態',
    colAddress: '住所',
    colGeo: '座標',
    colActive: '有効',
    empty: '店舗が見つかりません',
  },
  adminEdges: {
    title: 'エッジサーバ',
    addBtn: '＋ 新規登録',
    searchPlaceholder: 'エッジ名で検索',
    allStatuses: 'すべての状態',
    filterBtn: '絞り込み',
    editLink: '編集',
    colName: 'エッジ名', colStore: '店舗', colStatus: '状態', colLastSeen: '最終接続', colVersion: 'バージョン',
    colArea: 'エリア',
    colRecorders: 'レコーダ',
    empty: 'エッジサーバが見つかりません',
  },
  adminRecorders: {
    title: 'レコーダ',
    colName: 'レコーダ名', colStore: '店舗', colVendor: 'ベンダ', colCameras: 'カメラ数',
    empty: 'レコーダが登録されていません。',
  },
  adminUsers: {
    title: 'ユーザーマスタ',
    searchPlaceholder: '名前 / メールで検索',
    allRoles: 'すべてのロール',
    filterBtn: '絞り込み',
    clearBtn: 'クリア',
    showingLimit: '最大 500 件表示中。検索条件を絞ってください。',
    colName: '名前',
    colTenant: 'テナント',
    colStoreCount: '担当店舗数',
    colAuth: '認証',
    colEmail: 'メールアドレス', colRole: 'ロール', colCreated: '登録日',
    allStores: '全店舗',
    authVerified: '認証済み',
    authNotLinked: '未連携',
    roleSuperAdmin: 'スーパー管理者',
    roleTenantAdmin: 'テナント管理者',
    roleStoreManager: '店舗マネージャ',
    roleViewer: '閲覧のみ',
    empty: 'ユーザーが見つかりません',
  },
  adminImport: {
    title: 'CSV 一括投入',
    intro: '店舗・エッジ・レコーダ・カメラを CSV で一括投入できます。',
  },
  adminAudit: {
    title: 'アクセスログ',
    colTime: '時刻', colActor: '実行者', colAction: 'アクション', colTarget: '対象', colDetail: '詳細',
    empty: 'アクセス記録がありません',
    totalSessions: (n) => `全 ${n.toLocaleString()} セッション`,
    filterPrefix: 'モード:',
    modeAll: '全て',
    modeGrid: '16分割監視',
    modeLive: 'LIVE',
    modeVod: 'VOD再生',
    colUserId: 'ユーザー ID',
    colStore: '店舗',
    colMode: 'モード',
    colCamera: 'カメラ',
    colStartedAt: '開始日時',
    colEndedAt: '終了日時',
    colDuration: '時間',
    sessionActive: '稼働中',
    pagination: (curr, total) => `${curr} / ${total} ページ`,
    prev: '← 前',
    next: '次 →',
  },
}

// ─── English ─────────────────────────────────────────────────────────────────

const en: Msg = {
  appName: 'Monitor',
  nav: {
    monitor:  'MONITOR',
    map:      'Map',
    playback: 'Playback',
    admin:    'Settings',
    logs:     'Logs',
    reports:  'Reports',
    settings: 'Settings',
    infra:    'Health',
    bcp:      'BCP',
    security: 'PATROL',
    logout:   'Log out',
  },
  kpi: {
    total:      'Total',
    monitoring: 'Active',
    live:       'LIVE',
    alerts:     'Alerts',
    interrupted: 'Monitor down',
    bcp:         'BCP/Other',
  },
  status: {
    offline: 'Off',
    idle:    'Idle',
    grid:    'Active',
    live:    'LIVE',
    vod:     'Playing',
    error:   'Error',
    interrupted:   'Monitoring down',
    stopped:       'Stopped',
    recordingNote: 'Recording continues on the recorder',
  },
  dashboard: {
    storeView:   'Stores',
    mapAlert:    'Map + Alerts',
    noStores:    'No stores found',
    countUnit:   '',
    alertsN:     (n) => `${n} Alert${n !== 1 ? 's' : ''}`,
    noAlerts:    'All Clear',
    allGood:     'All stores are operating normally',
    loadingMap:  'Loading map…',
    alertZoomOn:  '⚠ Zoom to alerts',
    alertZoomOff: '⚠ Show all stores',
    alertZoomEmpty: 'No alerts',
    alertZoomNoGeo: (n) => `${n} alerting store${n !== 1 ? 's' : ''} have no latitude/longitude. Set coordinates in /admin/stores to plot them.`,
    alertZoomNoAlerts: 'No stores currently in an alert state.',
  },
  alert: {
    edgeOffline:  'Edge Offline',
    edgeError:    'Edge Error',
    unknownTime:  'Unknown',
    secsAgo:      (n) => `${n}s ago`,
    minsAgo:      (n) => `${n}m ago`,
    hoursAgo:     (n) => `${n}h ago`,
    kind: {
      edge_offline: 'Edge Offline',
      edge_error:   'Edge Error',
      bcp:          'BCP Alert',
      incident:     'Monitor Incident',
      patrol:       'Patrol Anomaly',
    },
  },
  workspace: {
    split16:           '16-Split',
    unclassified:      'Uncategorized',
    edgeNotRegistered: 'No edge server',
    pressToStart:      'Press Monitor to start',
    startMonitor:      '▶ Monitor',
    stopMonitor:       '■ Stop',
    mapLink:           'Map',
    playbackBtn:       '⏪ Record',
    playbackHint:      'Press "Record" to start playback.',
    cameras:           'Cameras',
    camRange:          (f, t) => `Cameras ${f}–${t}`,
    gridUnavailable:     'Grid view unavailable',
    gridUnavailableHint: 'Retrying automatically. Tap any camera to view it individually.',
    gridRetry:           'Retry',
  },
  vod: {
    modalTitle:  'Play Recording',
    cameraLabel: 'Camera',
    fromLabel:   'Start time',
    rangeLabel:  'Duration',
    minutesUnit: 'min',
    maxLabel:    'Max',
    confirm:     'Play',
    cancel:      'Cancel',
    noVod:       'No camera supports playback',
    connecting:       'Connecting…',
    seeking:          'Seeking…',
    noRecordingTitle: 'No recording for this range',
    cannotPlayTitle:  'Cannot play',
    endedTitle:       'Playback ended',
    retry:            'Retry',
    watchAgain:       'Watch again',
    pickAnother:      'Pick another time',
    backToMonitor:    'Back to monitor',
  },
  drawer: {
    title:    'Select Store',
    noStores: 'No stores',
  },
  offline: {
    title: 'Offline',
    body:  'No network connection.\nWill resume automatically when connected.',
    retry: 'Retry',
  },
  adminNav: { dashboard: 'Dashboard', stores: 'Stores', edges: 'Edge Servers', recorders: 'Recorders', users: 'Users', csvImport: 'CSV Bulk Import', audit: 'Access Log', limits: 'Session Limits' },
  securityNav: { triage: 'Patrol Now', reports: 'Patrol Reports', settings: 'Patrol Settings', cameras: 'Camera Config', glossary: 'Glossary' },
  securityHelp: {
    title: 'AI security triage',
    body: 'Cameras at each store are patrolled on a fixed interval (default 30 min). AI compares each snapshot against a baseline image and classifies findings as anomaly / review / normal. This page consolidates all unconfirmed/anomaly findings across stores into a single queue so security staff can triage cross-store with a human-in-the-loop. AI errs on the side of false positives at night / backlit conditions — humans make the final call within a review SLA.',
    learnMore: 'View glossary',
  },
  securityGlossary: {
    title: 'Glossary (Security)',
    intro: 'Terminology used in the security triage / patrol pages.',
    crumb: 'Glossary',
  },
  bcpNav: { eventsReports: 'Alert History', jalerts: 'J-Alert Log', testIssue: 'Test Issue', glossary: 'Glossary' },
  bcpHelp: {
    title: 'J-Alert linked BCP auto-recording',
    body: 'When Japan\'s nationwide instant warning system (J-Alert, issued by JMA / Cabinet Office) fires, this system automatically saves 8 JPEG snapshots (T-5, T+0, T+5, T+10, T+15, T+20, T+25, T+30 minutes) for affected stores and generates a PDF report. Evidence is preserved without human intervention — useful for insurance and regulatory response.',
    learnMore: 'View glossary',
  },
  bcpGlossary: {
    title: 'Glossary (BCP)',
    intro: 'Terminology used on the BCP (Business Continuity Plan) pages.',
    crumb: 'Glossary',
  },
  infraNav: { dashboard: 'Dashboard', incidents: 'Incidents', checks: 'Checks', reports: 'Uptime Reports', settings: 'Settings', glossary: 'Glossary' },
  navTitle: { admin: 'Settings', security: 'PATROL', bcp: 'BCP', infra: 'Health Monitoring' },
  common: { open: 'Open', notGenerated: 'Not generated', dash: '—' },
  infraIncidents: {
    title: 'Incidents',
    sectionOpen:     (n) => `Open (${n})`,
    sectionAck:      (n) => `Acknowledged (${n})`,
    sectionResolved: (n) => `Resolved (recent ${n})`,
    emptyOpen:     'No open incidents at the moment.',
    emptyAck:      'No incidents being handled.',
    emptyResolved: 'No resolved incidents yet.',
    statusOpen: 'Open', statusAck: 'Acknowledged', statusResolved: 'Resolved',
    severityInfo: 'info', severityWarn: 'warn', severityDanger: 'danger',
    colTime: 'Time', colStore: 'Store', colTarget: 'Target', colKind: 'Kind', colSeverity: 'Severity', colStatus: 'Status', colDetail: 'Detail',
    tenantLabel: 'Tenant',
  },
  infraChecks: {
    title: 'Check Configuration',
    statRegistered: 'Registered checks', statEnabled: 'Enabled', statFailing: 'Currently failing',
    empty: 'No checks registered yet. Enable monitoring for a store from /infra/settings to auto-register checks.',
    colStore: 'Store', colTarget: 'Target', colCheckType: 'Check type', colInterval: 'Interval', colStatus: 'Status', colConsecFail: 'Consec. fails', colLastRun: 'Last run',
    enabled: 'Enabled', disabled: 'Disabled', intervalSuffix: 'min',
    checkLabel: { heartbeat: 'Heartbeat', ping: 'Ping', probe_camera: 'Camera probe', storage: 'Storage', recording_gap: 'Recording gap', ntp: 'NTP sync', tamper: 'Tamper detect', version: 'Version' },
  },
  infraReports: {
    title: 'Uptime Reports', empty: 'No reports generated yet. Daily/weekly/monthly rollup jobs will list them here.',
    colStore: 'Store', colKind: 'Kind', colPeriod: 'Period', colGenerated: 'Generated', colPdf: 'PDF', colEmails: 'Recipients',
    kindDaily: 'Daily', kindWeekly: 'Weekly', kindMonthly: 'Monthly',
  },
  securityReports: {
    title: 'Patrol Reports',
    statRegistered: 'Reports', statTotalRuns: 'Total patrols', statTotalRunsSub: (d) => `(done: ${d})`,
    statAnomalies: 'Anomalies', statReviews: 'Review queue',
    empty: 'No reports generated yet. Daily/weekly rollup jobs will list them here.',
    colStore: 'Store', colPeriod: 'Period', colGenerated: 'Generated', colRuns: 'Patrols', colDone: 'Done', colAnomalies: 'Anomalies', colReviews: 'Review', colPdf: 'PDF', colEmails: 'Recipients',
  },
  breadcrumb: {
    admin: 'Settings', security: 'PATROL', bcp: 'BCP', infra: 'Health',
    infraIncidents: 'Incidents', infraChecks: 'Checks', infraReports: 'Uptime Reports',
    securityReports: 'Patrol Reports',
  },
  infraDashboard: {
    title: 'Infrastructure Health',
    healthLabel: { ok: 'OK', warn: 'Warn', fail: 'Fail', unk: 'Unknown', maint: 'Maint.' },
    networkOutageTitle: 'Possible network/connectivity outage',
    networkOutageBody: 'Multiple sites are unresponsive simultaneously. Individual device state cannot be verified (shown as Unknown).',
    statMonitored: 'Monitored sites',
    statOpen: 'Open incidents',
    statUptime30d: '30-day uptime avg.',
    statActiveChecks: 'Active checks',
    activeChecksP2: 'Enabled in P2',
    legendStatus: 'Status:',
    allHealthyTitle: (n) => `All ${n} sites operating normally`,
    allHealthyBody: 'No open incidents. Liveness monitoring is ongoing for all sites.',
    colStore: 'Store', colEdge: 'Edge', colRecorder: 'Recorder', colCamera: 'Camera', colOpen: 'Open', colLastSeen: 'Last seen',
    notMonitored: '(not monitored)',
    inMaintenance: 'In maintenance',
    incidentCount: (n) => `${n} issues`,
    clockSkew: (sec) => `NVR clock off by ${sec}s`,
    emptyStores: 'No stores yet. Register stores in admin first.',
    footerNote: 'P1: Edge liveness is derived from last_seen_at. Active checks for recorders/cameras (ping/frame verification) are enabled in P2.',
  },
  securityTriage: {
    title: 'Patrol Now',
    statTotalStores: 'Monitored',
    statAlerting: 'Alerting',
    statAllNormal: 'All normal',
    statRunsToday: 'Patrols today',
    statUnconfirmed: 'Unconfirmed anomalies',
    statAiCoverage: 'AI coverage (today)',
    sectionAlerts: 'Detections requiring action',
    sectionNormal: 'Operating normally',
    emptyAlerts: 'No detections requiring action.',
    emptyNormal: 'No monitored sites.',
    colStore: 'Store', colCam: 'Camera', colKind: 'Detection', colSnapshot: 'Snapshot', colTime: 'Time', colReviewed: 'Review',
    snapshot: 'Snapshot',
    reviewed: 'Reviewed',
    notReviewed: 'Unreviewed',
    allNormalTitle: 'All sites normal',
    allNormalBody: 'No unconfirmed anomalies. Patrols are ongoing for all sites.',
    colLastRun: 'Last patrol',
    colStatus: 'Status',
    statusNormal: 'Normal',
    waitingForPatrol: 'Waiting',
    noStoresYet: 'No stores configured for patrol.',
    noStoresSettingsLink: 'Patrol Settings',
  },
  securitySettings: {
    title: 'Patrol Settings',
    intro: 'Enable/disable patrol per store, patrol interval, review SLA, auto-report.',
    sectionStores: 'Per-Store Patrol Settings',
    colStore: 'Store', colEnabled: 'Enabled', colInterval: 'Interval', colReviewSla: 'Review SLA', colAutoReport: 'Auto report',
    empty: 'No stores registered.',
    noPatrol: 'Not configured',
  },
  securityCameras: {
    title: 'Camera Configuration',
    intro: 'Per-camera recording and patrol participation settings.',
    statCameras: 'Total cameras', statEnabled: 'In patrol', statRecording: 'Recording',
    colStore: 'Store', colCamName: 'Camera', colVendor: 'Vendor', colRecording: 'Recording', colPatrol: 'Patrol',
    empty: 'No cameras registered. Add recorders and cameras in Admin first.',
    promptNotice: 'Use comparison prompts only for state detection ("is the door closed?" etc.). No personal identification or face recognition.',
    unassigned: 'Unassigned',
    storeWithCount: (n) => ` (${n} cameras)`,
    colCamera: 'Camera',
    colPatrolShort: 'Patrol',
    colPrompt: 'Comparison prompt (state only)',
    colSensitivity: 'Sensitivity',
    colBaselineUrls: 'Baseline URL (day/night)',
  },
  infraSettings: {
    title: 'Monitoring Settings',
    intro: 'Per-store monitoring on/off, edge-offline threshold, and maintenance windows.',
    sectionStores: 'Per-Store Monitoring',
    colStore: 'Store', colEnabled: 'Enabled', colEdgeThreshold: 'Edge offline threshold', colMaintUntil: 'Maintenance until',
    empty: 'No stores registered.',
    minutesUnit: 'min',
  },
  infraGlossary: {
    title: 'Glossary',
    intro: 'Terminology used in infrastructure monitoring.',
  },
  bcpDashboard: {
    title: 'BCP',
    testIssueBtn: '🚨 Test Issue',
    tabReports: 'Reports',
    tabEvents: 'Events',
    statTotal: 'Total BCP events', statOpen: 'Open', statResolved: 'Resolved', statClips: 'Saved clips',
    statGeneratedReports: 'Reports generated',
    statPdfDelivered: 'PDF delivered',
    sectionEvents: 'Recent Events',
    sectionReports: 'Recent Reports',
    emptyEvents: 'No events yet.',
    emptyEventsTitle: 'No BCP events',
    emptyEventsBody: 'When a J-Alert fires, events will appear here.',
    emptyReports: 'No reports yet.',
    emptyReportsTitle: 'No reports',
    emptyReportsBody: 'After a BCP event, reports are auto-generated and listed here.',
    colTime: 'Time', colStore: 'Store', colEventKind: 'Event', colStatus: 'Status', colReports: 'Reports',
    colAlertType: 'Alert type',
    colIssuedAt: 'Issued at',
    colArea: 'Area code',
    colIntensity: 'Intensity',
    colKind: 'Kind',
    colGeneratedAt: 'Generated',
    colRecipients: 'Recipients',
    colActions: 'Actions',
    statusOpen: 'Open', statusInProgress: 'In Progress', statusResolved: 'Resolved',
    statusPending: 'Pending',
    statusRecording: 'Recording',
    statusClipsUploaded: 'Clips uploaded',
    statusReportGenerated: 'Report generated',
    statusCompleted: 'Completed',
    statusFailed: 'Failed',
    severityInfo: 'info', severityWarn: 'warn', severityDanger: 'danger',
    alertTypeSpecialWarning: 'Emergency Warning',
    alertTypeTsunami: 'Tsunami',
    alertTypeEarthquake: 'Earthquake',
    alertTypeMissile: 'Missile',
    alertTypeTest: 'Test',
    testBadge: 'Test',
    detail: 'Detail',
    pdfLabel: 'PDF',
    notSent: 'Not sent',
    recipientsCount: (n) => `${n}`,
    open: 'Open',
    colStoreCount: 'Stores',
    storeCountValue: (n) => `${n} ${n === 1 ? 'store' : 'stores'}`,
    statusPartial: 'Partial',
    expandAria: 'Expand stores',
    collapseAria: 'Collapse stores',
  },
  bcpTest: {
    title: 'Test Alert',
    intro: 'To avoid triggering real events by accident, test issuance is only available in staging.',
    formStoreLabel: 'Target store',
    formKindLabel: 'Event kind',
    formSeverityLabel: 'Severity',
    formNoteLabel: 'Note',
    formSubmit: 'Create test event',
    formCancel: 'Cancel',
    sentTitle: 'Test event created',
    sentBody: 'Check the BCP dashboard for status transitions.',
    crumb: 'Test Alert',
    backLink: '← Back to BCP events',
  },
  adminDashboard: {
    title: 'Admin Dashboard',
    statStores: 'Stores', statEdges: 'Edge servers', statRecorders: 'Recorders', statUsers: 'Users',
    statCameras: 'Cameras', statOnline: 'Online', statOffline: 'Offline',
    quickLinksTitle: 'Quick Links',
  },
  adminStores: {
    title: 'Stores',
    addBtn: '+ Add store',
    csvImportBtn: '⇪ CSV Bulk Import',
    searchPlaceholder: 'Search by name',
    areaPlaceholder: 'Area code',
    filterBtn: 'Filter',
    editLink: 'Edit',
    notSet: 'Not set',
    showingLimit: 'Showing up to 500 stores. Narrow your filter.',
    colName: 'Name', colCode: 'Code', colArea: 'Area', colEdges: 'Edges', colRecorders: 'Recorders', colStatus: 'Status',
    colAddress: 'Address',
    colGeo: 'Coordinates',
    colActive: 'Active',
    empty: 'No stores found',
  },
  adminEdges: {
    title: 'Edge Servers',
    addBtn: '+ New',
    searchPlaceholder: 'Search by name',
    allStatuses: 'All statuses',
    filterBtn: 'Filter',
    editLink: 'Edit',
    colName: 'Name', colStore: 'Store', colStatus: 'Status', colLastSeen: 'Last seen', colVersion: 'Version',
    colArea: 'Area',
    colRecorders: 'Recorders',
    empty: 'No edge servers found',
  },
  adminRecorders: {
    title: 'Recorders',
    colName: 'Name', colStore: 'Store', colVendor: 'Vendor', colCameras: 'Cameras',
    empty: 'No recorders registered.',
  },
  adminUsers: {
    title: 'Users',
    searchPlaceholder: 'Search by name / email',
    allRoles: 'All roles',
    filterBtn: 'Filter',
    clearBtn: 'Clear',
    showingLimit: 'Showing up to 500 users. Narrow your filter.',
    colName: 'Name',
    colTenant: 'Tenant',
    colStoreCount: 'Stores assigned',
    colAuth: 'Auth',
    colEmail: 'Email', colRole: 'Role', colCreated: 'Created',
    allStores: 'All stores',
    authVerified: 'Verified',
    authNotLinked: 'Not linked',
    roleSuperAdmin: 'Super Admin',
    roleTenantAdmin: 'Tenant Admin',
    roleStoreManager: 'Store Manager',
    roleViewer: 'Viewer',
    empty: 'No users found',
  },
  adminImport: {
    title: 'CSV Bulk Import',
    intro: 'Bulk import stores, edges, recorders, and cameras via CSV.',
  },
  adminAudit: {
    title: 'Access Log',
    colTime: 'Time', colActor: 'Actor', colAction: 'Action', colTarget: 'Target', colDetail: 'Detail',
    empty: 'No audit log entries',
    totalSessions: (n) => `${n.toLocaleString()} sessions total`,
    filterPrefix: 'Mode:',
    modeAll: 'All',
    modeGrid: '16-Split',
    modeLive: 'LIVE',
    modeVod: 'VOD Playback',
    colUserId: 'User ID',
    colStore: 'Store',
    colMode: 'Mode',
    colCamera: 'Camera',
    colStartedAt: 'Started at',
    colEndedAt: 'Ended at',
    colDuration: 'Duration',
    sessionActive: 'Active',
    pagination: (curr, total) => `Page ${curr} / ${total}`,
    prev: '← Prev',
    next: 'Next →',
  },
}

// ─── Simplified Chinese ───────────────────────────────────────────────────────

const zh: Msg = {
  appName: '监控',
  nav: {
    monitor:  '监控',
    map:      '地图',
    playback: '回放',
    admin:    '设置',
    logs:     '日志',
    reports:  '报表',
    settings: '设置',
    infra:    '健康监控',
    bcp:      'BCP',
    security: 'PATROL',
    logout:   '退出',
  },
  kpi: {
    total:      '门店总数',
    monitoring: '监控中',
    live:       '直播',
    alerts:     '警报',
    interrupted: '监控中断',
    bcp:         'BCP·其他',
  },
  status: {
    offline: '离线',
    idle:    '待机',
    grid:    '监控中',
    live:    '直播',
    vod:     '回放中',
    error:   '故障',
    interrupted:   '监控中断',
    stopped:       '监控停止',
    recordingNote: '录像由录像机本体持续进行',
  },
  dashboard: {
    storeView:   '门店列表',
    mapAlert:    '地图 + 警报',
    noStores:    '暂无门店数据',
    countUnit:   '家',
    alertsN:     (n) => `警报 ${n}件`,
    noAlerts:    '一切正常',
    allGood:     '所有门店运行正常',
    loadingMap:  '地图加载中…',
    alertZoomOn:  '⚠ 缩放到警报门店',
    alertZoomOff: '⚠ 显示全部门店',
    alertZoomEmpty: '无警报',
    alertZoomNoGeo: (n) => `${n} 家警报门店未登记经纬度。请在 /admin/stores 设置坐标后即可在地图上显示。`,
    alertZoomNoAlerts: '当前没有处于警报状态的门店。',
  },
  alert: {
    edgeOffline:  '边缘设备离线',
    edgeError:    '边缘设备故障',
    unknownTime:  '未知',
    secsAgo:      (n) => `${n}秒前`,
    minsAgo:      (n) => `${n}分钟前`,
    hoursAgo:     (n) => `${n}小时前`,
    kind: {
      edge_offline: '边缘设备离线',
      edge_error:   '边缘设备故障',
      bcp:          'BCP警报',
      incident:     '监控事件',
      patrol:       '巡逻异常',
    },
  },
  workspace: {
    split16:           '16分割',
    unclassified:      '未分类',
    edgeNotRegistered: '未注册边缘服务器',
    pressToStart:      '点击监控按钮开始',
    startMonitor:      '▶ 监控',
    stopMonitor:       '■ 停止',
    mapLink:           '地图',
    playbackBtn:       '⏪ 录像',
    playbackHint:      '点击"录像"按钮开始回放。',
    cameras:           '摄像头',
    camRange:          (f, t) => `摄像头 ${f}〜${t}`,
    gridUnavailable:     '无法获取分屏画面',
    gridUnavailableHint: '正在自动重试。点击任意摄像头可单独查看。',
    gridRetry:           '重试',
  },
  vod: {
    modalTitle:  '回放录像',
    cameraLabel: '摄像头',
    fromLabel:   '开始时间',
    rangeLabel:  '回放时长',
    minutesUnit: '分钟',
    maxLabel:    '最大',
    confirm:     '回放',
    cancel:      '取消',
    noVod:       '没有支持回放的摄像头',
    connecting:       '连接中…',
    seeking:          '跳转中…',
    noRecordingTitle: '指定时间段没有录像',
    cannotPlayTitle:  '无法播放',
    endedTitle:       '播放结束',
    retry:            '重试',
    watchAgain:       '重新观看',
    pickAnother:      '选择其他时间',
    backToMonitor:    '返回监控',
  },
  drawer: {
    title:    '选择门店',
    noStores: '暂无门店',
  },
  offline: {
    title: '离线',
    body:  '无网络连接。\n恢复连接后将自动继续。',
    retry: '重试',
  },
  adminNav: { dashboard: '仪表盘', stores: '门店', edges: '边缘服务器', recorders: '录像机', users: '用户', csvImport: 'CSV 批量导入', audit: '访问日志', limits: '观看上限' },
  securityNav: { triage: '即时巡逻', reports: '巡逻报告', settings: '巡逻设置', cameras: '摄像机配置', glossary: '术语说明' },
  securityHelp: {
    title: 'AI 安全分诊',
    body: '系统按固定间隔（默认 30 分钟）巡逻每个门店的摄像头，AI 将快照与基线图像比较，并将结果分类为「异常 / 待确认 / 正常」。本页面将所有门店的未确认/异常检出聚合为单一队列，便于安全人员跨门店统一分诊。AI 在夜间/逆光时倾向误检出，最终判断由人工在确认 SLA 内完成。',
    learnMore: '查看术语说明',
  },
  securityGlossary: {
    title: '术语说明 (安全)',
    intro: '安全分诊・巡逻功能中使用的术语解释。',
    crumb: '术语说明',
  },
  bcpNav: { eventsReports: '警报历史', jalerts: 'J-Alert 接收历史', testIssue: '测试发布', glossary: '术语说明' },
  bcpHelp: {
    title: 'J-Alert 联动 BCP 自动记录',
    body: '当日本气象厅 / 内阁府发布的全国瞬时警报系统 (J-Alert) 触发时，系统将自动为对象区域内的门店保存 8 张 JPEG 快照 (前 5 分钟 / 发生时 / 后 5 / 10 / 15 / 20 / 25 / 30 分钟) 并生成 PDF 报告。无需人工干预即可保留证据，可用于保险与监管应对。',
    learnMore: '查看术语说明',
  },
  bcpGlossary: {
    title: '术语说明 (BCP)',
    intro: '业务连续性计划 (BCP) 页面中使用的术语解释。',
    crumb: '术语说明',
  },
  infraNav: { dashboard: '仪表盘', incidents: '事件', checks: '检查配置', reports: '可用率报告', settings: '监控设置', glossary: '术语表' },
  navTitle: { admin: '设置', security: 'PATROL', bcp: 'BCP', infra: '健康监控' },
  common: { open: '打开', notGenerated: '未生成', dash: '—' },
  infraIncidents: {
    title: '事件',
    sectionOpen:     (n) => `未处理 (${n})`,
    sectionAck:      (n) => `处理中 (${n})`,
    sectionResolved: (n) => `已解决 (最近 ${n})`,
    emptyOpen:     '目前没有未处理的事件。',
    emptyAck:      '没有正在处理的事件。',
    emptyResolved: '尚无已解决的事件。',
    statusOpen: '未处理', statusAck: '处理中', statusResolved: '已解决',
    severityInfo: 'info', severityWarn: 'warn', severityDanger: 'danger',
    colTime: '发生时间', colStore: '门店', colTarget: '对象', colKind: '类型', colSeverity: '严重度', colStatus: '状态', colDetail: '详情',
    tenantLabel: '租户',
  },
  infraChecks: {
    title: '检查配置',
    statRegistered: '已注册检查', statEnabled: '启用中', statFailing: '连续失败中',
    empty: '尚未注册检查。在 /infra/settings 启用门店监控后会自动注册。',
    colStore: '门店', colTarget: '对象', colCheckType: '检查类型', colInterval: '间隔', colStatus: '状态', colConsecFail: '连续失败', colLastRun: '最后执行',
    enabled: '启用', disabled: '禁用', intervalSuffix: '分钟',
    checkLabel: { heartbeat: '心跳', ping: 'Ping', probe_camera: '摄像机探测', storage: '存储', recording_gap: '录像间隙', ntp: 'NTP 同步', tamper: '篡改检测', version: '版本' },
  },
  infraReports: {
    title: '可用率报告', empty: '尚未生成报告。日/周/月汇总任务运行后将在此列出。',
    colStore: '门店', colKind: '类型', colPeriod: '对象期间', colGenerated: '生成时间', colPdf: 'PDF', colEmails: '发送至',
    kindDaily: '日报', kindWeekly: '周报', kindMonthly: '月报',
  },
  securityReports: {
    title: '巡逻报告',
    statRegistered: '已登记报告', statTotalRuns: '累计巡逻次数', statTotalRunsSub: (d) => `(已完成 ${d})`,
    statAnomalies: '异常检出', statReviews: '待确认队列',
    empty: '尚未生成报告。日/周汇总任务运行后将在此列出。',
    colStore: '门店', colPeriod: '对象期间', colGenerated: '生成时间', colRuns: '巡逻', colDone: '完成', colAnomalies: '异常', colReviews: '待确认', colPdf: 'PDF', colEmails: '发送至',
  },
  breadcrumb: {
    admin: '设置', security: 'PATROL', bcp: 'BCP', infra: '健康监控',
    infraIncidents: '事件', infraChecks: '检查配置', infraReports: '可用率报告',
    securityReports: '巡逻报告',
  },
  infraDashboard: {
    title: '基础设施健康',
    healthLabel: { ok: '正常', warn: '注意', fail: '故障', unk: '未验证', maint: '维护' },
    networkOutageTitle: '疑似网络/连接故障',
    networkOutageBody: '多个站点同时无响应。无法确认各设备状态（显示为未验证）。',
    statMonitored: '监控站点',
    statOpen: '未处理事件',
    statUptime30d: '30天平均可用率',
    statActiveChecks: '主动检查',
    activeChecksP2: 'P2 启用',
    legendStatus: '状态:',
    allHealthyTitle: (n) => `全部 ${n} 个站点正常运行`,
    allHealthyBody: '无未处理事件。各站点的死活监测持续进行中。',
    colStore: '门店', colEdge: '边缘', colRecorder: '录像机', colCamera: '摄像头', colOpen: '未处理', colLastSeen: '最后确认',
    notMonitored: '（未监控）',
    inMaintenance: '维护中',
    incidentCount: (n) => `故障 ${n}`,
    clockSkew: (sec) => `NVR时钟偏差 ${sec}秒`,
    emptyStores: '尚未注册门店。请先在管理界面添加门店。',
    footerNote: 'P1: 边缘死活基于 last_seen_at 判定。录像机/摄像头的主动检查（ping/收帧验证）在 P2 启用。',
  },
  securityTriage: {
    title: '即时巡逻',
    statTotalStores: '监控站点',
    statAlerting: '异常检测中',
    statAllNormal: '全部正常',
    statRunsToday: '今日巡逻数',
    statUnconfirmed: '未确认异常',
    statAiCoverage: 'AI 验证覆盖率（今日）',
    sectionAlerts: '需要处理的检测',
    sectionNormal: '运行正常',
    emptyAlerts: '当前没有需要处理的检测。',
    emptyNormal: '没有监控中的站点。',
    colStore: '门店', colCam: '摄像头', colKind: '检测类型', colSnapshot: '快照', colTime: '时间', colReviewed: '确认状态',
    snapshot: '快照',
    reviewed: '已确认',
    notReviewed: '未确认',
    allNormalTitle: '全部站点无异常',
    allNormalBody: '没有未确认的异常。各站点的巡逻持续进行中。',
    colLastRun: '最近巡逻',
    colStatus: '状态',
    statusNormal: '正常',
    waitingForPatrol: '等待巡逻',
    noStoresYet: '尚无可巡逻的门店。',
    noStoresSettingsLink: '巡逻设置',
  },
  securitySettings: {
    title: '巡逻设置',
    intro: '按门店启用/停用巡逻，巡逻间隔，确认 SLA，自动报告。',
    sectionStores: '门店巡逻设置',
    colStore: '门店', colEnabled: '启用', colInterval: '巡逻间隔', colReviewSla: '确认 SLA', colAutoReport: '自动报告',
    empty: '尚未注册门店。',
    noPatrol: '未配置',
  },
  securityCameras: {
    title: '摄像机配置',
    intro: '按摄像机的录像和巡逻参与设置。',
    statCameras: '摄像机总数', statEnabled: '巡逻对象', statRecording: '录像中',
    colStore: '门店', colCamName: '摄像机', colVendor: '厂商', colRecording: '录像', colPatrol: '巡逻',
    empty: '尚无摄像机。请先在管理界面添加录像机和摄像机。',
    promptNotice: '比较提示词仅可描述"门是否关闭"等状态检测。不进行身份识别或面部识别。',
    unassigned: '未分配',
    storeWithCount: (n) => `（${n}台）`,
    colCamera: '摄像机',
    colPatrolShort: '巡逻',
    colPrompt: '比较提示词（仅状态检测）',
    colSensitivity: '灵敏度',
    colBaselineUrls: '基准图像(白天/夜间) URL',
  },
  infraSettings: {
    title: '监控设置',
    intro: '按门店启用/停用监控，边缘离线判定时间，维护期间设置。',
    sectionStores: '门店监控设置',
    colStore: '门店', colEnabled: '启用', colEdgeThreshold: '边缘离线阈值', colMaintUntil: '维护至',
    empty: '尚未注册门店。',
    minutesUnit: '分钟',
  },
  infraGlossary: {
    title: '术语表',
    intro: '基础设施监控中使用的术语解释。',
  },
  bcpDashboard: {
    title: 'BCP',
    testIssueBtn: '🚨 测试发布',
    tabReports: '报告',
    tabEvents: '事件列表',
    statTotal: 'BCP 事件总数', statOpen: '未解决', statResolved: '已解决', statClips: '保存片段',
    statGeneratedReports: '已生成报告',
    statPdfDelivered: 'PDF 已发送',
    sectionEvents: '最近事件',
    sectionReports: '最近报告',
    emptyEvents: '尚无事件。',
    emptyEventsTitle: '尚无 BCP 事件',
    emptyEventsBody: 'J-Alert 发布时，事件将显示在此处。',
    emptyReports: '尚无报告。',
    emptyReportsTitle: '尚无报告',
    emptyReportsBody: 'BCP 事件发生后，报告将自动生成并显示在此处。',
    colTime: '时间', colStore: '门店名', colEventKind: '事件类型', colStatus: '状态', colReports: '报告',
    colAlertType: '警报类型',
    colIssuedAt: '发布时间',
    colArea: '地区代码',
    colIntensity: '震度',
    colKind: '类型',
    colGeneratedAt: '生成时间',
    colRecipients: '发送至',
    colActions: '操作',
    statusOpen: '处理中', statusInProgress: '进行中', statusResolved: '已解决',
    statusPending: '处理中',
    statusRecording: '录像中',
    statusClipsUploaded: '已上传',
    statusReportGenerated: '报告已生成',
    statusCompleted: '完成',
    statusFailed: '失败',
    severityInfo: 'info', severityWarn: 'warn', severityDanger: 'danger',
    alertTypeSpecialWarning: '特别警报',
    alertTypeTsunami: '海啸信息',
    alertTypeEarthquake: '地震信息',
    alertTypeMissile: '导弹信息',
    alertTypeTest: '测试',
    testBadge: '测试',
    detail: '详情',
    pdfLabel: 'PDF',
    notSent: '未发送',
    recipientsCount: (n) => `${n}件`,
    open: '打开',
    colStoreCount: '对象门店',
    storeCountValue: (n) => `${n} 门店`,
    statusPartial: '部分完成',
    expandAria: '展开对象门店',
    collapseAria: '折叠对象门店',
  },
  bcpTest: {
    title: '测试警报发布',
    intro: '为防止误触发真实事件，测试发布仅在测试环境可用。',
    formStoreLabel: '对象门店',
    formKindLabel: '事件类型',
    formSeverityLabel: '严重度',
    formNoteLabel: '备注',
    formSubmit: '创建测试事件',
    formCancel: '取消',
    sentTitle: '已创建测试事件',
    sentBody: '请在 BCP 仪表盘查看状态转换。',
    crumb: '测试发布',
    backLink: '← 返回 BCP 事件列表',
  },
  adminDashboard: {
    title: '主数据管理',
    statStores: '门店', statEdges: '边缘服务器', statRecorders: '录像机', statUsers: '用户',
    statCameras: '摄像机', statOnline: '在线', statOffline: '离线',
    quickLinksTitle: '快速链接',
  },
  adminStores: {
    title: '门店主数据',
    addBtn: '+ 添加门店',
    csvImportBtn: '⇪ CSV 批量导入',
    searchPlaceholder: '按门店名搜索',
    areaPlaceholder: '地区代码',
    filterBtn: '筛选',
    editLink: '编辑',
    notSet: '未设置',
    showingLimit: '最多显示 500 条。请缩小筛选条件。',
    colName: '门店名称', colCode: '代码', colArea: '地区', colEdges: '边缘', colRecorders: '录像机', colStatus: '状态',
    colAddress: '地址',
    colGeo: '坐标',
    colActive: '启用',
    empty: '未找到门店',
  },
  adminEdges: {
    title: '边缘服务器',
    addBtn: '+ 新建',
    searchPlaceholder: '按边缘名搜索',
    allStatuses: '所有状态',
    filterBtn: '筛选',
    editLink: '编辑',
    colName: '名称', colStore: '门店', colStatus: '状态', colLastSeen: '最近连接', colVersion: '版本',
    colArea: '地区',
    colRecorders: '录像机',
    empty: '未找到边缘服务器',
  },
  adminRecorders: {
    title: '录像机',
    colName: '名称', colStore: '门店', colVendor: '厂商', colCameras: '摄像机数',
    empty: '尚未注册录像机。',
  },
  adminUsers: {
    title: '用户主数据',
    searchPlaceholder: '按姓名 / 邮箱搜索',
    allRoles: '所有角色',
    filterBtn: '筛选',
    clearBtn: '清除',
    showingLimit: '最多显示 500 条。请缩小搜索条件。',
    colName: '姓名',
    colTenant: '租户',
    colStoreCount: '负责门店数',
    colAuth: '认证',
    colEmail: '邮箱', colRole: '角色', colCreated: '注册日期',
    allStores: '所有门店',
    authVerified: '已认证',
    authNotLinked: '未关联',
    roleSuperAdmin: '超级管理员',
    roleTenantAdmin: '租户管理员',
    roleStoreManager: '门店经理',
    roleViewer: '仅查看',
    empty: '未找到用户',
  },
  adminImport: {
    title: 'CSV 批量导入',
    intro: '通过 CSV 批量导入门店、边缘、录像机和摄像机。',
  },
  adminAudit: {
    title: '访问日志',
    colTime: '时间', colActor: '执行者', colAction: '操作', colTarget: '对象', colDetail: '详情',
    empty: '暂无访问记录',
    totalSessions: (n) => `共 ${n.toLocaleString()} 个会话`,
    filterPrefix: '模式：',
    modeAll: '全部',
    modeGrid: '16分割监控',
    modeLive: 'LIVE',
    modeVod: 'VOD 回放',
    colUserId: '用户 ID',
    colStore: '门店',
    colMode: '模式',
    colCamera: '摄像头',
    colStartedAt: '开始时间',
    colEndedAt: '结束时间',
    colDuration: '时长',
    sessionActive: '进行中',
    pagination: (curr, total) => `第 ${curr} / ${total} 页`,
    prev: '← 上一页',
    next: '下一页 →',
  },
}

// ─── Korean ───────────────────────────────────────────────────────────────────

const ko: Msg = {
  appName: '모니터',
  nav: {
    monitor:  '모니터링',
    map:      '지도',
    playback: '재생',
    admin:    '설정',
    logs:     '로그',
    reports:  '보고서',
    settings: '설정',
    infra:    '헬스 모니터링',
    bcp:      'BCP',
    security: 'PATROL',
    logout:   '로그아웃',
  },
  kpi: {
    total:      '전체 매장',
    monitoring: '모니터링',
    live:       'LIVE',
    alerts:     '알림',
    interrupted: '모니터링 중단',
    bcp:         'BCP·기타',
  },
  status: {
    offline: '오프',
    idle:    '대기',
    grid:    '모니터링',
    live:    'LIVE',
    vod:     '재생중',
    error:   '오류',
    interrupted:   '모니터링 중단',
    stopped:       '모니터링 정지',
    recordingNote: '녹화는 레코더 본체에서 계속됩니다',
  },
  dashboard: {
    storeView:   '매장 목록',
    mapAlert:    '지도 + 알림',
    noStores:    '매장 데이터 없음',
    countUnit:   '개',
    alertsN:     (n) => `알림 ${n}건`,
    noAlerts:    '이상 없음',
    allGood:     '모든 매장이 정상 운영 중입니다',
    loadingMap:  '지도 로딩 중…',
    alertZoomOn:  '⚠ 알림 매장에 줌',
    alertZoomOff: '⚠ 전체 매장 표시',
    alertZoomEmpty: '알림 없음',
    alertZoomNoGeo: (n) => `알림 매장 ${n} 곳의 위도·경도가 등록되지 않았습니다. /admin/stores 에서 좌표를 설정하면 지도에 표시할 수 있습니다.`,
    alertZoomNoAlerts: '현재 알림 상태인 매장이 없습니다.',
  },
  alert: {
    edgeOffline:  '엣지 오프라인',
    edgeError:    '엣지 오류',
    unknownTime:  '알 수 없음',
    secsAgo:      (n) => `${n}초 전`,
    minsAgo:      (n) => `${n}분 전`,
    hoursAgo:     (n) => `${n}시간 전`,
    kind: {
      edge_offline: '엣지 오프라인',
      edge_error:   '엣지 오류',
      bcp:          'BCP 경보',
      incident:     '모니터링 인시던트',
      patrol:       '순찰 이상',
    },
  },
  workspace: {
    split16:           '16분할',
    unclassified:      '미분류',
    edgeNotRegistered: '엣지 서버 미등록',
    pressToStart:      '모니터링 버튼으로 시작',
    startMonitor:      '▶ 모니터링',
    stopMonitor:       '■ 정지',
    mapLink:           '지도',
    playbackBtn:       '⏪ 녹화',
    playbackHint:      '"녹화" 버튼을 눌러 재생을 시작하세요.',
    cameras:           '카메라',
    camRange:          (f, t) => `카메라 ${f}~${t}`,
    gridUnavailable:     '그리드 영상을 가져올 수 없습니다',
    gridUnavailableHint: '자동으로 재시도 중입니다. 카메라를 탭하면 개별 표시됩니다.',
    gridRetry:           '재시도',
  },
  vod: {
    modalTitle:  '녹화 재생',
    cameraLabel: '카메라',
    fromLabel:   '시작 시각',
    rangeLabel:  '재생 시간',
    minutesUnit: '분',
    maxLabel:    '최대',
    confirm:     '재생',
    cancel:      '취소',
    noVod:       '재생을 지원하는 카메라가 없습니다',
    connecting:       '연결 준비 중…',
    seeking:          '탐색 중…',
    noRecordingTitle: '지정한 범위에 녹화가 없습니다',
    cannotPlayTitle:  '재생할 수 없습니다',
    endedTitle:       '재생 종료',
    retry:            '다시 시도',
    watchAgain:       '다시 보기',
    pickAnother:      '다른 시간 선택',
    backToMonitor:    '모니터링으로',
  },
  drawer: {
    title:    '매장 선택',
    noStores: '매장 없음',
  },
  offline: {
    title: '오프라인',
    body:  '네트워크 연결이 없습니다.\n연결이 복구되면 자동으로 재개됩니다.',
    retry: '다시 시도',
  },
  adminNav: { dashboard: '대시보드', stores: '매장', edges: '엣지 서버', recorders: '레코더', users: '사용자', csvImport: 'CSV 일괄 등록', audit: '액세스 로그', limits: '세션 제한' },
  securityNav: { triage: '즉시 순찰', reports: '순찰 보고서', settings: '순찰 설정', cameras: '카메라 설정', glossary: '용어 설명' },
  securityHelp: {
    title: 'AI 경비 트리아지',
    body: '각 매장의 카메라를 정해진 간격(기본 30분)으로 순찰하고, AI 가 베이스라인 이미지와 비교하여「이상 / 확인 필요 / 정상」으로 분류합니다. 본 페이지는 모든 매장의 미확인 · 이상 검출을 하나의 큐로 집약해, 경비 담당자가 매장을 가로질러 판단할 수 있는「사람의 눈」 전용 화면입니다. AI 가 야간 · 역광에서 오검출하기 쉬운 부분은 확인 SLA 내에 사람이 최종 판단합니다.',
    learnMore: '용어 설명 보기',
  },
  securityGlossary: {
    title: '용어 설명 (경비)',
    intro: '경비 트리아지 · 순찰 기능에서 사용되는 용어 해설입니다.',
    crumb: '용어 설명',
  },
  bcpNav: { eventsReports: '알림 이력', jalerts: 'J-Alert 수신 이력', testIssue: '테스트 발령', glossary: '용어 설명' },
  bcpHelp: {
    title: 'J-Alert 연동 BCP 자동 기록',
    body: '일본 기상청·내각부가 발표하는 전국 즉시 경보 시스템 (J-Alert) 을 수신하면, 대상 지역 매장에 대해 자동으로 8 장의 JPEG 스냅샷 (5분 전 / 발생 시점 / 5분 후 / 10 / 15 / 20 / 25 / 30분 후) 을 저장하고 PDF 보고서를 생성합니다. 수동 개입 없이 증거를 보존할 수 있어 보험 및 행정 대응에 활용 가능합니다.',
    learnMore: '용어 설명 보기',
  },
  bcpGlossary: {
    title: '용어 설명 (BCP)',
    intro: 'BCP(사업 연속성 계획) 페이지에서 사용되는 용어 해설입니다.',
    crumb: '용어 설명',
  },
  infraNav: { dashboard: '대시보드', incidents: '인시던트', checks: '체크 설정', reports: '가동률 보고서', settings: '모니터링 설정', glossary: '용어 설명' },
  navTitle: { admin: '설정', security: 'PATROL', bcp: 'BCP', infra: '헬스 모니터링' },
  common: { open: '열기', notGenerated: '미생성', dash: '—' },
  infraIncidents: {
    title: '인시던트',
    sectionOpen:     (n) => `미대응 (${n})`,
    sectionAck:      (n) => `대응 중 (${n})`,
    sectionResolved: (n) => `해결 완료 (최근 ${n})`,
    emptyOpen:     '현재 미대응 인시던트가 없습니다.',
    emptyAck:      '대응 중인 인시던트가 없습니다.',
    emptyResolved: '해결된 인시던트가 아직 없습니다.',
    statusOpen: '미대응', statusAck: '대응 중', statusResolved: '해결 완료',
    severityInfo: 'info', severityWarn: 'warn', severityDanger: 'danger',
    colTime: '발생 시각', colStore: '매장', colTarget: '대상', colKind: '종류', colSeverity: '심각도', colStatus: '상태', colDetail: '상세',
    tenantLabel: '테넌트',
  },
  infraChecks: {
    title: '체크 설정',
    statRegistered: '등록된 체크', statEnabled: '활성화', statFailing: '연속 실패 중',
    empty: '아직 체크가 등록되지 않았습니다. /infra/settings 에서 매장 모니터링을 활성화하면 자동 등록됩니다.',
    colStore: '매장', colTarget: '대상', colCheckType: '체크 종류', colInterval: '주기', colStatus: '상태', colConsecFail: '연속 실패', colLastRun: '최종 실행',
    enabled: '활성', disabled: '비활성', intervalSuffix: '분',
    checkLabel: { heartbeat: '하트비트', ping: 'Ping', probe_camera: '카메라 프로브', storage: '스토리지', recording_gap: '녹화 간격', ntp: 'NTP 동기화', tamper: '변조 감지', version: '버전' },
  },
  infraReports: {
    title: '가동률 보고서', empty: '아직 보고서가 생성되지 않았습니다. 일/주/월 집계가 실행되면 여기 표시됩니다.',
    colStore: '매장', colKind: '종류', colPeriod: '대상 기간', colGenerated: '생성 시각', colPdf: 'PDF', colEmails: '발송처',
    kindDaily: '일간', kindWeekly: '주간', kindMonthly: '월간',
  },
  securityReports: {
    title: '순찰 보고서',
    statRegistered: '등록 보고서', statTotalRuns: '누적 순찰 횟수', statTotalRunsSub: (d) => `(완료 ${d})`,
    statAnomalies: '이상 검출', statReviews: '확인 필요 대기열',
    empty: '아직 보고서가 생성되지 않았습니다. 일/주 집계가 실행되면 여기 표시됩니다.',
    colStore: '매장', colPeriod: '대상 기간', colGenerated: '생성 시각', colRuns: '순찰', colDone: '완료', colAnomalies: '이상', colReviews: '확인 필요', colPdf: 'PDF', colEmails: '발송처',
  },
  breadcrumb: {
    admin: '설정', security: 'PATROL', bcp: 'BCP', infra: '헬스 모니터링',
    infraIncidents: '인시던트', infraChecks: '체크 설정', infraReports: '가동률 보고서',
    securityReports: '순찰 보고서',
  },
  infraDashboard: {
    title: '인프라 헬스',
    healthLabel: { ok: '정상', warn: '주의', fail: '장애', unk: '미검증', maint: '점검' },
    networkOutageTitle: '네트워크/연결 장애 의심',
    networkOutageBody: '여러 거점이 동시에 무응답입니다. 개별 기기 상태를 확인할 수 없습니다(미검증 표시).',
    statMonitored: '모니터링 거점',
    statOpen: '미대응 인시던트',
    statUptime30d: '30일 평균 가동률',
    statActiveChecks: '능동 체크',
    activeChecksP2: 'P2에서 활성화',
    legendStatus: '상태:',
    allHealthyTitle: (n) => `전체 ${n}개 거점 정상 운영 중`,
    allHealthyBody: '미대응 인시던트가 없습니다. 각 거점의 사활 모니터링이 지속됩니다.',
    colStore: '매장', colEdge: '엣지', colRecorder: '레코더', colCamera: '카메라', colOpen: '미대응', colLastSeen: '최종 확인',
    notMonitored: '(미모니터링)',
    inMaintenance: '점검 중',
    incidentCount: (n) => `장애${n}`,
    clockSkew: (sec) => `NVR 시계 오차 ${sec}초`,
    emptyStores: '매장이 없습니다. 먼저 관리 화면에서 매장을 등록해주세요.',
    footerNote: 'P1: 엣지 사활은 last_seen_at 기반으로 판정. 레코더/카메라의 능동 체크(ping/영상 수신 확인)는 P2에서 활성화됩니다.',
  },
  securityTriage: {
    title: '즉시 순찰',
    statTotalStores: '모니터링 거점',
    statAlerting: '이상 감지 중',
    statAllNormal: '전부 정상',
    statRunsToday: '오늘의 순찰 수',
    statUnconfirmed: '미확인 이상',
    statAiCoverage: 'AI 검증 커버리지(오늘)',
    sectionAlerts: '대응이 필요한 감지',
    sectionNormal: '정상 운영 중',
    emptyAlerts: '현재 대응이 필요한 감지가 없습니다.',
    emptyNormal: '모니터링 중인 거점이 없습니다.',
    colStore: '매장', colCam: '카메라', colKind: '감지 종류', colSnapshot: '스냅샷', colTime: '시각', colReviewed: '확인',
    snapshot: '스냅샷',
    reviewed: '확인 완료',
    notReviewed: '미확인',
    allNormalTitle: '전체 거점 이상 없음',
    allNormalBody: '미확인 이상이 없습니다. 각 거점의 순찰이 지속됩니다.',
    colLastRun: '최근 순찰',
    colStatus: '상태',
    statusNormal: '정상',
    waitingForPatrol: '순찰 대기',
    noStoresYet: '순찰 대상 매장이 아직 없습니다.',
    noStoresSettingsLink: '순찰 설정',
  },
  securitySettings: {
    title: '순찰 설정',
    intro: '매장별 순찰 활성/비활성, 순찰 주기, 확인 SLA, 자동 보고서 설정.',
    sectionStores: '매장별 순찰 설정',
    colStore: '매장', colEnabled: '활성', colInterval: '순찰 주기', colReviewSla: '확인 SLA', colAutoReport: '자동 보고서',
    empty: '매장이 등록되지 않았습니다.',
    noPatrol: '미설정',
  },
  securityCameras: {
    title: '카메라 설정',
    intro: '카메라별 녹화/순찰 참여 설정.',
    statCameras: '카메라 총수', statEnabled: '순찰 대상', statRecording: '녹화 중',
    colStore: '매장', colCamName: '카메라', colVendor: '벤더', colRecording: '녹화', colPatrol: '순찰',
    empty: '카메라가 없습니다. 먼저 관리 화면에서 레코더와 카메라를 등록해주세요.',
    promptNotice: '비교 프롬프트는 "문이 닫혀있는가" 등의 상태 감지만 기술해주세요. 개인 식별 · 안면 인식은 수행하지 않습니다.',
    unassigned: '미할당',
    storeWithCount: (n) => `(${n}대)`,
    colCamera: '카메라',
    colPatrolShort: '순찰',
    colPrompt: '비교 프롬프트(상태 감지만)',
    colSensitivity: '감도',
    colBaselineUrls: '기준 이미지(주/야) URL',
  },
  infraSettings: {
    title: '모니터링 설정',
    intro: '매장별 모니터링 활성/비활성, 엣지 오프라인 판정 시간, 점검 기간 설정.',
    sectionStores: '매장별 모니터링 설정',
    colStore: '매장', colEnabled: '활성', colEdgeThreshold: '엣지 오프라인 임계치', colMaintUntil: '점검 기한',
    empty: '매장이 등록되지 않았습니다.',
    minutesUnit: '분',
  },
  infraGlossary: {
    title: '용어 설명',
    intro: '인프라 모니터링에서 사용되는 용어 해설.',
  },
  bcpDashboard: {
    title: 'BCP',
    testIssueBtn: '🚨 테스트 발령',
    tabReports: '보고서',
    tabEvents: '이벤트 목록',
    statTotal: 'BCP 이벤트 총수', statOpen: '미해결', statResolved: '해결 완료', statClips: '저장 클립',
    statGeneratedReports: '생성된 보고서',
    statPdfDelivered: 'PDF 발송 완료',
    sectionEvents: '최근 이벤트',
    sectionReports: '최근 보고서',
    emptyEvents: '아직 이벤트가 없습니다.',
    emptyEventsTitle: 'BCP 이벤트가 없습니다',
    emptyEventsBody: 'J-Alert 가 발령되면 이벤트가 여기에 표시됩니다.',
    emptyReports: '아직 보고서가 없습니다.',
    emptyReportsTitle: '보고서가 없습니다',
    emptyReportsBody: 'BCP 이벤트 발생 후 보고서가 자동 생성되면 여기에 표시됩니다.',
    colTime: '시각', colStore: '매장명', colEventKind: '이벤트 종류', colStatus: '상태', colReports: '보고서',
    colAlertType: '경보 종류',
    colIssuedAt: '발령 시각',
    colArea: '지역 코드',
    colIntensity: '진도',
    colKind: '종류',
    colGeneratedAt: '생성 시각',
    colRecipients: '발송처',
    colActions: '작업',
    statusOpen: '대응 중', statusInProgress: '진행 중', statusResolved: '해결 완료',
    statusPending: '처리 중',
    statusRecording: '녹화 중',
    statusClipsUploaded: '업로드 완료',
    statusReportGenerated: '보고서 생성',
    statusCompleted: '완료',
    statusFailed: '실패',
    severityInfo: 'info', severityWarn: 'warn', severityDanger: 'danger',
    alertTypeSpecialWarning: '특별경보',
    alertTypeTsunami: '쓰나미 정보',
    alertTypeEarthquake: '지진 정보',
    alertTypeMissile: '미사일 정보',
    alertTypeTest: '테스트',
    testBadge: '테스트',
    detail: '상세',
    pdfLabel: 'PDF',
    notSent: '미발송',
    recipientsCount: (n) => `${n}건`,
    open: '열기',
    colStoreCount: '대상 매장',
    storeCountValue: (n) => `${n} 매장`,
    statusPartial: '일부 완료',
    expandAria: '대상 매장 펼치기',
    collapseAria: '대상 매장 접기',
  },
  bcpTest: {
    title: '테스트 알림 발령',
    intro: '실제 이벤트를 잘못 발생시키지 않도록 테스트 발령은 스테이징 전용입니다.',
    formStoreLabel: '대상 매장',
    formKindLabel: '이벤트 종류',
    formSeverityLabel: '심각도',
    formNoteLabel: '메모',
    formSubmit: '테스트 발령 생성',
    formCancel: '취소',
    sentTitle: '테스트 발령을 생성했습니다',
    sentBody: 'BCP 대시보드에서 상태 전이를 확인해주세요.',
    crumb: '테스트 발령',
    backLink: '← BCP 이벤트 목록으로 돌아가기',
  },
  adminDashboard: {
    title: '마스터 관리 대시보드',
    statStores: '매장', statEdges: '엣지 서버', statRecorders: '레코더', statUsers: '사용자',
    statCameras: '카메라', statOnline: '온라인', statOffline: '오프라인',
    quickLinksTitle: '바로가기',
  },
  adminStores: {
    title: '매장 마스터',
    addBtn: '+ 매장 추가',
    csvImportBtn: '⇪ CSV 일괄 등록',
    searchPlaceholder: '매장명으로 검색',
    areaPlaceholder: '지역 코드',
    filterBtn: '필터',
    editLink: '편집',
    notSet: '미설정',
    showingLimit: '최대 500건 표시 중. 검색 조건을 좁혀주세요.',
    colName: '매장명', colCode: '코드', colArea: '지역', colEdges: '엣지', colRecorders: '레코더', colStatus: '상태',
    colAddress: '주소',
    colGeo: '좌표',
    colActive: '활성',
    empty: '매장을 찾을 수 없습니다',
  },
  adminEdges: {
    title: '엣지 서버',
    addBtn: '+ 신규 등록',
    searchPlaceholder: '엣지명으로 검색',
    allStatuses: '모든 상태',
    filterBtn: '필터',
    editLink: '편집',
    colName: '이름', colStore: '매장', colStatus: '상태', colLastSeen: '최근 연결', colVersion: '버전',
    colArea: '지역',
    colRecorders: '레코더',
    empty: '엣지 서버를 찾을 수 없습니다',
  },
  adminRecorders: {
    title: '레코더',
    colName: '이름', colStore: '매장', colVendor: '벤더', colCameras: '카메라 수',
    empty: '등록된 레코더가 없습니다.',
  },
  adminUsers: {
    title: '사용자 마스터',
    searchPlaceholder: '이름 / 이메일로 검색',
    allRoles: '모든 권한',
    filterBtn: '필터',
    clearBtn: '지우기',
    showingLimit: '최대 500건 표시 중. 검색 조건을 좁혀주세요.',
    colName: '이름',
    colTenant: '테넌트',
    colStoreCount: '담당 매장 수',
    colAuth: '인증',
    colEmail: '이메일', colRole: '권한', colCreated: '등록일',
    allStores: '전체 매장',
    authVerified: '인증 완료',
    authNotLinked: '미연동',
    roleSuperAdmin: '슈퍼 관리자',
    roleTenantAdmin: '테넌트 관리자',
    roleStoreManager: '매장 매니저',
    roleViewer: '열람 전용',
    empty: '사용자를 찾을 수 없습니다',
  },
  adminImport: {
    title: 'CSV 일괄 등록',
    intro: '매장 · 엣지 · 레코더 · 카메라를 CSV로 일괄 등록할 수 있습니다.',
  },
  adminAudit: {
    title: '액세스 로그',
    colTime: '시각', colActor: '실행자', colAction: '액션', colTarget: '대상', colDetail: '상세',
    empty: '액세스 기록이 없습니다',
    totalSessions: (n) => `총 ${n.toLocaleString()} 세션`,
    filterPrefix: '모드:',
    modeAll: '전체',
    modeGrid: '16분할 모니터링',
    modeLive: 'LIVE',
    modeVod: 'VOD 재생',
    colUserId: '사용자 ID',
    colStore: '매장',
    colMode: '모드',
    colCamera: '카메라',
    colStartedAt: '시작 시각',
    colEndedAt: '종료 시각',
    colDuration: '시간',
    sessionActive: '진행 중',
    pagination: (curr, total) => `${curr} / ${total} 페이지`,
    prev: '← 이전',
    next: '다음 →',
  },
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const MESSAGES: Record<Lang, Msg> = { ja, en, zh, ko }
