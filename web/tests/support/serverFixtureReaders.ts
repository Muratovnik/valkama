/**
 * What reads each of the server's answers the web reads (`serverFixtures.test.ts`): the strict
 * validator of the call that reads it, and the answers only an agent reads.
 */
import {
  validateQuotaAnswer,
  validateQuotaWindowAnswer,
  validateUsageAnswer,
} from '@/shared/api/analyticsApi.ts'
import { validateCommentResolved, validateCommentWritten } from '@/shared/api/commentWriteModel.ts'
import { validateDecisionsPage } from '@/shared/api/decisionsApi.ts'
import {
  validateDocument,
  validateFound,
  validateRefusal,
  validateResolved,
} from '@/shared/api/documentApi.ts'
import { readCancelList } from '@/shared/api/inputRequestAction.ts'
import {
  validateInputRequestDetail,
  validateInputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import { validateLiveFrame } from '@/shared/api/liveFrameModel.ts'
import { validateOpenPlaces, validateOpenPlan } from '@/shared/api/openPlanModel.ts'
import { validateParticipation, validateSpaceRecord } from '@/shared/api/participationApi.ts'
import { validateWorkItemChain } from '@/shared/api/planningChainApi.ts'
import { validateGlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import {
  validateMovedItem,
  validateReadModel,
  validateWorkItemRecord,
} from '@/shared/api/planningModel.ts'
import { readRefusal } from '@/shared/api/planningRefusal.ts'
import {
  validateItemUsageAnswer,
  validateSessionUsageAnswer,
} from '@/shared/api/planningUsageApi.ts'
import {
  validatePlanningWorkItemBriefPayload,
  validatePlanningWorkItemPayload,
  validatePlatformPlanningPayload,
} from '@/shared/api/platformPlanningPayload.ts'
import { validateAttachedCommit } from '@/shared/api/unattachedCommitsApi.ts'
import { validateGoalVolumesAnswer, validateVolumesAnswer } from '@/shared/api/volumesApi.ts'

/** A refusal reader answers null for an envelope it cannot read; a fixture must not be one. */
const unread = (value: unknown): never => {
  throw new Error(`the web reads no refusal in ${JSON.stringify(value)}`)
}

/** Each fixture the web reads, with the validator of the call that reads it. */
export const FIXTURE_READERS: Record<string, (value: unknown) => unknown> = {
  'analytics-quota.json': validateQuotaAnswer,
  'analytics-quota-window.json': validateQuotaWindowAnswer,
  'analytics-usage.json': validateUsageAnswer,
  'analytics-usage-seat.json': validateUsageAnswer,
  'analytics-usage-account.json': validateUsageAnswer,
  'card.json': (value) => validatePlanningWorkItemPayload(value),
  // A space's board and its Volumes read over one period (`workFilterClosed.test.ts`).
  'closed-in-period.json': (value) => {
    const { board, volumes, volumes_labelled: labelled } = value as Record<string, unknown>
    return {
      board: validateReadModel(board),
      volumes: validateVolumesAnswer(volumes),
      volumes_labelled: validateVolumesAnswer(labelled),
    }
  },
  'card-brief.json': (value) => validatePlanningWorkItemBriefPayload(value),
  'card-in-goal-brief.json': (value) => validatePlanningWorkItemBriefPayload(value),
  'card-executors.json': (value) => validatePlanningWorkItemPayload(value),
  'card-goal.json': (value) => validatePlanningWorkItemPayload(value),
  'card-deferred.json': (value) => validatePlanningWorkItemPayload(value),
  'card-returned.json': (value) => validatePlanningWorkItemPayload(value),
  'card-deferred-comments.json': (value) => validatePlanningWorkItemPayload(value),
  'card-returned-comments.json': (value) => validatePlanningWorkItemPayload(value),
  'card-converted.json': (value) => validatePlanningWorkItemPayload(value),
  'commit-attached.json': validateAttachedCommit,
  'decisions.json': validateDecisionsPage,
  'comment-reply.json': validateCommentWritten,
  'comment-resolved.json': validateCommentResolved,
  'description-told.json': (value) => validateWorkItemRecord(value),
  'documents-read.json': validateDocument,
  'documents-refused.json': validateRefusal,
  'documents-resolve-unbound.json': validateResolved,
  'documents-resolve.json': validateResolved,
  'documents-search.json': validateFound,
  'goal-volumes.json': validateGoalVolumesAnswer,
  'live-frame.json': validateLiveFrame,
  'open-places.json': validateOpenPlaces,
  'open-plan-copy.json': validateOpenPlan,
  'open-plan-file-desktop.json': validateOpenPlan,
  'open-plan-file.json': validateOpenPlan,
  'open-plan-folder.json': validateOpenPlan,
  'open-plan-no-session.json': validateOpenPlan,
  'open-plan-refused.json': validateOpenPlan,
  'open-plan-session-desktop.json': validateOpenPlan,
  'open-plan-silent-desktop.json': validateOpenPlan,
  'open-plan-silent.json': validateOpenPlan,
  'open-plan-session.json': validateOpenPlan,
  'participation-shared.json': validateParticipation,
  'participation-space.json': validateParticipation,
  'participation-written.json': validateParticipation,
  'planning-chain-tree.json': (value) => validateWorkItemChain(value),
  'planning-portfolio.json': (value) => validatePlatformPlanningPayload(value),
  'planning-read-model.json': (value) => validateReadModel(value),
  'planning-search.json': validateGlobalPlanningSearch,
  'refusal-apply-step.json': (value) => readRefusal(value) ?? unread(value),
  'refusal-cancel-list.json': (value) => readCancelList(value) ?? unread(value),
  'request-answered.json': validateInputRequestDetail,
  'request-pending.json': validateInputRequestDetail,
  'request-proposed-goal.json': validateInputRequestDetail,
  'request-session-gone.json': validateInputRequestDetail,
  'request-triage-group.json': validateInputRequestDetail,
  'requests-triage-due.json': validateInputRequestList,
  'requests.json': validateInputRequestList,
  'space-settings.json': validateSpaceRecord,
  'transition-returned.json': (value) => validateMovedItem(value),
  'usage-item.json': validateItemUsageAnswer,
  'usage-session.json': validateSessionUsageAnswer,
  'volumes-filtered.json': validateVolumesAnswer,
  'volumes-project.json': validateVolumesAnswer,
  'volumes-space.json': validateVolumesAnswer,
}
/** What only an agent reads: the MCP answers, which no web schema describes. */
export const AGENT_ONLY = new Set([
  // The server's closed lists, which `serverFixtures.test.ts` holds the web's to; the keys
  // of the texts it composes, which `composedText.test.ts` holds the web's schemas to.
  'open-vocabulary.json',
  'composed-texts.json',
  'doctor-vocabulary.json',
  'mcp-get-work-item.json',
  'mcp-get-work-item-thread.json',
  'mcp-get-work-item-unresolved.json',
])
