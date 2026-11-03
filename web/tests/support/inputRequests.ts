import type { InputRequestEntry, InputRequestList } from '@/shared/api/inputRequestModel.ts'

export function requestEntry(): InputRequestEntry {
  return {
    target: {
      project_id: 'requests-project',
      space_ref: { data_scope_id: '11111111-1111-4111-8111-111111111111', space_key: 'TASK' },
      reference: 'TASK-7',
      writable: true,
    },
    request: {
      request_id: '22222222-2222-4222-8222-222222222222',
      work_item_id: '33333333-3333-4333-8333-333333333333',
      reference: 'TASK-7',
      title: 'Confirm deployment',
      kind: 'decision',
      prompt: 'Should deployment proceed?',
      fields: [{ id: 'proceed', label: 'Proceed', type: 'boolean', required: true, options: [] }],
      answers: null,
      note: null,
      own: null,
      field_notes: null,
      answer_version: 0,
      history: [],
      status: 'pending',
      author: 'operator',
      answered_by: '',
      by_person: null,
      execution_id: 'execution-7',
      session_id: 'session-7',
      expires_at: null,
      created_at: '2026-10-24T10:00:00Z',
      resolved_at: null,
      revision: 1,
      expired_reason: null,
    },
  }
}

export function requestList(items = [requestEntry()]): InputRequestList {
  const target = requestEntry().target
  return {
    interface_version: 'valkama-planning-requests',
    items,
    coverage: [
      {
        project_id: target.project_id,
        space_ref: target.space_ref,
        status: 'searched',
        reason: null,
      },
    ],
    limit: 100,
    has_more: false,
  }
}

/** Two pending questions in one source, the first asked later than the second. */
export function twoQuestions(): [InputRequestEntry, InputRequestEntry] {
  const newer = requestEntry()
  newer.request = {
    ...newer.request,
    request_id: '55555555-5555-4555-8555-555555555555',
    title: 'Newer question',
    created_at: '2026-10-24T11:00:00Z',
  }
  const older = requestEntry()
  older.request = { ...older.request, title: 'Older question' }
  return [newer, older]
}
/** The parts besides `answers` of a first answer that gave no own variant and no comment. */
export const firstAnswer = { own: {}, field_notes: {}, answer_version: 1 } as const

export const answered = (entry: InputRequestEntry, by = 'user'): InputRequestEntry => ({
  ...entry,
  request: {
    ...entry.request,
    status: 'answered',
    answers: { proceed: true },
    ...firstAnswer,
    answered_by: by,
    by_person: by === 'user',
    resolved_at: '2026-10-24T12:00:00Z',
    revision: 2,
  },
})

/** A source the listing could not read, for the reason the server gave. */
export function unavailableSource(project: string, reason: string) {
  return {
    project_id: project,
    space_ref: requestEntry().target.space_ref,
    status: 'unavailable' as const,
    reason,
  }
}
