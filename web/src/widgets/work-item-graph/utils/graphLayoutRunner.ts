/**
 * One ELK worker kept for the life of a graph field.
 *
 * A worker loads the whole of ELK before it lays anything out, which cost every
 * layout about a tenth of a second on an idle machine and seconds on a busy one
 * while each layout started its own; so the worker stays between layouts.
 *
 * ELK's worker answers one request after another and cannot drop one it has
 * begun, and a terminated worker never answers at all. So one layout runs at a
 * time: a layout asked for while another still runs ends that worker and starts
 * on a fresh one at once, rather than waiting behind work nobody will draw, and
 * the layout it replaced rejects instead of landing late.
 */

import type { ELK, ElkNode } from 'elkjs/lib/elk-api'

import { createGraphLayoutEngine } from '@/widgets/work-item-graph/utils/graphLayoutEngine.ts'

export function createGraphLayoutRunner() {
  let engine: ELK | undefined
  let running: { reject: (error: Error) => void } | undefined

  function release() {
    engine?.terminateWorker()
    engine = undefined
  }

  /** Stops the layout still running, which ends its worker; an idle worker stays. */
  function stop() {
    const run = running
    if (!run) return
    running = undefined
    release()
    run.reject(new Error('Graph layout stopped'))
  }

  /** Lays out `graph` on the kept worker, stopping whatever layout was still running. */
  function layout(graph: ElkNode): Promise<ElkNode> {
    stop()
    engine ??= createGraphLayoutEngine()
    const worker = engine
    return new Promise<ElkNode>((resolve, reject) => {
      const run = { reject }
      running = run
      worker.layout(graph).then(
        (result) => {
          if (running !== run) return
          running = undefined
          resolve(result)
        },
        (error: unknown) => {
          if (running !== run) return
          running = undefined
          // A worker that failed a layout is not trusted with the retry.
          release()
          reject(
            error instanceof Error ? error : new Error('Graph layout failed', { cause: error }),
          )
        },
      )
    })
  }

  /** Ends the worker, running or idle: the field that owned it is gone. */
  function dispose() {
    stop()
    release()
  }

  return { dispose, layout, stop }
}
