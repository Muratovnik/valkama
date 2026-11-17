/*
 * What `doctor` says about Valkama's Git commit hook and the commit records it leaves, by
 * presentation code, in both languages. `web/tests/serverFixtures.test.ts` holds this list
 * to the codes the server names.
 */

export const doctorCommitMessages = {
  en: {
    'commit-hook-installed': {
      title: 'Git commit hook',
      detail: 'Git runs {names} from {path}.',
    },
    'commit-hook-missing': {
      title: 'Git commit hook is missing',
      detail: 'Git has no {names} in {path}.',
      fix: 'Run valkama git-hook install, or valkama setup --apply. Then Valkama attaches each commit an agent session makes to the task the session holds.',
    },
    'commit-hook-stale': {
      title: 'Git commit hook runs another launcher',
      detail:
        'The command or event of {names} in {path} is not the one the installed launcher gives.',
      fix: 'Run valkama git-hook install; valkama launcher install does the same for every hook that is there.',
    },
    'commit-hook-disabled': {
      title: 'Git commit hook is switched off',
      detail: 'Git skips {names} in {path}, because its enabled setting is false.',
      fix: 'Remove the setting with git config --global --unset hook.<name>.enabled to run the hook again.',
    },
    'commit-hook-unsupported': {
      title: 'Git runs no commit hooks from its configuration',
      detail: 'Git does not list {names} among its hooks.',
      fix: 'Install a Git that runs hooks from its configuration. Until then the closing check still names the commits no hook reported.',
    },
    'commit-records-current': {
      title: 'Commit records',
      detail: 'No commit record has waited for over an hour.',
    },
    'commit-records-waiting': {
      title: 'Commit records wait for over an hour',
      detail: '{count} commit records have waited for over an hour; the oldest is from {oldest}.',
      fix: 'Start any MCP session or serve: its sweep takes the records older than an hour every ten minutes.',
    },
    'commit-records-rejected': {
      title: 'Commit records set aside',
      detail: '{rejected} unreadable commit records were set aside in {paths}.',
      fix: 'Read the files in commits/rejected/; they are never retried. Delete each one once it is understood.',
    },
  },
  ru: {
    'commit-hook-installed': {
      title: 'Git-хук коммитов',
      detail: 'Git запускает {names} из {path}.',
    },
    'commit-hook-missing': {
      title: 'Git-хук коммитов не установлен',
      detail: 'В {path} нет хука {names}.',
      fix: 'Выполните valkama git-hook install или valkama setup --apply. После этого Valkama прикрепляет каждый коммит, сделанный в сессии агента, к задаче, которую держит сессия.',
    },
    'commit-hook-stale': {
      title: 'Git-хук коммитов запускает другой запускатель',
      detail:
        'Команда или событие хука {names} в {path} не совпадает с тем, что даёт установленный запускатель.',
      fix: 'Выполните valkama git-hook install; valkama launcher install делает то же для каждого стоящего хука.',
    },
    'commit-hook-disabled': {
      title: 'Git-хук коммитов выключен',
      detail: 'Git пропускает {names} в {path}: его настройка enabled равна false.',
      fix: 'Снимите настройку командой git config --global --unset hook.<name>.enabled, чтобы хук снова запускался.',
    },
    'commit-hook-unsupported': {
      title: 'Git не запускает хуки коммитов из своей конфигурации',
      detail: 'Git не показывает {names} среди своих хуков.',
      fix: 'Установите Git, который запускает хуки из конфигурации. До этого проверка при закрытии задачи всё равно называет коммиты, о которых хук не сообщил.',
    },
    'commit-records-current': {
      title: 'Записи коммитов',
      detail: 'Ни одна запись о коммите не ждала дольше часа.',
    },
    'commit-records-waiting': {
      title: 'Записи коммитов ждут больше часа',
      detail: 'Записей о коммитах ждут больше часа: {count}; самая ранняя от {oldest}.',
      fix: 'Запустите любую сессию MCP или serve: её очистка забирает записи старше часа каждые десять минут.',
    },
    'commit-records-rejected': {
      title: 'Записи коммитов отложены',
      detail: 'Нечитаемых записей о коммитах отложено: {rejected}, в {paths}.',
      fix: 'Прочитайте файлы в commits/rejected/: повторно они не обрабатываются. Удаляйте каждый, когда причина понятна.',
    },
  },
}
