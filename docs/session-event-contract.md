---
status: adopted
card: 200
---

# Нормализованное событие сессии (контракт ингеста)

Владелец: этот репозиторий (сервер — авторитет контракта); адаптеры клиентов
живут в других репозиториях и подключаются без изменения ядра. Происхождение —
карта из frontmatter выше.

## Транспорт

`POST http://127.0.0.1:<port>/api/ingest` platform-процесса (`valkama.py serve`,
порт по умолчанию 8642, слушает только 127.0.0.1). Тело — один JSON-объект,
UTF-8, не больше 64 КБ. Ответ 200 — событие принято; 400 — событие отвергнуто
с причиной в теле. Адаптер обязан молчать о транспорте: недоступный platform или
ответ 4xx/5xx не должны блокировать и замедлять клиента (короткий таймаут,
никакого повторного дозвона), выход 0. Это относится именно к транспорту:
рассогласование пина адаптера — видимая ошибка с диагностикой и выходом 1, а
пути с выходом 2 (который клиент читает как «заблокировать событие») в адаптере
нет вовсе. Пока platform не запущен, события теряются — platform является
постоянным локальным сервисом по ADR 0008.

Запрос адаптера всегда originless и содержит
`Authorization: Bearer <installation-token>`. Токен читается из фиксированного
пользовательского runtime-файла `~/.valkama/installation-token`; путь может быть
подменён только в тесте. Отсутствующий, нечитаемый или повреждённый файл сохраняет
описанную выше неблокирующую семантику транспорта. Токен никогда не попадает в
URL, JSON, argv, environment, state-файл или диагностику. Браузерный
`X-Valkama-Session` на этом endpoint не принимается. Контракт защищает от
враждебной web-страницы, но не от native-процесса того же OS-пользователя,
который имеет доступ к его runtime-файлам.

## Поля

| Поле | Тип | Обязательно | Ограничение | Смысл |
| --- | --- | --- | --- | --- |
| `session_id` | string | да | ≤128 | Стабильный ID сессии клиента |
| `client` | string | да | ≤32 | `claude`, `codex`, имя другого клиента |
| `event` | string | да | см. ниже | Вид события |
| `cwd` | string | нет | ≤512 | Рабочий каталог сессии |
| `label` | string | нет | ≤200 | Короткая подпись сессии |
| `tool` | string | нет | ≤128 | Имя инструмента (`tool_start`/`tool_end`) |
| `server` | string | нет | ≤128 | Имя MCP-сервера, если инструмент MCP |
| `status` | string | нет | ≤64 | Исход: `ok`, `error`, `blocked`, … |
| `detail` | JSON | нет | ≤4096 после сериализации, иначе усечение | Малый довесок |

Управляющие символы вырезаются, длины усекаются на сервере. Метку времени
ставит сервер при приёме; порядок внутри сессии — по `id`.

## Виды событий и классы хранения

Класс назначает сервер, адаптер его не выбирает:

| `event` | Класс | Хранение |
| --- | --- | --- |
| `session_start` | analytics | долгоживущее |
| `session_end` | analytics | долгоживущее |
| `turn_end` | analytics | долгоживущее (ход завершён, сессия ждёт владельца) |
| `tool_end` | analytics | долгоживущее (инструмент, MCP-сервер, исход) |
| `attention` | analytics | долгоживущее (повод для inbox: `status`=`blocked`…) |
| `tool_start` | stream | удаляемое (текущий шаг) |
| `step` | stream | удаляемое (произвольная строка статуса) |

Политика `stream`: хвост на сессию ограничен (константа
`STREAM_TAIL_PER_SESSION` в `valkama.py`), при `session_end` stream-строки
сессии удаляются автоматически, вручную — `valkama.py purge-stream`.
`analytics` не удаляется никогда этим механизмом.

## Семантика сессии

- Событие для неизвестного `session_id` создаёт запись сессии (адаптер мог
  подключиться посреди сессии).
- `session_start` возвращает сессию в `active`, сбрасывает `ended_at` и
  непросмотренное внимание (резюм после компакта/перезапуска — не событие
  inbox).
- `session_end` со `status` `error`/`failed` даёт статус `failed`, иначе
  `ended`; `failed` — авторитетный терминальный исход, который не могут
  понизить поздние `session_end`, `attention` или stream-события. Открыть
  сессию снова может только явный `session_start`. Оба исхода попадают в inbox
  до отметки «просмотрено»
  (`POST /api/session-seen`, тело `{"id": "<session_id>"}`).
- `turn_end` — не конец сессии: он ставит повод `waiting` только живой сессии,
  не меняет статус и не трогает уже завершённую. Любое следующее реальное
  действие `tool_start`/`tool_end`/`step` снимает любой нетерминальный повод
  внимания (`waiting`, `blocked`, …): работа возобновилась. Терминальные
  исходы (`ended`, `failed`) так не снимаются.
- Привязка к карте выводится из существующего ref `kind=session` на карте
  (значение — `session_id`) или явно записывается Valkama runner после
  успешного запуска. Runner хранит точный client session/thread id и при
  завершении добавляет его как `kind=session`; внутренний `launch-*` id
  остаётся только резервной идентичностью, пока Codex не сообщил thread id.
- Resume runner'а принимает только точный сохранённый client session/thread
  id. Корреляция по названию, времени, каталогу, последней сессии или
  модельному тексту запрещена.

## Чтение

- `GET /api/sessions` — модель монитора: `{sessions: […], inbox: […]}`.
  У сессии есть `current_step`, но только для здоровой `active` сессии, когда
  её stream-событие новее последней durable-границы (`attention`, `turn_end`,
  `session_end`); иначе это пустая строка. `quiet_seconds` считается на
  чтении. При `SESSION_STALE_AFTER_SECONDS` (сейчас 300 секунд) активная
  сессия получает производные, не сохраняемые поля `presence: "stale"` и
  `stale: true`; свежая активная — `presence: "connected"`, терминальная —
  `presence: "terminal"`. Это не четвёртый статус и не создаёт inbox-событие.
- `GET /api/session?id=…&limit=…` — хвост событий одной сессии, новые первыми.
- `GET /api/events?view=sessions` — тот же payload монитора по SSE при каждом
  изменении БД.

## Соответствие клиентов (фаза 1)

- Claude Code (хук-адаптер на стороне клиента):
  SessionStart→`session_start`, PreToolUse→`tool_start`,
  PostToolUse→`tool_end`, Notification→`attention`, Stop→`turn_end`,
  SessionEnd→`session_end`, PreCompact→`step`. Имя
  `mcp__<server>__<tool>` разбирается на `server`+`tool`. Провал вызова
  распознаётся во всех документированных формах ответа
  (`tool_response`/`tool_result`/`tool_result_is_error`).
- Codex — два независимых адаптера, и основной из них не хук:
  1. **Наблюдатель rollout-файлов** (отдельный процесс на стороне клиента)
     — основной путь. Codex сам пишет каждую сессию в
     `~/.codex/sessions/<год>/<месяц>/<день>/rollout-*.jsonl`; наблюдатель
     дочитывает эти файлы по смещению и шлёт события. Разрешений не требует —
     это чтение того, что клиент уже написал. Отображение: `session_meta` →
     `session_start` (с рабочим каталогом), `task_started` → `step`,
     `mcp_tool_call_end` → `tool_end` с сервером, инструментом и исходом,
     `patch_apply_end`/`web_search_end` → `tool_end`, `task_complete` →
     `turn_end`, а `task_complete` с ошибкой → `attention` (`blocked`).
     Рассуждения, счётчики токенов и тексты сообщений сознательно не
     пересылаются. Событие конца сессии Codex не пишет, поэтому сессия
     остаётся живой с растущим «тихим» временем.
  2. **Хуки** (SessionStart/Stop/PreCompact) — необязательное дополнение.
     Codex исполняет обработчик, только если в `~/.codex/config.toml` есть
     `trusted_hash` именно для него, а это одобрение выдаёт человек в
     интерактивной сессии. Установщик сообщает об этом и умеет проверять
     состояние (`--verify`), но доверие себе не выписывает.
- Если `SessionEnd` в сборке клиента отсутствует, сессия просто не переходит в
  `ended`; вывод делается по тихому времени. Считать `Stop` концом сессии
  запрещено: он срабатывает после каждого ответа.

## Dashboard and launch-root projection (continuation card #214)

`GET /api/dashboard?board=<exact-name>` — read-only projection rebuilt from
`cards` and the ordered `events` journal. It never changes the Kanban schema or
uses `/api/activity` as a history source. Status intervals use explicit
`created`/`moved` transitions; a queued `claimed` or `checklist_claimed` event
may infer `backlog|todo -> dev` only when that preceding state is known. Every
inferred interval is labelled `inferred`; repeated visits are retained and
summed. A missing initial event or inconsistent chain is `partial`/`unknown`
and its duration is `null` (a lower bound where known), never zero. Events sort
by `(created_at, id)`, and the active segment ends at the response `as_of`.
The payload exposes `coverage` (`confirmed`, `inferred`, `partial`, or
`unknown`) and `as_of` so consumers can distinguish an observed zero from an
unobserved value. Events newer than `as_of` are excluded before reconstruction.
When a move declares a source lane that does not match the observed state, the
preceding interval is closed as unknown at the gap (without a duration) and the
destination is a new observed boundary; no time is fabricated across the
contradiction. Board coverage folds all eligible cards using the deterministic
`confirmed < inferred < partial` lattice with `unknown` only when no known
history exists. Lane rows expose counts for each quality and leave unknown
visits as `null`, never as a meaningful zero.

The optional `local_journal` usage provider reads only explicitly configured
Codex rollout or Claude JSONL roots. Codex uses the last cumulative
`total_token_usage`; Claude deduplicates assistant `message.id` rows and skips
sidechain records. It accepts only exact card `session` refs, deduplicates a
session once for board totals, and marks a session shared/non-exclusive when it
is attached to several cards. Missing tokens, model, or cost remain `null`;
cost is shown only when a journal explicitly reports it (`quality` is
`derived/internal`, observation is `observed` or `unknown`). Roots are indexed
once per projection with bounded reads and exact filename/stem or in-file
identity checks; ambiguous/unverifiable matches and unknown clients remain
unknown. Conflicting duplicate Claude message costs are not summed and remain
`null`.

The dashboard also folds durable `session_events` into client/server/tool/status
counts with `linked`, `other_board`, and `unlinked` coverage. A global event is
never attributed to a card without an exact session ref.

`GET /api/sessions`, `/api/ref?kind=session`, and the dashboard carry a
`space_root` result. An explicitly associated work item supplies one canonical
Planning-space `resource_ref`, derived from the store's `data_scope_id` and the
space's stable key. The server resolves only that exact owner binding in
`%LOCALAPPDATA%\\Valkama\\projects.json`, returning typed `mapped`, `missing`,
`ambiguous`, `malformed`, or `unavailable` status and validating the mapped
directory. A mapped root is the effective `{cwd}`; `{session_cwd}` remains the
observed session directory and never grants launch authority. Missing,
unbound, or cross-space sessions have no effective cwd.

Electron receives the canonical `resource_ref`, re-reads the fixed registry in
its main process, and resolves the binding again before opening anything. Both
browser and desktop launch plans refuse an unbound or ambiguous session, so
neither can inherit a renderer, session, or process cwd. Custom opener
templates stay within the existing user-configured trust seam; arguments
remain an argv array without a shell and sender validation still runs first.
