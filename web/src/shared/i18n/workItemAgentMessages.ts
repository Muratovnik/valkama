export const workItemAgentMessages = {
  en: {
    agents: {
      tab: 'Agents {count}',
      holdsStep: 'Holds step:',
      started: 'Started',
      ended: 'ended',
      lastActivity: 'last activity',
      noSignal: 'no sign of it since',
      fromStart: '{time} from the start',
      linkExact: 'wrote to this item',
      linkClaim: "by the coordinator's claim",
      linkAmbiguous:
        'ambiguous: the coordinator held {count} item | ambiguous: the coordinator held {count} items',
    },
  },
  ru: {
    agents: {
      tab: 'Агенты {count}',
      holdsStep: 'Держит шаг:',
      started: 'Запущен',
      ended: 'завершён',
      lastActivity: 'последняя активность',
      noSignal: 'с тех пор сигналов нет',
      fromStart: '{time} от начала',
      linkExact: 'писал в эту задачу',
      linkClaim: 'по захвату координатора',
      linkAmbiguous:
        'неоднозначно: координатор держал {count}\u{A0}задачу | неоднозначно: координатор держал {count}\u{A0}задачи | неоднозначно: координатор держал {count}\u{A0}задач',
    },
  },
}
