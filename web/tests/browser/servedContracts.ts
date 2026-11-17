/**
 * Which strict contract the page applies to each answer a browser spec serves.
 *
 * The page rejects a whole answer when one record in it breaks a rule, and a
 * spec then waits for an element that never comes; nothing in its trace says the
 * schema refused. This table is what lets `tests/browserRecords.test.ts` pass every
 * served record through the same validator the page uses for that route, so a
 * broken record fails in seconds and by name. Each entry calls the function the
 * page's own read calls, or parses with the schema that read parses with.
 *
 * An answer the page does not read strictly has no entry: a refusal (the page reads
 * it with `readRefusal`), the echo of what the page itself wrote, and the routes the
 * page reads without a contract (`/api/ref`, `/api/session`, `/api/activity`).
 */
import {
  settingsSchema as alertSettingsSchema,
  statusSchema as alertStatusSchema,
  trialSchema as alertTrialSchema,
} from '@/shared/api/alertsApi.ts'
import { validateQuotaAnswer, validateUsageAnswer } from '@/shared/api/analyticsApi.ts'
import { validateCommentResolved, validateCommentWritten } from '@/shared/api/commentWriteModel.ts'
import { parseContract } from '@/shared/api/contract.ts'
import type { z } from '@/shared/api/contract.ts'
import { validateDoctorReport } from '@/shared/api/doctorApi.ts'
import { validateDocument, validateFound, validateResolved } from '@/shared/api/documentApi.ts'
import {
  validateAttached,
  validateCapabilities,
  validateHistory,
} from '@/shared/api/executionModel.ts'
import { keptSchema } from '@/shared/api/imageApi.ts'
import {
  validateInputRequestDetail,
  validateInputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import { validateLiveFrame } from '@/shared/api/liveFrameModel.ts'
import {
  linksSchema as memoryLinksSchema,
  providersSchema as memoryProvidersSchema,
  searchSchema as memorySearchSchema,
} from '@/shared/api/memoryApi.ts'
import { validateOpenPlaces, validateOpenPlan } from '@/shared/api/openPlanModel.ts'
import { validateWorkItemChain } from '@/shared/api/planningChainApi.ts'
import { validateGlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import { validateReadModel, validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import { searchSchema as planningSearchSchema } from '@/shared/api/planningSearchApi.ts'
import {
  validateItemUsageAnswer,
  validateSessionUsageAnswer,
} from '@/shared/api/planningUsageApi.ts'
import { invalid } from '@/shared/api/platformApiGuards.ts'
import { validatePlatformContextPayload } from '@/shared/api/platformContextPayload.ts'
import { validateModulesPayload } from '@/shared/api/platformModuleContract.ts'
import {
  validatePlanningWorkItemBriefPayload,
  validatePlanningWorkItemPayload,
  validatePlatformPlanningPayload,
} from '@/shared/api/platformPlanningPayload.ts'
import {
  namesSchema as quotaNamesSchema,
  settingsSchema as quotaSettingsSchema,
} from '@/shared/api/quotaApi.ts'

/** One answer as a spec serves it: the route it answers and the body it sends. */
export interface Served {
  body: unknown
  /** Where the record comes from, as a reader finds it: the file and the record's name. */
  name: string
  /** The path the page asks, with the query when the contract depends on it. */
  url: string
  method?: 'GET' | 'POST' | 'PUT'
  /** What a write sent, where the contract the page applies depends on it. */
  sent?: unknown
}

type Check = (body: unknown, query: URLSearchParams, sent?: unknown) => unknown

/** A reply's answer names its root; the answer to a remark of its own the page does not read. */
const isReply = (sent: unknown) =>
  typeof sent === 'object' && sent !== null && ('reply_to' in sent || 'reply_to_request' in sent)

const parsed =
  (schema: z.ZodTypeAny, path: string): Check =>
  (body) =>
    parseContract(schema, body, path, invalid)

/** The item writes the page reads back as the item they changed. */
const ITEM_WRITES = [
  '/api/planning/work-items',
  '/api/planning/work-item/transition',
  '/api/planning/work-item/claim',
  '/api/planning/work-item/checklist/tick',
  '/api/planning/work-item/checklist',
  '/api/planning/work-item/update',
  '/api/planning/work-item/report',
  '/api/planning/work-item/summary/select',
]

const GET: Record<string, Check> = {
  '/api/planning': (body) => validateReadModel(body),
  '/api/planning/search': parsed(planningSearchSchema, 'planning.search'),
  '/api/planning/work-items': parsed(planningSearchSchema, 'planning.search'),
  '/api/planning/work-item/chain': (body) => validateWorkItemChain(body),
  '/api/planning/work-item/usage': (body) => validateItemUsageAnswer(body),
  '/api/planning/session/usage': (body) => validateSessionUsageAnswer(body),
  '/api/modules/planning/work-item': (body, query) =>
    query.get('brief') === 'true'
      ? validatePlanningWorkItemBriefPayload(body)
      : validatePlanningWorkItemPayload(body),
  '/api/modules/planning/search': (body) => validateGlobalPlanningSearch(body),
  '/api/modules/planning/requests': (body) => validateInputRequestList(body),
  '/api/modules/planning/request': (body) => validateInputRequestDetail(body),
  '/api/modules': (body) => validateModulesPayload(body),
  '/api/platform/context': (body) => validatePlatformContextPayload(body),
  '/api/platform/planning': (body) => validatePlatformPlanningPayload(body),
  '/api/analytics/usage': (body) => validateUsageAnswer(body),
  '/api/analytics/quota': (body) => validateQuotaAnswer(body),
  '/api/execution/capabilities': (body) => validateCapabilities(body),
  '/api/execution/history': (body) => validateHistory(body),
  '/api/doctor': (body) => validateDoctorReport(body),
  '/api/open-plan': (body) => validateOpenPlan(body),
  '/api/open-places': (body) => validateOpenPlaces(body),
  '/api/documents/resolve': (body) => validateResolved(body),
  '/api/documents/search': (body) => validateFound(body),
  '/api/documents/read': (body) => validateDocument(body),
  '/api/memory/search': parsed(memorySearchSchema, 'memory.search'),
  '/api/memory/providers': parsed(memoryProvidersSchema, 'memory.providers'),
  '/api/memory/linked': parsed(memoryLinksSchema, 'memory.links'),
  '/api/alerts/settings': parsed(alertSettingsSchema, 'alerts.settings'),
  '/api/alerts/status': parsed(alertStatusSchema, 'alerts.status'),
  '/api/quota/settings': parsed(quotaSettingsSchema, 'quota.settings'),
  '/api/quota/account-names': parsed(quotaNamesSchema, 'quota.names'),
}

const POST: Record<string, Check> = {
  ...Object.fromEntries(
    ITEM_WRITES.map((path) => [path, (body: unknown) => validateWorkItemRecord(body)]),
  ),
  '/api/planning/work-item/comment': (body, _query, sent) =>
    isReply(sent) ? validateCommentWritten(body) : body,
  '/api/planning/work-item/comment/resolve': (body) => validateCommentResolved(body),
  '/api/planning/work-item/pin': (body) => validateLiveFrame(body),
  '/api/execution/attach': (body) => validateAttached(body),
  '/api/alerts/test': parsed(alertTrialSchema, 'alerts.test'),
  '/api/images': parsed(keptSchema, 'images.upload'),
}

/** The contract for a request, or null when the page reads that answer without one. */
function contractFor(method: string, url: string): Check | null {
  const { pathname } = new URL(url, 'http://localhost')
  if (method === 'GET') return GET[pathname] ?? null
  if (pathname.startsWith('/api/modules/planning/request/'))
    return (body) => validateInputRequestDetail(body)
  return POST[pathname] ?? null
}

/**
 * Pass one served answer through its contract, and say which record broke it.
 * The error the contract throws names a path such as `planning.work_items.3.workable`;
 * the item at that index is named by its reference so a reader finds it in the file.
 */
export function checkServed({ name, method = 'GET', url, body, sent }: Served): string | null {
  const check = contractFor(method, url)
  if (!check) return `${name}: ${method} ${url} has no contract the page applies`
  try {
    check(body, new URL(url, 'http://localhost').searchParams, sent)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `${name}: ${method} ${url} ${recordAt(body, message)}${message}`
  }
}

function recordAt(body: unknown, message: string): string {
  const [, key = '', index = ''] =
    /\.(work_items|items|members|executions)\[(\d+)\]/u.exec(message) ?? []
  const list = (body as Record<string, unknown> | null)?.[key]
  const record = Array.isArray(list) ? (list[Number(index)] as Record<string, unknown>) : null
  const item = record?.item as Record<string, unknown> | undefined
  const label = record?.reference ?? item?.reference ?? record?.work_item_id ?? record?.execution_id
  return typeof label === 'string' ? `(record ${label}) ` : ''
}
