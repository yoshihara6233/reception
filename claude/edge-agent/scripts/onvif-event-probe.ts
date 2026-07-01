/**
 * ONVIF Event 購読 go/no-go プローブ（PB5 B0・実機スパイク）。
 *
 * 指定カメラの ONVIF Event(PullPoint) を購読し、60秒間 PullMessages で通知を取り出して
 * 表示する。動体・接点などのイベントが流れてくれば「GO」（＝エッジ側の自動発報検知が作れる）。
 * 何も来なければ「NO-GO」（機種がイベントを出さない／設定が要る）→ Frigate MQTT 源へ切替判断。
 *
 * 使い方（Beelink 上）:
 *   cd /home/intereco/intereco/claude/edge-agent   # または current の同等パス
 *   bun scripts/onvif-event-probe.ts <host> <onvif_port> <user> <pass>
 *   例) bun scripts/onvif-event-probe.ts 192.168.0.50 80 admin 'パスワード'
 *
 * host/port/user/pass は recorders テーブル（host, onvif_port, username, password）参照。
 * 実行中にカメラの前で動く／接点を作動させるとイベントが出やすい。
 */
import { OnvifSoapClient } from '../src/adapters/onvif/onvif-soap-client.ts'

const [host, portArg, user, pass] = process.argv.slice(2)
if (!host || !user || pass === undefined) {
  console.error('usage: bun scripts/onvif-event-probe.ts <host> <onvif_port> <user> <pass>')
  process.exit(2)
}
const port = Number(portArg || 80)

async function main() {
  const client = new OnvifSoapClient({
    endpoint: `http://${host}:${port}`,
    username: user,
    password: pass,
    timeoutMs: 15_000,
  })

  console.log(`[probe] ${host}:${port} で ONVIF Event を購読します…`)
  const sub = await client.createPullPointSubscription(300)
  console.log(`[probe] subscription = ${sub}`)
  console.log('[probe] 60秒間 PullMessages で待機します（カメラの前で動くとイベントが出やすい）…')

  const deadline = Date.now() + 60_000
  let count = 0
  while (Date.now() < deadline) {
    try {
      const evs = await client.pullMessages(sub, 10, 20)
      for (const e of evs) {
        count++
        console.log(`[event] ${new Date().toISOString()} topic=${e.topic || '(none)'} ${JSON.stringify(e.items)}`)
      }
    } catch (err) {
      console.warn('[probe] PullMessages error:', (err as Error).message)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  if (count > 0) {
    console.log(`\n✅ GO: 60秒で ${count} 件のイベントを受信。エッジ自動発報検知(B1)を実装できます。`)
  } else {
    console.log('\n❌ NO-GO: 60秒でイベント無し。カメラ側で動体/イベント通知を有効化するか、Frigate MQTT 源への切替を検討してください。')
  }
  process.exit(0)
}

main().catch((e) => { console.error('[probe] fatal:', e); process.exit(1) })
