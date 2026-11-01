import { createPinia } from 'pinia'
import { createApp, defineComponent, h, ref } from 'vue'

import AppContextBar from '@/app/components/AppContextBar.vue'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'
import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'
import WorkItemTile from '@/widgets/work-item-views/components/WorkItemTile.vue'

import type { PlanningWorkflow, WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { i18n } from '@/shared/i18n/index.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import InspectorFrame from '@/shared/ui/InspectorFrame.vue'
import OverlayHost from '@/shared/ui/OverlayHost.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import '@/app/styles/index.css'

import { now } from './planningFixtures.ts'

import './harness.css'

const modules = structuredClone(OFFLINE_MODULE_FALLBACK).filter((module) =>
  ['planning', 'settings'].includes(module.module_id),
)
const sessionSpaceRef = {
  data_scope_id: '00000000-0000-4000-8000-000000000700',
  space_key: 'MAIN',
}
const sessionResourceRef = planningSpaceEntity(sessionSpaceRef)
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
  claim_state: 'unconfirmed',
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

/**
 * Every weight `VButton` has, labelled and icon-only, enabled and disabled, on
 * the workspace ground and on a ground — what a state test reads its drawn colours from.
 */
const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const

function buttonMatrix() {
  return h(
    'div',
    { class: 'harness-buttons' },
    ['canvas', 'surface'].map((ground) =>
      h(
        'section',
        { 'class': `harness-button-ground ground-${ground}`, 'data-ground': ground },
        BUTTON_VARIANTS.flatMap((variant) =>
          [false, true].flatMap((disabled) => [
            h(
              VButton,
              {
                variant,
                disabled,
                'data-case': `${ground}:${variant}:label:${disabled ? 'off' : 'on'}`,
              },
              () => 'Взять',
            ),
            h(
              VButton,
              {
                variant,
                disabled,
                'icon': true,
                'aria-label': 'Закрыть',
                'data-case': `${ground}:${variant}:icon:${disabled ? 'off' : 'on'}`,
              },
              () => h(VIcon, { name: 'close', size: 16 }),
            ),
          ]),
        ),
      ),
    ),
  )
}

const Harness = defineComponent({
  setup() {
    const requestedSurface = new URLSearchParams(location.search).get('surface')
    const contextHarness = requestedSurface === 'context-bar'
    const itemHarness = requestedSurface === 'work-item'
    if (requestedSurface === 'buttons') return () => buttonMatrix()
    const active = ref<ModuleId>('planning')
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
            badges: { planning: 2 },
            active: active.value,
            connection: 'live',
          }),
          h('div', { class: 'app-main context-harness-main' }, [
            h(AppContextBar, {
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
          badges: { planning: 2 },
          active: active.value,
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
