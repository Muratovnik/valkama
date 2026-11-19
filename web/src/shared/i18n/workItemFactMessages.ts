/**
 * What a card's facts say of how the work came to be done and who is on it: why and when it
 * was accepted, that a task waiting to be taken was already started, who works on a goal or a
 * stage, and a step its former holder marked.
 *
 * The bases of acceptance are the server's (`ACCEPTANCE_BASES`), each said as the reason a
 * person reads: who decided the work is to be done.
 */
export const workItemFactMessages = {
  en: {
    facts: {
      accepted: 'Accepted',
      acceptedOn: '{basis} · {date}',
      basis: {
        owner: 'owner',
        assignment: 'on assignment',
        inherited: 'as part of the goal',
        label_rule: 'by label rule',
        agent: 'agent’s decision',
        migrated: 'accepted before 3.0',
      },
      started: 'started',
      startedOn: 'Started {date}',
      working: 'Working: {count}',
      holds: 'Holds {references}',
      byPreviousHolder: 'marked by the former holder',
    },
  },
  ru: {
    facts: {
      accepted: 'Принято',
      acceptedOn: '{basis} · {date}',
      basis: {
        owner: 'владелец',
        assignment: 'по поручению',
        inherited: 'как часть цели',
        label_rule: 'по правилу метки',
        agent: 'решение агента',
        migrated: 'принято до 3.0',
      },
      started: 'начата',
      startedOn: 'Начата {date}',
      working: 'Работают: {count}',
      holds: 'Держит {references}',
      byPreviousHolder: 'отмечено прежним исполнителем',
    },
  },
} as const
