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
      status: 'pending',
      author: 'operator',
      answered_by: '',
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
