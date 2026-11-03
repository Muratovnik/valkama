/* The copy of the Windows alerts settings, in both languages. */

export const alertMessages = {
  en: {
    alerts: {
      title: 'Windows notifications',
      intro:
        'Valkama shows a Windows notification when an agent is waiting for you, even with its window closed. A click opens the work item.',
      loadFailed: 'Could not read the notification settings.',
      saveFailed: 'Not saved: {reason}',
      enabled: 'Notify me when an agent is waiting for me',
      enabledHint: 'Turning this off keeps the events you chose.',
      on: 'On',
      off: 'Off',
      events: 'Events',
      eventsHint: 'About what agents did. Your own actions do not notify you.',
      event: {
        question: 'An answer or a decision is needed',
        review: 'A work item is in review',
        launchFailed: 'A launch from Valkama failed',
      },
      contentLabel: 'What to show',
      contentHint:
        'The lock screen shows the same. To hide the text there, use Windows: Settings → System → Notifications → Valkama.',
      contentPromptHint: "The question's text stays in the Windows notification history.",
      content: {
        generic: 'Only “your answer is needed”',
        title: 'Work item number and title',
        prompt: 'Number, title and the question',
      },
      readinessLabel: 'Readiness',
      checking: 'Checking…',
      recheck: 'Check again',
      readiness: {
        'ready': { label: 'Ready' },
        'no-shortcut': {
          label: 'No Valkama shortcut',
          detail:
            'Windows shows notifications only for an app with a Start menu shortcut. Install Valkama Desktop.',
        },
        'disabled-for-application': {
          label: 'Windows turned off Valkama notifications',
          detail: 'Turn them on: Settings → System → Notifications → Valkama.',
        },
        'disabled-for-user': {
          label: 'Windows turned off all notifications',
          detail: 'Turn them on: Settings → System → Notifications.',
        },
        'disabled-by-group-policy': {
          label: 'Notifications are off by policy',
          detail:
            'A Windows group policy turned them off. The administrator of this PC can change it.',
        },
        'disabled-by-manifest': {
          label: 'Windows forbids notifications for this app',
          detail: 'Reinstall Valkama Desktop.',
        },
        'switched-off': {
          label: 'Off by an environment variable',
          detail: 'The server runs with VALKAMA_NO_ALERTS. Remove it and restart the server.',
        },
        'unsupported': {
          label: 'Windows only',
          detail: 'The server is not running on Windows, so no notifications will show.',
        },
        'unavailable': { label: 'The check failed' },
        'failed': {
          label: 'The check failed',
          detail: 'Windows gave no reason.',
        },
      },
      testLabel: 'Test',
      testHint: 'Shows a real notification from Valkama.',
      test: 'Send a test notification',
      testSending: 'Sending…',
      testNotStarted: 'The notification did not start. Details are in %TEMP%\\valkama-alerts.log.',
      testSent:
        'Sent to Windows. In Do Not Disturb there is no banner and it goes straight to the notification centre. To get the banner anyway, make Valkama a priority app: Settings → System → Notifications.',
    },
  },
  ru: {
    alerts: {
      title: 'Оповещения Windows',
      intro:
        'Valkama покажет оповещение Windows, когда агент ждёт вас, даже при закрытом окне. Клик открывает карточку задачи.',
      loadFailed: 'Не удалось прочитать настройки оповещений.',
      saveFailed: 'Не сохранено: {reason}',
      enabled: 'Оповещать, когда агент ждёт меня',
      enabledHint: 'Выключение сохраняет выбранные события.',
      on: 'Включено',
      off: 'Выключено',
      events: 'События',
      eventsHint: 'О том, что сделали агенты. О ваших собственных действиях оповещений нет.',
      event: {
        question: 'Нужен ответ или решение',
        review: 'Задача на проверке',
        launchFailed: 'Запуск из Valkama упал',
      },
      contentLabel: 'Что показывать',
      contentHint:
        'Это же видно на экране блокировки. Скрыть там текст можно в Windows: Параметры → Система → Уведомления → Valkama.',
      contentPromptHint: 'Текст вопроса останется в истории уведомлений Windows.',
      content: {
        generic: 'Только «нужен ответ»',
        title: 'Номер и заголовок задачи',
        prompt: 'Номер, заголовок и текст вопроса',
      },
      readinessLabel: 'Готовность',
      checking: 'Проверяем…',
      recheck: 'Проверить снова',
      readiness: {
        'ready': { label: 'Готово' },
        'no-shortcut': {
          label: 'Нет ярлыка Valkama',
          detail:
            'Windows показывает оповещения только приложению с ярлыком в меню «Пуск». Установите Valkama Desktop.',
        },
        'disabled-for-application': {
          label: 'Windows отключила оповещения Valkama',
          detail: 'Включите их: Параметры → Система → Уведомления → Valkama.',
        },
        'disabled-for-user': {
          label: 'Windows отключила все оповещения',
          detail: 'Включите их: Параметры → Система → Уведомления.',
        },
        'disabled-by-group-policy': {
          label: 'Оповещения отключены политикой',
          detail: 'Их отключила групповая политика Windows. Её меняет администратор компьютера.',
        },
        'disabled-by-manifest': {
          label: 'Windows запретила оповещения приложению',
          detail: 'Переустановите Valkama Desktop.',
        },
        'switched-off': {
          label: 'Отключено переменной окружения',
          detail: 'Сервер запущен с VALKAMA_NO_ALERTS. Уберите её и перезапустите сервер.',
        },
        'unsupported': {
          label: 'Только для Windows',
          detail: 'Сервер работает не в Windows, поэтому оповещений не будет.',
        },
        'unavailable': { label: 'Проверка не удалась' },
        'failed': {
          label: 'Проверка не удалась',
          detail: 'Windows не сообщила причину.',
        },
      },
      testLabel: 'Проверка',
      testHint: 'Покажет настоящее оповещение от имени Valkama.',
      test: 'Отправить проверочное',
      testSending: 'Отправляем…',
      testNotStarted: 'Оповещение не запустилось. Подробности — в %TEMP%\\valkama-alerts.log.',
      testSent:
        'Отправлено в Windows. В режиме «Не беспокоить» баннера не будет, запись сразу ляжет в центр уведомлений. Чтобы баннер приходил и тогда, сделайте Valkama приоритетным приложением: Параметры → Система → Уведомления.',
    },
  },
}
