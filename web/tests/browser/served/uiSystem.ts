/**
 * The card and the run history the interface-system spec opens: one item under review
 * with a report as its summary, and one partial run of it. Built at each read, so the
 * times are the moment the page asked.
 */
import { asRoot } from '../../support/threads.ts'
import type { Served } from '../servedContracts.ts'

export const uiSystemCard = () => ({
  interface_version: 'valkama-planning-work-item',
  scope: {
    kind: 'space',
    space_ref: { data_scope_id: '00000000-0000-4000-8000-000000000700', space_key: 'MAIN' },
  },
  work_item_ref: {
    space_ref: { data_scope_id: '00000000-0000-4000-8000-000000000700', space_key: 'MAIN' },
    reference: 'MAIN-241',
  },
  state: {
    interface_version: 'valkama-ui-state',
    status: 'ready',
    payload: {
      work_item: {
        work_item_id: '00000000-0000-4000-8000-000000000241',
        planning_space_id: '00000000-0000-4000-8000-000000000800',
        reference: 'MAIN-241',
        number: 241,
        title: 'System interface contract',
        kind: 'task',
        state: {
          state_id: '00000000-0000-4000-8000-000000000901',
          key: 'review',
          name: 'Review',
          category: 'review',
          is_terminal: false,
        },
        priority: 'high',
        claim_ref: 'codex',
        claim_state: 'unconfirmed',
        claim: {
          holder: 'codex',
          state: 'unconfirmed',
          session_id: null,
          agent_id: null,
          source: null,
          acquired_at: null,
          last_seen: null,
          expires_at: null,
        },
        parent_id: null,
        labels: [],
        projects: [],
        source: '',
        open: true,
        container_state: null,
        acceptance: null,
        started_at: null,
        waits_for: [],
        workable: false,
        withheld: ['not_ready'],
        lapsed_claim: null,
        checklist: [],
        revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        description:
          'First loaded line\nSecond loaded line\nThird loaded line\nFourth loaded line\nFifth loaded line\nSixth loaded line',
        summary_comment_id: 1,
        summary: {
          done: 'First loaded line\nSecond loaded line\nThird loaded line\nFourth loaded line\nFifth loaded line\nSixth loaded line',
          next: 'Continue review',
          why: '',
        },
        links: [],
        refs: [],
        comments: [
          {
            id: 1,
            kind: 'report',
            ...asRoot,
            report: {
              done: 'First loaded line\nSecond loaded line\nThird loaded line\nFourth loaded line\nFifth loaded line\nSixth loaded line',
              next: 'Continue review',
              why: '',
            },
            body: '',
            author: 'user',
            at: null,
          },
        ],
        events: [],
      },
    },
  },
})

export const uiSystemHistory = () => ({
  interface_version: 'valkama-execution-api',
  work_item: 'MAIN-241',
  executions: [
    {
      execution_id: 'exec-1a2b3c4d5e6f708192a3b4c5d6e7f809',
      work_item_id: '00000000-0000-4000-8000-000000000241',
      project_id: 'example-project',
      adapter_lineage_id: 'claude-code-execution',
      client_family: 'claude',
      role: 'executor',
      environment: 'workdir',
      model: 'opus',
      effort: 'high',
      expected_effect: 'change_required',
      review_mode: '',
      status: 'partial',
      presence: 'terminal',
      outcome: 'partial',
      launch_id: 'launch-0123456789ab',
      cwd: 'C:/workspace/example-project',
      resumed_from: '',
      exit_code: 0,
      result: {
        outcome: 'partial',
        delivery: 'Половина контракта готова, вторая осталась без оракула.',
        oracle: 'suite green',
        unresolved: 'Оракул приёмки не выполнялся.',
        structured: true,
        expected_effect: 'change_required',
      },
      base_artifact: null,
      final_artifact: {
        head: '3333333333333333333333333333333333333333',
        branch: 'main',
        dirty: true,
        changed_files: 2,
        insertions: 18,
        deletions: 4,
        commits: [],
        quality: 'observed',
        added: [],
      },
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      revision: 2,
      sessions: [],
    },
  ],
})

const CARD_READ =
  '/api/modules/planning/work-item?scope_kind=space&data_scope_id=00000000-0000-4000-8000-000000000700&space_key=MAIN&reference=MAIN-241'

export const served: Served[] = [
  { name: 'served/uiSystem.ts uiSystemCard()', url: CARD_READ, body: uiSystemCard() },
  {
    name: 'served/uiSystem.ts uiSystemHistory()',
    url: '/api/execution/history?work_item=MAIN-241',
    body: uiSystemHistory(),
  },
]
