/*
 * What `doctor` says about what runs for the owner at login -- the listener that keeps
 * links working and the Windows notifications -- by presentation code, in both languages.
 */

export const doctorLoginMessages = {
  en: {
    'alerts-ready': {
      title: 'Windows notifications',
      detail: 'The shortcut is there and the helper can be built. Listener at login: {autostart}.',
    },
    'alerts-no-desktop': {
      title: 'Windows notifications are off',
      detail: 'They need the desktop app, which is not installed.',
    },
    'alerts-no-shortcut': {
      title: 'Windows drops every notification',
      detail: 'The Start menu has no Valkama shortcut.',
      fix: 'Reinstall the desktop app.',
    },
    'alerts-no-helper': {
      title: 'Windows notifications cannot be shown',
      detail: 'This Windows lacks the .NET Framework 4 compiler or the WinRT metadata.',
      fix: 'Turn on .NET Framework 4 in Windows features.',
    },
    'alerts-switched-off': {
      title: 'Windows notifications are off',
      detail: '{switch} is set.',
    },
    'autostart-off': {
      title: 'Listener at login is off',
      detail: 'A work item link opens only while a server is running.',
    },
    'autostart-on': {
      title: 'Listener at login',
      detail: 'Login holds port {port} until a link is followed.',
    },
    'autostart-stale': {
      title: 'Listener at login is out of date',
      detail: 'The autostart value runs another command than this launcher would write.',
      fix: 'Turn autostart on again from the launcher.',
    },
    'autostart-foreign': {
      title: 'Another program holds the autostart value',
      detail: 'The Valkama autostart value runs a command this launcher did not write.',
      fix: 'Check that command. Turning autostart on with force replaces it.',
    },
  },
  ru: {
    'alerts-ready': {
      title: 'Оповещения Windows',
      detail: 'Ярлык на месте, помощник можно собрать. Слушатель при входе: {autostart}.',
    },
    'alerts-no-desktop': {
      title: 'Оповещения Windows выключены',
      detail: 'Им нужно приложение Valkama, а оно не установлено.',
    },
    'alerts-no-shortcut': {
      title: 'Windows отбрасывает все оповещения',
      detail: 'В меню «Пуск» нет ярлыка Valkama.',
      fix: 'Переустановите приложение.',
    },
    'alerts-no-helper': {
      title: 'Оповещения Windows показать нельзя',
      detail: 'В этой Windows нет компилятора .NET Framework 4 или метаданных WinRT.',
      fix: 'Включите .NET Framework 4 в компонентах Windows.',
    },
    'alerts-switched-off': {
      title: 'Оповещения Windows выключены',
      detail: 'Задана переменная {switch}.',
    },
    'autostart-off': {
      title: 'Слушатель при входе выключен',
      detail: 'Ссылка на задачу открывается, только пока запущен сервер.',
    },
    'autostart-on': {
      title: 'Слушатель при входе',
      detail: 'При входе порт {port} занимается и ждёт первого перехода по ссылке.',
    },
    'autostart-stale': {
      title: 'Слушатель при входе устарел',
      detail: 'Значение автозагрузки запускает не ту команду, которую записал бы лаунчер.',
      fix: 'Включите автозагрузку заново из лаунчера.',
    },
    'autostart-foreign': {
      title: 'Значение автозагрузки занято другой программой',
      detail: 'Значение автозагрузки Valkama запускает команду, которую этот лаунчер не писал.',
      fix: 'Проверьте эту команду. Включение автозагрузки с принуждением заменит её.',
    },
  },
}
