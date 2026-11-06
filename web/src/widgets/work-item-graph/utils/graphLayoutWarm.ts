/**
 * One layout worker started before the graph needs it.
 *
 * A graph field creates its worker with its first layout, when the space has
 * already been read; only then does the worker begin to load ELK, a script of
 * about one and a half megabytes, so the first layout after a page load waited
 * for that download on top of its own work. The page knows earlier that the
 * graph is coming — the address names it, or the pointer rests on the switch
 * to it — and warms a spare engine then: creating one starts its worker, and a
 * tiny graph with the real layout's options takes it once through the code
 * the real layout runs. The answer is thrown away.
 *
 * The graph's runner takes the spare instead of creating an engine, and hands
 * back what it took when it ends it. A spare nobody takes within a minute is
 * ended, so a page that never opens the graph does not keep a worker; one that
 * failed its warm-up is ended at once, and the runner gets a fresh one. While a
 * field holds an engine nothing is warmed: it already has its worker.
 *
 * The spare is module state on purpose, as the runner it serves is one per
 * field and the field is one per page: the moment the page warms and the
 * moment the field mounts are not parent and child, and this module is what
 * joins them without either knowing about the other.
 */

import type { ELK, ElkNode } from 'elkjs/lib/elk-api'

import {
  FRAME_HEADER,
  NODE_HEIGHT,
  NODE_WIDTH,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { createGraphLayoutEngine } from '@/widgets/work-item-graph/utils/graphLayoutEngine.ts'
import {
  frameOptions,
  HIERARCHY_OPTIONS,
  looseOptions,
  ROOT_OPTIONS,
} from '@/widgets/work-item-graph/utils/graphLayoutTree.ts'

/** How long a spare waits to be taken before its worker is ended. */
export const SPARE_LIFETIME_MS = 60_000

let spare: ELK | undefined
let expiry: ReturnType<typeof setTimeout> | undefined
/** Engines a field has taken and not yet handed back. */
let taken = 0

const card = (id: string) => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT })

/** The smallest graph that goes the real layout's way: root, component, frame, block. */
export function warmGraph(): ElkNode {
  return {
    id: 'warm',
    layoutOptions: { ...ROOT_OPTIONS },
    children: [
      {
        id: 'component:0',
        layoutOptions: { ...HIERARCHY_OPTIONS },
        children: [
          {
            id: 'frame',
            layoutOptions: frameOptions(FRAME_HEADER),
            children: [
              card('a'),
              card('b'),
              { id: 'frame:loose', layoutOptions: looseOptions(2, 1), children: [card('c')] },
            ],
          },
        ],
        edges: [{ id: 'a>b', sources: ['a'], targets: ['b'] }],
      },
    ],
  }
}

function discard() {
  clearTimeout(expiry)
  expiry = undefined
  spare?.terminateWorker()
  spare = undefined
}

/** Start a spare engine's worker, unless one is waiting or a field holds its own. */
export function warmGraphLayout(): void {
  if (spare !== undefined || taken > 0) return
  const engine = createGraphLayoutEngine()
  spare = engine
  expiry = setTimeout(discard, SPARE_LIFETIME_MS)
  engine.layout(warmGraph()).catch(() => {
    // A worker that failed its warm-up is not trusted with the graph.
    if (spare === engine) discard()
  })
}

/** The engine a field lays out on: the warm spare when there is one, else a new one. */
export function takeGraphLayoutEngine(): ELK {
  taken += 1
  const engine = spare
  if (engine === undefined) return createGraphLayoutEngine()
  clearTimeout(expiry)
  expiry = undefined
  spare = undefined
  return engine
}

/** End an engine a field took, and stop counting it as held. */
export function dropGraphLayoutEngine(engine: ELK): void {
  taken = Math.max(0, taken - 1)
  engine.terminateWorker()
}
