import ELK from 'elkjs/lib/elk-api'

import ElkWorker from '@/widgets/work-item-graph/utils/graphLayout.worker.ts?worker'

/** A separate same-origin worker keeps layout work off the camera/UI thread. */
export function createGraphLayoutEngine() {
  return new ELK({ algorithms: ['layered'], workerFactory: () => new ElkWorker() })
}
