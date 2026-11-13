/*
 * What `doctor` says about the subscription quota's sources -- Claude Code's status line,
 * Valkama's Claude Code mod and the poll of the usage endpoint -- by presentation code, in
 * both languages. `tests/serverFixtures.test.ts` holds this list to the codes the server
 * names.
 */

export const doctorQuotaMessages = {
  en: {
    'quota-statusline-unreadable': {
      title: 'Status line settings cannot be read',
      detail:
        "Claude Code's settings.json cannot be read, so it is unknown whether the status line feeds the quota.",
      fix: 'Make the file valid JSON; Claude Code cannot read it as it is either.',
    },
    'quota-statusline-off': {
      title: 'Status line does not feed the quota',
      detail:
        "Claude Code's status line does not run valkama statusline, so no quota is read from it. Sessions under WSL or another CLAUDE_CONFIG_DIR are not checked.",
      fix: "Make valkama statusline the status line command in Claude Code's settings. A status line command you already have keeps showing when it is passed with --previous.",
    },
    'quota-statusline-silent': {
      title: 'Status line sends no quota',
      detail:
        "valkama statusline is Claude Code's status line, but no reading from it reached the store in the last {days} days. Claude Code runs the status line only in terminal sessions, not in the VS Code extension, and reports the quota only for a subscription account, after a session's first response.",
      fix: 'Work in a Claude Code terminal session. A reading the store could not take waits in the hook spool and arrives with the next hook event.',
    },
    'quota-statusline-working': {
      title: 'Status line quota source',
      detail:
        "Claude Code's status line runs valkama statusline, and a reading from it reached the store in the last {days} days.",
    },
    'quota-mod-unreadable': {
      title: 'Mod settings cannot be read',
      detail:
        "Claude Code's settings or plugin record cannot be read, so it is unknown whether the mod feeds the quota.",
      fix: 'Make the file valid JSON; Claude Code cannot read it as it is either.',
    },
    'quota-mod-off': {
      title: 'The quota mod is off',
      detail:
        "Valkama's Claude Code mod, valkama-quota, is not installed or not enabled for this user, so no quota is read from it. A mod enabled for one project or loaded from a shell is not checked.",
      fix: "Install it at the prompt of a Claude Code terminal session with /plugin install valkama-quota --marketplace Muratovnik/valkama, or enable it if it is installed. It reads the quota in every session, the VS Code extension's too.",
    },
    'quota-mod-silent': {
      title: 'The quota mod sends no quota',
      detail:
        'The mod is enabled, but no reading from it reached the store in the last {days} days. It reads the quota only for a subscription account, after a model response, and hands it over through the managed launcher.',
      fix: 'Run valkama launcher install if the launcher is missing or pins a release from before the mod, then work in a Claude Code session. A reading the store could not take waits in the hook spool.',
    },
    'quota-mod-working': {
      title: 'Mod quota source',
      detail:
        "Valkama's Claude Code mod is enabled, and a reading from it reached the store in the last {days} days.",
    },
    'quota-poll-unreadable': {
      title: 'Quota poll setting cannot be read',
      detail: "The store's quota settings cannot be read, so it is unknown whether the poll is on.",
      fix: 'Open the store once with the current build; it adds the settings table.',
    },
    'quota-poll-off': {
      title: 'Quota poll is off',
      detail:
        'The usage endpoint is not asked for the quota. The switch is in the General section, under Subscription quota.',
    },
    'quota-poll-not-running': {
      title: 'Quota poll is not running',
      detail: 'The poll is switched on, but no local server is polling.',
      fix: 'Start the local Valkama server (valkama serve); the poll starts with it.',
    },
    'quota-poll-waiting': {
      title: 'Quota poll',
      detail: 'Switched on and waiting for its first request to the usage endpoint.',
    },
    'quota-poll-ok': {
      title: 'Quota poll',
      detail: 'The usage endpoint answers with the quota.',
    },
    'quota-poll-rate-limited': {
      title: 'Quota poll is paused',
      detail: 'The usage endpoint answered HTTP 429, too many requests.',
      fix: 'Nothing to do: the poll asks again by itself and waits longer after each refusal.',
    },
    'quota-poll-refused': {
      title: 'Usage endpoint refused the sign-in',
      detail:
        'The usage endpoint turned away the Claude Code sign-in, so the poll does not ask with it again.',
      fix: 'Sign in to Claude Code again (/login); the poll tries the new sign-in within a minute.',
    },
    'quota-poll-expired': {
      title: 'Claude Code sign-in has expired',
      detail: 'The poll does not ask the usage endpoint with an expired sign-in.',
      fix: 'Use Claude Code once so it renews its sign-in; the poll picks it up within a minute.',
    },
    'quota-poll-no-login': {
      title: 'No Claude Code sign-in',
      detail:
        'This machine has no Claude Code sign-in for the poll to ask the usage endpoint with.',
      fix: 'Sign in to Claude Code (/login), or switch the poll off in the General section, under Subscription quota.',
    },
    'quota-poll-failing': {
      title: 'Usage endpoint gives no reading',
      detail: 'The usage endpoint did not answer with a reading.',
      fix: 'The poll retries by itself. If this lasts, the undocumented endpoint may have changed: switch the poll off in the General section, under Subscription quota.',
    },
  },
  ru: {
    'quota-statusline-unreadable': {
      title: 'Настройки строки состояния не читаются',
      detail:
        'Файл settings.json Claude Code не читается, поэтому неизвестно, передаёт ли строка состояния квоту.',
      fix: 'Исправьте JSON в файле: в таком виде его не читает и Claude Code.',
    },
    'quota-statusline-off': {
      title: 'Строка состояния не передаёт квоту',
      detail:
        'Строка состояния Claude Code не запускает valkama statusline, поэтому квота из неё не читается. Сессии в WSL или с другим CLAUDE_CONFIG_DIR не проверяются.',
      fix: 'Сделайте valkama statusline командой строки состояния в настройках Claude Code. Уже заданная команда строки состояния продолжит показываться, если передать её через --previous.',
    },
    'quota-statusline-silent': {
      title: 'Строка состояния не присылает квоту',
      detail:
        'Строка состояния Claude Code — это valkama statusline, но за последние {days} дн. ни одно её показание не дошло до хранилища. Claude Code запускает строку состояния только в терминальных сессиях, не в расширении VS Code, и сообщает квоту только для аккаунта с подпиской, после первого ответа в сессии.',
      fix: 'Работайте в терминальной сессии Claude Code. Показание, которое хранилище не смогло принять, ждёт в очереди хуков и придёт со следующим событием хука.',
    },
    'quota-statusline-working': {
      title: 'Строка состояния как источник квоты',
      detail:
        'Строка состояния Claude Code запускает valkama statusline, и за последние {days} дн. её показание дошло до хранилища.',
    },
    'quota-mod-unreadable': {
      title: 'Настройки мода не читаются',
      detail:
        'Настройки Claude Code или его список плагинов не читаются, поэтому неизвестно, передаёт ли мод квоту.',
      fix: 'Исправьте JSON в файле: в таком виде его не читает и Claude Code.',
    },
    'quota-mod-off': {
      title: 'Мод квоты выключен',
      detail:
        'Мод Valkama для Claude Code, valkama-quota, не установлен или не включён для этого пользователя, поэтому квота из него не читается. Мод, включённый для одного проекта или загруженный из оболочки, не проверяется.',
      fix: 'Установите его в терминальной сессии Claude Code командой /plugin install valkama-quota --marketplace Muratovnik/valkama, а если он уже установлен, включите. Мод читает квоту в каждой сессии, в том числе в расширении VS Code.',
    },
    'quota-mod-silent': {
      title: 'Мод не присылает квоту',
      detail:
        'Мод включён, но за последние {days} дн. ни одно его показание не дошло до хранилища. Он читает квоту только для аккаунта с подпиской, после ответа модели, и передаёт её через управляемый лаунчер.',
      fix: 'Выполните valkama launcher install, если лаунчера нет или он закрепляет релиз старше мода, и поработайте в сессии Claude Code. Показание, которое хранилище не смогло принять, ждёт в очереди хуков.',
    },
    'quota-mod-working': {
      title: 'Мод как источник квоты',
      detail:
        'Мод Valkama для Claude Code включён, и за последние {days} дн. его показание дошло до хранилища.',
    },
    'quota-poll-unreadable': {
      title: 'Настройка опроса квоты не читается',
      detail: 'Настройки квоты в хранилище не читаются, поэтому неизвестно, включён ли опрос.',
      fix: 'Один раз откройте хранилище текущей сборкой — она добавит таблицу настроек.',
    },
    'quota-poll-off': {
      title: 'Опрос квоты выключен',
      detail:
        'Эндпоинт использования о квоте не спрашивается. Переключатель — в разделе «Общие», в группе «Квота подписки».',
    },
    'quota-poll-not-running': {
      title: 'Опрос квоты не идёт',
      detail: 'Опрос включён, но ни один локальный сервер его не ведёт.',
      fix: 'Запустите локальный сервер Valkama (valkama serve): опрос начнётся вместе с ним.',
    },
    'quota-poll-waiting': {
      title: 'Опрос квоты',
      detail: 'Опрос включён и ждёт первого запроса к эндпоинту использования.',
    },
    'quota-poll-ok': {
      title: 'Опрос квоты',
      detail: 'Эндпоинт использования отвечает квотой.',
    },
    'quota-poll-rate-limited': {
      title: 'Опрос квоты приостановлен',
      detail: 'Эндпоинт использования ответил HTTP 429: слишком много запросов.',
      fix: 'Ничего делать не нужно: опрос сам спросит снова и после каждого отказа ждёт дольше.',
    },
    'quota-poll-refused': {
      title: 'Эндпоинт отклонил вход',
      detail:
        'Эндпоинт использования отклонил вход Claude Code, поэтому с этим входом опрос больше не спрашивает.',
      fix: 'Войдите в Claude Code заново (/login): опрос попробует новый вход в течение минуты.',
    },
    'quota-poll-expired': {
      title: 'Вход в Claude Code истёк',
      detail: 'С истёкшим входом опрос эндпоинт использования не спрашивает.',
      fix: 'Один раз воспользуйтесь Claude Code, чтобы он обновил вход: опрос подхватит его в течение минуты.',
    },
    'quota-poll-no-login': {
      title: 'Нет входа в Claude Code',
      detail:
        'На этой машине нет входа в Claude Code, с которым опрос мог бы спросить эндпоинт использования.',
      fix: 'Войдите в Claude Code (/login) или выключите опрос в разделе «Общие», в группе «Квота подписки».',
    },
    'quota-poll-failing': {
      title: 'Эндпоинт не даёт показаний',
      detail: 'Эндпоинт использования не ответил показанием.',
      fix: 'Опрос повторяет запросы сам. Если это продолжается, недокументированный эндпоинт мог измениться: выключите опрос в разделе «Общие», в группе «Квота подписки».',
    },
  },
}
