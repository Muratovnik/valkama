/*
 * Every hint states its kind, and a detail is registered.
 *
 * A hint is one of three things (`tooltipAnchors.ts`): the `name` of a control that shows no
 * words, the whole text of a `clipped` element while it is cut, or a `detail` the screen does
 * not say. The directive's default once was "show always", and the hint is far easier to see
 * than the browser's `title` it replaced, so ninety hints that had been all but invisible
 * stood over the board at every pass of the pointer: a tile's title over the tile, a label's
 * «Filter: label x» over the label, five lines over a holder's name. The kind is what makes
 * the next one a choice: a template writes `v-tooltip.name`, `v-tooltip.clipped` or
 * `v-tooltip.detail`, and a render function gives the kind as the directive's modifiers,
 * `[vTooltip, text, undefined, { name: true }]`.
 *
 * A detail is what a hint may misuse: words the element shows, said again. So a detail is
 * registered below by file, tag and directive as written, with the reason its words are not
 * on the screen; a registered one that is gone is refused too.
 */

/** `file <tag> v-tooltip.detail="…"` or `file script [vTooltip, …]` → what it says that the screen does not. */
export const DETAIL_TOOLTIPS = new Map([
  [
    `entities/work-item/components/WorkItemCopyButtons.vue <button> v-tooltip.detail="t('workItem.head.copyReferenceHint')"`,
    'that a press copies the number, which reads as a number and not as a control',
  ],
  [
    `features/input-requests/components/RequestNavigator.vue <VButton> v-tooltip.detail="t('requests.hub.toAnswer')"`,
    'where a press on the count goes: to the answer of the question it counts',
  ],
  [
    'features/session-open/ExecutorLink.vue <span> v-tooltip.detail="whole"',
    'the holder as it was written, where the line shortens its session to the start',
  ],
  [
    'features/session-open/OpenAction.vue <VButton> v-tooltip.detail="{ ...tooltip, words: name }"',
    'what a press does and, under it, the state the session is in; the button shows the holder; while its own words are cut, they come first, whole',
  ],
  [
    'pages/analytics/components/AnalyticsBar.vue <p> v-tooltip.detail="freshHint"',
    'the moment of the newest record and, for a live period, how often it reads itself again, where the bar shows only the age and the live mark',
  ],
  [
    `pages/analytics/components/RefreshFailed.vue <VButton> v-tooltip.detail="t('platform.actions.retry')"`,
    "what a press on a failure's words does, where a line short of room gave up the retry's own word",
  ],
  [
    'pages/analytics/components/RailTile.vue <span> v-tooltip.detail="{ text: leadDetail, words: lead }"',
    'the whole id of the first value a tile names by the start of it, an account; while the name is cut, it comes first, whole',
  ],
  [
    'pages/analytics/components/RailTile.vue <WindowBar> v-tooltip.detail="tile.meter.label"',
    'where steady use from the window start would stand now, which a quota tile draws only as a tick on its bar, and its forecast, which it draws only as a hatched tail, named here, with the share and the state the tile says',
  ],
  [
    'pages/analytics/components/QuotaAccount.vue <span> v-tooltip.detail="other.read"',
    'how old the reading of a window of money is and who read it, where its line names only the window and its state',
  ],
  [
    'pages/analytics/components/QuotaWindow.vue <WindowBar> v-tooltip.detail="bar.hint"',
    'where steady use from the window start would stand now, which the bar draws only as a tick, and how old the latest reading is and who read it, where the line over the bar says only the share and the state',
  ],
  [
    'pages/analytics/components/RailTile.vue <MiniShareBar> v-tooltip.detail="tile.shares.label"',
    'every part of the share bar with its share, work on no value and the rest among them, where the tile says only the first',
  ],
  [
    'pages/analytics/components/SpendingTiles.vue <span> v-tooltip.detail="tileOf(option.value)?.rate"',
    'that the figure per hour is of an hour of agent time, and of the cost that it is an estimate at API prices, where the line says only «/h»; while its own words are cut, they come first, whole',
  ],
  [
    'pages/analytics/components/SpendingTableHead.vue <p> v-tooltip.detail="{ text: summary, words: counts }"',
    'the whole account of the rows, work on no value by name among them, and the column and way they are sorted, where the line says only how many values spent in the period and before it; while its own words are cut, they come first, whole',
  ],
  [
    `pages/settings/components/SettingsAlerts.vue <ToggleSwitch> v-tooltip.detail="t('alerts.enabledDetail')"`,
    'that a notification comes with the window closed too, and that a click on it opens the card; it stood as a paragraph over the group',
  ],
  [
    `pages/settings/components/SettingsKindColors.vue <input> v-tooltip.detail="t('settings.kindColors.kept')"`,
    'where a chosen colour is kept, which the swatch does not say; it stood as a paragraph over the group',
  ],
  [
    `pages/settings/components/SettingsAccounts.vue <VTextInput> v-tooltip.detail="t('settings.accountAliases.kept')"`,
    'where an account name is said and where it is kept, which the field does not say',
  ],
  [
    `pages/settings/components/SettingsOpening.vue <small> v-tooltip.detail="t('open.settings.lastPlaceHint')"`,
    'which place «the place» is, the last one a session was open in; it stood as a paragraph over the group',
  ],
  [
    'pages/volumes/components/VolumesGoals.vue <td> v-tooltip.detail="figure.hint"',
    "how a goal's figure is counted, or why it is «—», which the figure does not say",
  ],
  [
    'pages/volumes/components/VolumesNumbers.vue <button> v-tooltip.detail="number.hint"',
    "where a press on the number goes, and its category's oldest card and how long it has waited",
  ],
  [
    'pages/volumes/components/VolumesNumbers.vue <div> v-tooltip.detail="number.hint"',
    'why the number opens nothing, and what it counts where the figure alone does not say',
  ],
  [
    'shared/ui/ChoiceSelect.vue <strong> v-tooltip.detail="{ text: selected?.title, words: selected?.label }"',
    'the chosen option’s hint, which no row of the field draws; while its own words are cut, they come first, whole',
  ],
  [
    'shared/ui/ChoiceSelect.vue <SelectItem> v-tooltip.detail="{ text: option.title, words: option.label }"',
    'an option’s hint, which its row does not draw; while the option’s words are cut, whatever the host draws them with, they come first, whole',
  ],
  [
    'shared/ui/OptionGroups.vue <div> v-tooltip.detail="entry.option.title"',
    'what a choice lets through, which its one word does not say',
  ],
  [
    'shared/ui/OverlayResizer.vue <div> v-tooltip.detail="{ text: folded?.state, words: folded?.name }"',
    'that a folded edge holds a pane and how to bring it back; the edge is a line; while the pane’s name on it is cut, the name comes first, whole',
  ],
  [
    'shared/ui/ChartLegend.vue <component> v-tooltip.detail="hintOf(one.key)"',
    'a legend entry prints its series’ name; its figure over the span and its share are on no mark',
  ],
  [
    `shared/ui/ChartLegend.vue <span> v-tooltip.detail="hintOf('outline')"`,
    'the entry names the mark of the period compared with; that period’s sum is on no mark',
  ],
  [
    'shared/ui/PeriodColumns.vue <component> v-tooltip.detail="periodHint(one, $props)"',
    'a period prints nothing of itself, and its segments are blocks of hue that speak through it: its sum against the period before, what changed and its series with their shares are its hint',
  ],
  [
    'shared/ui/MiniTrend.vue <span> v-tooltip.detail="label"',
    'a small trend draws columns and prints no word: its highest and last period, the last said as running where it is hatched, are its hint, since it has no legend to name the hatch',
  ],
  [
    'shared/ui/DonutChart.vue <path> v-tooltip.detail="hintOf(sector)"',
    'a sector is a band of hue: its name, figure and share of the whole, and for the rest its largest parts, are its hint',
  ],
  [
    'shared/ui/RankedBars.vue <component> v-tooltip.detail="namedHint(rowMark(row))"',
    'a row prints its name and its figure with its share; the whole id of a value it names by the start is on no mark; its name heads it, whole, beside its bar’s hue',
  ],
  [
    'shared/ui/SmallMultiples.vue <component> v-tooltip.detail="nameHint(one)"',
    'a small chart prints its name and figure; its share of the whole is on no mark; its name heads it, whole, beside its hue',
  ],
  [
    'shared/ui/SmallMultiples.vue <span> v-tooltip.detail="periodHint(one, index)"',
    'a small chart’s column has no name or figure on the screen: its period and figure are its hint',
  ],
  [
    'shared/ui/StepLine.vue <span> v-tooltip.detail="readingHint(point, 1)"',
    'a reading is a dot on a line: its moment, its share and its source are its hint, beside its line’s hue',
  ],
  [
    'shared/ui/StepLine.vue <span> v-tooltip.detail="target.hint"',
    'a place past a line’s readings has no words on the screen: where the window stands now and how old its latest reading is, or its forecast’s share at the reset and when that is, are its hint',
  ],
  [
    'shared/ui/RichInlines.vue <a> v-tooltip.detail="hoverTitle(node.reference)"',
    'what a press on a link does, and the whole value a link shows the start of',
  ],
  [
    'shared/ui/SessionStart.vue <span> v-tooltip.detail="session"',
    'the whole session id, of which the line prints the start',
  ],
  [
    `widgets/app-nav/components/AppNav.vue <button> v-tooltip.detail="t('navigation.home')"`,
    'where a press goes; the mark and the product’s name only say what it is',
  ],
  [
    'widgets/app-nav/components/NavConnectionButton.vue <button> v-tooltip.detail="{ text: hint, words: status }"',
    'that a press refreshes now, and while the connection is lost what was lost; while its own words are cut, they come first, whole',
  ],
  [
    'widgets/app-nav/components/NavWorkRow.vue <div> v-tooltip.detail="rowHint"',
    'the state with how long on a one-line row, which the row does not draw, and a session’s folder its one line leaves out; a two-line row draws both, so it has none, and a cut title has its own hint',
  ],
  [
    `widgets/app-nav/components/NavWorkTree.vue <span> v-tooltip.detail="{ text: t('liveWork.noProject'), words: entry.label }"`,
    'why the space’s name is no link: no project holds it; while its own words are cut, they come first, whole',
  ],
  [
    'widgets/document-viewer/components/DocumentViewer.vue <button> v-tooltip.detail="{ text: copyHint, words: path }"',
    'that a press copies the path; while its own words are cut, they come first, whole',
  ],
  [
    `widgets/work-item-graph/components/GraphControls.vue <ControlButton> v-tooltip.detail="fitHint"`,
    'why the fit shows only the beginning on a narrow screen and «Zoom out» is off: the cards would not read further out',
  ],
  [
    `widgets/work-item-graph/components/GraphNodeCard.vue <span> v-tooltip.detail="{ text: t('workItem.parent'), words: parentReference }"`,
    'what the reference beside the number is: the item’s epic; while its own words are cut, they come first, whole',
  ],
  [
    'widgets/work-item-inspector/components/ChainBranchMap.vue <button> v-tooltip.detail="lane.lane.title"',
    'the title of the item a lane branches from; the lane is named by its reference',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <span> v-tooltip.detail="group.session"',
    'the whole session id, of which the group prints the start',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <RichText> v-tooltip.detail="hint"',
    'the exact count of an ambiguous row, which the group’s line does not repeat',
  ],
  // Both rows of an agent with no label, named by its type or by the start of its id.
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <span> v-tooltip.detail="hint"',
    'the exact count of an ambiguous row, which the group’s line does not repeat',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <time> v-tooltip.detail="facts.started.full"',
    'the whole date and time, of which the row prints the part that tells runs apart',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <time> v-tooltip.detail="facts.ended.full"',
    'the whole date and time, of which the row prints the part that tells runs apart',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <time> v-tooltip.detail="facts.activity.full"',
    'the whole date and time, of which the row prints the part that tells runs apart',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <span> v-tooltip.detail="agent.agent_id"',
    'the whole agent id, of which the row prints the start',
  ],
  [
    'widgets/work-item-inspector/components/InspectorHolderRows.vue <span> v-tooltip.detail="holderHint"',
    "the holder's whole session id, where the card prints its start, and the lease behind the claim; the name only while it is cut",
  ],
  [
    'widgets/work-item-inspector/components/InspectorHolderRows.vue <span> v-tooltip.detail="nameHint(follower.label)"',
    "the follower's whole session id, where the card prints its start; never the name the card prints",
  ],
  [
    'widgets/work-item-inspector/components/InspectorHolderRows.vue <span> v-tooltip.detail="participant.hint"',
    "a goal's participant's whole session id, where the card prints its start, and the tasks it holds",
  ],
  [
    'widgets/work-item-inspector/components/UsageAccounts.vue <span> v-tooltip.detail="row.full"',
    'the whole organization id, of which the row prints the start',
  ],
  [
    'widgets/work-item-inspector/components/UsageFacts.vue <span> v-tooltip.detail="fact.title"',
    'how a figure is counted, which the figure does not say',
  ],
])
