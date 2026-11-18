/*
 * What `doctor` says about the installed desktop app -- whether it packs the desktop
 * sources of the release the launcher pins -- by presentation code, in both languages.
 */

export const doctorDesktopMessages = {
  en: {
    'desktop-app-absent': {
      title: 'Desktop app',
      detail: 'The desktop app is not installed.',
    },
    'desktop-app-current': {
      title: 'Desktop app',
      detail: 'It packs the desktop sources of release {revision}.',
    },
    'desktop-app-differs': {
      title: 'Desktop app is out of step with the server',
      detail: 'Files it packs that differ from release {revision}: {count}.',
      fix: 'Install the desktop app from the commit the launcher pins: windows/install-desktop.ps1 -Build in a checkout at that commit, or the installer of that release.',
    },
    'desktop-app-unreadable': {
      title: 'Desktop app cannot be compared',
      detail: 'Its archive or the desktop sources of release {revision} cannot be read.',
      fix: 'Install the desktop app again from the commit the launcher pins.',
    },
    'desktop-app-no-release': {
      title: 'Desktop app is not checked',
      detail: 'The launcher pins no release to compare it with.',
      fix: 'Run valkama launcher install.',
    },
  },
  ru: {
    'desktop-app-absent': {
      title: 'Приложение',
      detail: 'Приложение не установлено.',
    },
    'desktop-app-current': {
      title: 'Приложение',
      detail: 'Оно собрано из исходников desktop релиза {revision}.',
    },
    'desktop-app-differs': {
      title: 'Приложение расходится с сервером',
      detail: 'Файлов, которые отличаются от релиза {revision}: {count}.',
      fix: 'Установите приложение из коммита, закреплённого лаунчером: windows/install-desktop.ps1 -Build в копии репозитория на этом коммите или установщик этого релиза.',
    },
    'desktop-app-unreadable': {
      title: 'Приложение не удалось сверить',
      detail: 'Не читается его архив или исходники desktop релиза {revision}.',
      fix: 'Установите приложение заново из коммита, закреплённого лаунчером.',
    },
    'desktop-app-no-release': {
      title: 'Приложение не проверено',
      detail: 'Лаунчер не закрепил релиз, с которым его сравнить.',
      fix: 'Выполните valkama launcher install.',
    },
  },
}
