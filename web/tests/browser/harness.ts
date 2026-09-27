import { createPinia } from 'pinia'
import { createApp, defineComponent, h, ref } from 'vue'

import AppContextBar from '@/app/components/AppContextBar.vue'

import SessionsView from '@/pages/sessions/SessionsView.vue'

import AnalyticsDashboard from '@/widgets/analytics-dashboard/components/AnalyticsDashboard.vue'
import AppNav from '@/widgets/app-nav/components/AppNav.vue'
import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'
import WorkItemTile from '@/widgets/work-item-views/components/WorkItemTile.vue'

import type { PlanningWorkflow, WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { uiReady } from '@/shared/api/platformUiState.ts'
import { i18n } from '@/shared/i18n/index.ts'
import type { AgentSession } from '@/shared/types/session.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import InspectorFrame from '@/shared/ui/InspectorFrame.vue'
import OverlayHost from '@/shared/ui/OverlayHost.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import '@/app/styles/index.css'

import { analyticsPayload } from './analyticsFixtures.ts'

import './harness.css'

/** The two fixture rows whose status is not the default, by their index. */
const FIXTURE_STATUS_BY_INDEX: Record<number, string> = { 2: 'failed', 5: 'ended' }

const now = new Date().toISOString()
const modules = structuredClone(OFFLINE_MODULE_FALLBACK)
const sessionSpaceRef = {
  data_scope_id: '00000000-0000-4000-8000-000000000700',
  space_key: 'MAIN',
}
const sessionResourceRef = planningSpaceEntity(sessionSpaceRef)
/** Which session the harness has open, standing in for the route entity. */
const openSession = ref<string | null>(null)
const sessions: AgentSession[] = Array.from({ length: 6 }, (_, index) => ({
  id: `session-${index}`,
  client: index % 2 ? 'claude' : 'codex',
  client_family: index % 2 ? 'claude' : 'codex',
  adapter_id: index % 2 ? 'claude-sessions' : 'codex-sessions',
  cwd: 'C:/workspace/example-project',
  label:
    index === 0
      ? 'Длинное название рабочей сессии для проверки переполнения'
      : `example-project-${index}`,
  work_item: `MAIN-${index + 200}`,
  status: FIXTURE_STATUS_BY_INDEX[index] ?? 'active',
  attention: index < 4 ? 'waiting' : '',
  attention_seen: index === 5,
  started_at: now,
  last_seen: now,
  ended_at: index === 5 ? now : null,
  quiet_seconds: 840,
  current_step: index === 0 ? 'Проверяет длинный статус без наложения текста' : '',
  space_root: {
    canonical_root: 'C:/workspace/example-project',
    reason: '',
    resource_ref: sessionResourceRef,
    status: 'mapped',
  },
  scope: 'example-project',
}))
const contextResources = [
  { resource_ref: sessionResourceRef, state: 'mapped' as const },
  {
    resource_ref: planningSpaceEntity({
      data_scope_id: '00000000-0000-4000-8000-000000000701',
      space_key: 'OTHER',
    }),
    state: 'mapped' as const,
  },
]
const contextProjects = [
  {
    binding_state: 'mapped' as const,
    project_id: 'project-alpha',
    resources: contextResources,
    title: 'Проект с длинным рабочим названием',
  },
]
const REVIEW_STATE = {
  state_id: '00000000-0000-4000-8000-000000000901',
  key: 'review',
  name: 'Review',
  category: 'review' as const,
  is_terminal: false,
}

const testItem: WorkItemBrief = {
  work_item_id: '00000000-0000-4000-8000-000000000241',
  planning_space_id: '00000000-0000-4000-8000-000000000800',
  reference: 'MAIN-241',
  number: 241,
  title: 'Системный контракт интерфейса с длинным заголовком',
  kind: 'task',
  state: REVIEW_STATE,
  priority: 'high',
  claim_ref: 'codex',
  parent_id: '00000000-0000-4000-8000-000000000199',
  // Labels as long as the operator's own space carries, because a tile in a
  // 264px column is where this product keeps losing content off the edge and a
  // tame fixture is why no test ever saw it.
  labels: ['example-project', 'design-system', 'accessibility'],
  source: '',
  container: false,
  ready: false,
  checklist: Array.from({ length: 7 }, (_, index) => ({
    id: `00000000-0000-4000-8000-00000000030${index}`,
    text: `Шаг ${index + 1}`,
    done: index < 4,
    claimed_by: '',
    done_by: index < 4 ? 'codex' : '',
  })),
  revision: 4,
  created_at: now,
  updated_at: now,
  comment_count: 3,
}

/** One state is enough: the inspector reads the workflow only to offer moves. */
const testWorkflow: PlanningWorkflow = {
  workflow_id: '00000000-0000-4000-8000-000000000700',
  name: 'Default',
  initial_state_id: REVIEW_STATE.state_id,
  states: [{ ...REVIEW_STATE, position: 0 }],
  transitions: [],
}

/** The inspector's body: one command. Named so the render tree stays readable. */
function inspectorBody(openCommand: () => void) {
  return {
    default: () => h('button', { type: 'button', onClick: openCommand }, 'Открыть команду'),
  }
}

const Harness = defineComponent({
  setup() {
    const requestedSurface = new URLSearchParams(location.search).get('surface')
    const analyticsHarness = requestedSurface === 'analytics'
    const contextHarness = requestedSurface === 'context-bar'
    const itemHarness = requestedSurface === 'work-item'
    const active = ref<ModuleId>('sessions')
    const surfaceInspector = ref(false)
    const surfaceDialog = ref(false)
    const openSurfaceDialog = () => {
      surfaceDialog.value = true
    }
    const selectedRuntime = ref('codex')
    if (contextHarness) {
      return () =>
        h('main', { class: 'harness-shell' }, [
          h(AppNav, {
            modules,
            active: active.value,
            badges: { sessions: 18 },
            connection: 'live',
          }),
          h('div', { class: 'app-main context-harness-main' }, [
            h(AppContextBar, {
              activities: [],
              activityNavigable: () => false,
              description:
                'Follow live agents and intervene when work requires a careful operator response.',
              projects: contextProjects,
              resources: contextResources,
              resourceRef: contextResources[0]?.resource_ref,
              scope: {
                kind: 'project',
                project_ref: { project_id: 'project-alpha' },
              },
              title: 'Sessions',
            }),
          ]),
        ])
    }
    return () =>
      h('main', { class: 'harness-shell' }, [
        h(AppNav, {
          modules,
          active: active.value,
          badges: { sessions: 18 },
          connection: 'live',
          onNavigate: (module: ModuleId) => {
            active.value = module
          },
        }),
        h('div', { class: 'harness-main' }, [
          h(
            'button',
            {
              type: 'button',
              class: 'surface-test-trigger',
              onClick: () => {
                surfaceInspector.value = true
              },
            },
            'Открыть тестовую панель',
          ),
          analyticsHarness || active.value === 'analytics'
            ? h(AnalyticsDashboard, {
                open: true,
                payload: analyticsPayload,
                state: uiReady(true),
              })
            : h(SessionsView, {
                state: uiReady({ inbox: [], sessions }),
                selected: openSession.value,
                revisions: Object.fromEntries(
                  sessions.map((session) => [session.id, session.last_seen]),
                ),
                // The harness plays the stage here: the open session lives in
                // the route, and this is the route it has.
                // Only the id is needed here; naming the whole session type in a
                // callback position is what the type-aware pass cannot resolve.
                onSelect: (session: { id: string } | null) => {
                  openSession.value = session?.id ?? null
                },
              }),
          h('ul', { class: 'harness-card-list' }, [
            h('li', {}, [h(WorkItemTile, { item: testItem, blocked: false, ready: false })]),
          ]),
          h('div', { class: 'edge-choice' }, [
            h(SelectionControl, {
              'modelValue': selectedRuntime.value,
              'label': 'Граничный выбор среды',
              'searchable': true,
              'searchPlaceholder': 'Найти среду',
              'emptyLabel': 'Совпадений нет',
              'options': [
                { value: 'codex', label: 'Codex', icon: 'codex' },
                { value: 'claude', label: 'Claude Code с очень длинным описанием', icon: 'claude' },
                { value: 'terminal', label: 'Терминал', icon: 'terminal' },
              ],
              'onUpdate:modelValue': (value: string) => {
                selectedRuntime.value = value
              },
            }),
          ]),
          itemHarness
            ? h(WorkItemInspector, {
                projectId: 'example-project',
                reference: testItem.reference,
                resourceRef: sessionResourceRef,
                canGoBack: false,
                refreshToken: 0,
                workflow: testWorkflow,
                writable: true,
                kernel: null,
              })
            : null,
        ]),
        h(
          OverlayHost,
          {
            open: surfaceInspector.value,
            variant: 'drawer',
            layer: 'drawer',
            title: 'Тестовая панель',
            ariaLabel: 'Тестовая панель',
            interactive: !surfaceDialog.value,
            resizable: true,
            resizeLabel: 'Изменить ширину тестовой панели',
            onClose: () => {
              surfaceInspector.value = false
            },
          },
          {
            default: () =>
              h(
                InspectorFrame,
                {
                  title: 'Тестовая панель',
                  closeLabel: 'Закрыть тестовую панель',
                  onClose: () => {
                    surfaceInspector.value = false
                  },
                },
                inspectorBody(openSurfaceDialog),
              ),
          },
        ),
        h(
          DialogFrame,
          {
            open: surfaceDialog.value,
            title: 'Настройка команды',
            subtitle: 'Проверка вложенной поверхности и выбора с клавиатуры.',
            closeLabel: 'Закрыть настройку команды',
            onClose: () => {
              surfaceDialog.value = false
            },
          },
          {
            default: () =>
              h(SelectionControl, {
                'modelValue': selectedRuntime.value,
                'label': 'Среда запуска',
                'mode': 'combobox',
                'searchable': true,
                'searchPlaceholder': 'Найти среду',
                'emptyLabel': 'Совпадений нет',
                'options': [
                  {
                    value: 'codex',
                    label: 'Codex',
                    description: 'Локальная рабочая среда',
                    icon: 'codex',
                  },
                  {
                    value: 'claude',
                    label: 'Claude Code',
                    description: 'Каталог сессий',
                    icon: 'claude',
                  },
                  {
                    value: 'terminal',
                    label: 'Терминал',
                    description: 'Командная строка',
                    icon: 'terminal',
                  },
                ],
                'onUpdate:modelValue': (value: string) => {
                  selectedRuntime.value = value
                },
              }),
            footer: () =>
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    surfaceDialog.value = false
                  },
                },
                'Готово',
              ),
          },
        ),
      ])
  },
})

i18n.global.locale.value = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'ru'
document.documentElement.lang = i18n.global.locale.value
createApp(Harness).use(createPinia()).use(i18n).mount('#app')
