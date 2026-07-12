/**
 * 自律OTA の副作用アダプタ（git / fs / systemctl）。判断は core.ts に委譲する。
 *
 * on-box レイアウト（docs/edge-ota-design.md §1）:
 *   $EDGE_ROOT/{repo, releases/<sha>, current->, known-good->, shared/{agent.env, ota-state.json}, bin}
 *
 * 実機でのみ意味を持つ（git worktree・symlink・systemctl）。ローカル/CI では
 * EDGE_ROOT 未設定なら no-op で安全に空振りする（ブートを止めない）。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '../logger.js'
import { runPreRestart } from './pre-restart.js'
import {
  type OtaState,
  type DesiredVersions,
  type HealthProbeInput,
  initialState,
  shouldUpdateAgent,
  beginUpdate,
  enterPendingVerify,
  verifyStep,
  OTA_DEFAULTS,
} from './core.js'

const exec = promisify(execFile)

/** EDGE_ROOT 配下のパス群。EDGE_ROOT 未設定なら OTA 無効（null）。 */
export interface OtaPaths {
  root: string
  repo: string
  releases: string
  current: string
  knownGood: string
  state: string
  envFile: string
}

export function resolvePaths(edgeRoot: string | undefined): OtaPaths | null {
  if (!edgeRoot) return null
  return {
    root: edgeRoot,
    repo: join(edgeRoot, 'repo'),
    releases: join(edgeRoot, 'releases'),
    current: join(edgeRoot, 'current'),
    knownGood: join(edgeRoot, 'known-good'),
    state: join(edgeRoot, 'shared', 'ota-state.json'),
    envFile: join(edgeRoot, 'shared', 'agent.env'),
  }
}

/** releases/<sha>/VERSION に焼く版文字列を組む（git short sha 想定）。 */
export function releaseDir(paths: OtaPaths, version: string): string {
  return join(paths.releases, version)
}

const ISO = () => new Date().toISOString()

/** ota-state.json を読む。無ければ running 版で初期化。壊れていても初期化にフォールバック。 */
export async function readState(paths: OtaPaths, runningVersion: string): Promise<OtaState> {
  try {
    const raw = await fs.readFile(paths.state, 'utf8')
    const parsed = JSON.parse(raw) as Partial<OtaState>
    if (typeof parsed.running_version === 'string' && typeof parsed.status === 'string') {
      return parsed as OtaState
    }
    logger.warn('ota: state file shape invalid → re-init')
  } catch {
    /* 無い/壊れている → 初期化 */
  }
  return initialState(runningVersion, ISO())
}

export async function writeState(paths: OtaPaths, state: OtaState): Promise<void> {
  await fs.mkdir(join(paths.root, 'shared'), { recursive: true })
  // 原子的書き込み（tmp→rename）で部分書き込みを避ける。
  const tmp = `${paths.state}.tmp`
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, paths.state)
}

/** current/VERSION を読む。無ければ 'unknown'。 */
export async function readRunningVersion(paths: OtaPaths): Promise<string> {
  try {
    const v = await fs.readFile(join(paths.current, 'VERSION'), 'utf8')
    return v.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
  logger.info({ cmd, args }, 'ota: exec')
  await exec(cmd, args, { cwd: opts.cwd, timeout: 600_000 })
}

/**
 * desired 版の release を作る:
 *  git fetch → releases/<sha> へ worktree → agent.env symlink → bun install → typecheck プリフライト。
 * 失敗時は例外（呼び出し側で rolled_back 扱い）。
 */
export async function stageRelease(paths: OtaPaths, version: string): Promise<void> {
  const dir = releaseDir(paths, version)
  // 既存 release があれば作り直さない（冪等）。
  try {
    await fs.access(join(dir, 'VERSION'))
    logger.info({ version }, 'ota: release already staged')
    return
  } catch {
    /* 未展開 → 作る */
  }
  await run('git', ['fetch', '--depth', '50', 'origin'], { cwd: paths.repo })
  await run('git', ['worktree', 'add', '--force', '--detach', dir, version], { cwd: paths.repo })
  // 機密 env を release 外から symlink（release に機密を置かない）。
  await fs.rm(join(dir, 'claude', 'edge-agent', '.env'), { force: true }).catch(() => {})
  await run('bun', ['install', '--frozen-lockfile'], { cwd: dir })
  await fs.writeFile(join(dir, 'VERSION'), version + '\n', 'utf8')
  // プリフライト: 最低限コンパイル/型が通ること。
  await run('bun', ['run', 'typecheck'], { cwd: join(dir, 'claude', 'edge-agent') })
}

/** current シンボリックリンクを差し替える（原子的: tmp symlink → rename）。 */
export async function pointCurrent(paths: OtaPaths, target: string): Promise<void> {
  const tmp = `${paths.current}.tmp`
  await fs.rm(tmp, { force: true }).catch(() => {})
  await fs.symlink(target, tmp)
  await fs.rename(tmp, paths.current)
}

/** known-good シンボリックリンクを差し替える。 */
export async function pointKnownGood(paths: OtaPaths, target: string): Promise<void> {
  const tmp = `${paths.knownGood}.tmp`
  await fs.rm(tmp, { force: true }).catch(() => {})
  await fs.symlink(target, tmp)
  await fs.rename(tmp, paths.knownGood)
}

/**
 * 自プロセスを終了して systemd の Restart=always に再起動を任せる。
 *
 * 自ユニットへ `systemctl restart` を撃つ方式は実機ドライランで2つの罠を露呈した:
 *   (1) 自死: restart 完了待ちの間に systemd が自プロセスを SIGTERM で停止し、
 *       `systemctl` クライアントが殺されて非ゼロ終了＝誤失敗になる。
 *   (2) sudoers 引数整合: `--no-block` を足すと NOPASSWD の完全一致が崩れ認証要求。
 * exit(0) なら sudo 不要・確実。新 current は WorkingDirectory=current 経由で反映され、
 * Restart=always（RestartSec=5）が新版で立て直す。current 切替と pending_verify は
 * exit の前に永続化済みなので、再起動後に verifyOnBoot が検証/復帰する。
 *
 * exit 前に **pre-restart クリーンアップ**（アクティブモードの ffmpeg 子プロセス停止）を
 * 必ず実行する。取り残すと systemd の stop-sigterm がタイムアウトし unit が
 * 'failed/timeout' → OnFailure のロールバックが誤発火する（2026-07-12 実機障害）。
 */
async function requestSelfRestart(): Promise<never> {
  await runPreRestart()
  logger.info('ota: exiting for systemd restart (Restart=always) onto current')
  process.exit(0)
}

export interface RunnerDeps {
  /** 環境変数群（テストで差し替え）。 */
  edgeRoot: string | undefined
  agentUnit: string
  minStableMs: number
  heartbeatGraceMs: number
}

/**
 * desired 版の受信時に呼ぶ。更新が必要なら release を作って current を切替え、
 * pending_verify を記録して service を再起動する。再起動後の検証は verifyOnBoot が担う。
 */
export async function applyDesired(deps: RunnerDeps, desired: DesiredVersions): Promise<void> {
  const paths = resolvePaths(deps.edgeRoot)
  if (!paths) return // EDGE_ROOT 無し＝OTA 無効（ローカル/CI）
  const running = await readRunningVersion(paths)
  const state = await readState(paths, running)

  const decision = shouldUpdateAgent(running, desired.agent, state)
  if (!decision.update) {
    logger.debug({ reason: decision.reason, desired: desired.agent }, 'ota: no agent update')
    return
  }
  const target = desired.agent as string
  logger.info({ from: running, to: target }, 'ota: starting agent self-update')

  // (1) ステージだけを try で囲む。ここで失敗＝current 未切替なので現行版のまま安全に
  //     rolled_back（失敗版を cooldown 登録）。典型例: typecheck プリフライト不合格。
  try {
    await stageRelease(paths, target)
  } catch (err) {
    logger.error({ err: (err as Error).message, target }, 'ota: stage failed → abort (current unchanged)')
    await writeState(paths, {
      ...state,
      status: 'rolled_back',
      last_failed_version: target,
      last_error: `stage_failed: ${(err as Error).message}`,
      updated_at: ISO(),
    })
    return
  }

  // (2) 切替＋再起動。pending_verify を先に永続化 → current を切替え → 自プロセス終了。
  //     systemd(Restart=always) が新 current で立て直し、起動後に verifyOnBoot が検証する。
  const next = beginUpdate(state, target, ISO())
  await writeState(paths, next)
  await pointCurrent(paths, releaseDir(paths, target))
  await requestSelfRestart()
}

/**
 * 起動直後に呼ぶ。pending_verify があれば健全性プローブを回し、
 * 健全 → known-good 昇格 / 不健全 → known-good へ symlink を戻して再起動。
 * probe は「heartbeat 到達したか」を返すコールバックで供給する。
 */
export async function verifyOnBoot(
  deps: RunnerDeps,
  probe: () => Promise<HealthProbeInput>,
): Promise<void> {
  const paths = resolvePaths(deps.edgeRoot)
  if (!paths) return
  const running = await readRunningVersion(paths)
  let state = await readState(paths, running)
  if (!state.pending_verify_version) return // 通常起動

  state = enterPendingVerify(state, ISO())
  await writeState(paths, state)
  logger.info({ verifying: state.pending_verify_version }, 'ota: verifying new release after restart')

  const deadline = Date.now() + deps.heartbeatGraceMs + 5_000
  // 安定待ち＋heartbeat到達待ちをポーリング。
  for (;;) {
    const p = await probe()
    const step = verifyStep(state, p, ISO())
    if (step.action === 'promote') {
      state = step.state
      await pointKnownGood(paths, releaseDir(paths, state.known_good_version as string))
      await writeState(paths, state)
      logger.info({ version: state.known_good_version }, 'ota: promoted to known-good')
      return
    }
    if (step.action === 'rollback') {
      state = step.state
      await pointCurrent(paths, paths.knownGood) // current を known-good へ戻す
      await writeState(paths, state)
      logger.warn({ reason: step.reason, back_to: state.known_good_version }, 'ota: rolling back')
      await requestSelfRestart() // 旧版で立て直す（systemd Restart=always）
    }
    if (Date.now() > deadline) {
      // 念のための保険（probe が永遠に pending を返す異常系）。
      state = verifyStep(
        state,
        { heartbeatReached: false, stableMs: deps.minStableMs, minStableMs: deps.minStableMs },
        ISO(),
      ).state
      await pointCurrent(paths, paths.knownGood)
      await writeState(paths, state)
      await requestSelfRestart()
    }
    await new Promise((r) => setTimeout(r, 5_000))
  }
}

export { OTA_DEFAULTS }
