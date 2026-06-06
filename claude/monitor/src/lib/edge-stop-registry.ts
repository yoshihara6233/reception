/**
 * F75: Shared pending-stop registry for edge mode commands.
 *
 * Why this module exists — cross-mode race
 * ─────────────────────────────────────────
 * When a user navigates between /grid (16-split) and /live (single camera),
 * the OLD page's cleanup sends a `stop_*` command, and the NEW page's mount
 * sends a `start_*` command, both targeting the same edge_id. These are
 * pushed to a central command queue and pulled by the edge ~every 500 ms.
 *
 * If the OLD cleanup's stop arrives AFTER the NEW mount's start (which is
 * common with fast SPA navigation OR React StrictMode dev double-mount),
 * the edge ends up in `idle` state and the new page goes dark.
 *
 * MonitorWorkspace (grid) and live-player (live) each USED to maintain
 * their own pending-stop Map (F11/F30, F74). That fixed same-mode races
 * (/grid → /grid, /live → /live) but NOT cross-mode (/live → /grid):
 * the grid mount couldn't see the live cleanup's pending stop_stream.
 *
 * This module unifies all pending stops under a single edge-keyed Map so
 * ANY mode mount can cancel ANY prior mode's pending stop.
 *
 * Pattern
 * ───────
 *   useEffect(() => {
 *     cancelPendingStop(edgeId)            // on mount
 *     sendCommand('start_grid')
 *     ...
 *     return () => {
 *       scheduleStop(edgeId, () =>          // on unmount
 *         sendCommand('stop_grid'), 300)
 *     }
 *   }, [edgeId])
 */

type Handle = ReturnType<typeof setTimeout>

const REGISTRY = new Map<string, Handle>()

/**
 * Cancel any pending stop_* command for this edge.
 *
 * Call from useEffect when a mode component (grid/live/future) mounts. If
 * a previous component's cleanup already scheduled a stop within the delay
 * window, this prevents it from firing.
 */
export function cancelPendingStop(edgeId: string): void {
  const handle = REGISTRY.get(edgeId)
  if (handle) {
    clearTimeout(handle)
    REGISTRY.delete(edgeId)
  }
}

/**
 * Schedule a stop_* command after `delayMs`. If a new mount cancels the
 * pending stop for this edge before the delay elapses, `stopFn` is never
 * invoked. Last-writer-wins: any prior pending stop for this edge is
 * replaced.
 */
export function scheduleStop(
  edgeId: string,
  stopFn: () => void,
  delayMs: number,
): Handle {
  const prior = REGISTRY.get(edgeId)
  if (prior) clearTimeout(prior)

  const handle = setTimeout(() => {
    REGISTRY.delete(edgeId)
    stopFn()
  }, delayMs)
  REGISTRY.set(edgeId, handle)
  return handle
}

/**
 * Test/debug helper — number of edges with a pending stop. Not used in
 * production code; exposed for unit tests.
 */
export function pendingStopCount(): number {
  return REGISTRY.size
}
