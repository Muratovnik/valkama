/**
 * A plan's ordinary shapes that a top block does not have: code inside a list item, a short
 * line of code beside it, and a table of counts whose first head is empty and whose first
 * column is labels long enough to wrap. Served by the page's and the pane's backend alike.
 */
export const NESTED_PATH = 'docs/counts.md'

export const NESTED = `# The counts

1. The read model adds one key for the tasks with live work, and only for them, so that a
   quiet space sends nothing new:

   \`\`\`json
   {"<work_item_id>": {"state": "working"}, "<work_item_id>": {"state": "quiet", "quiet_since": "2026-11-03T15:12:09Z"}}
   \`\`\`

   Only a quiet task has a time, since a time on every event would make each one a frame.

2. A short line needs no more than the item's width:

   \`\`\`text
   short
   \`\`\`

|  | MAIN | OTHER |
| --- | ---: | ---: |
| Tasks / open | 120 / 31 | 64 / 9 |
| Open work (not epics) | 27 | 8 |
| Epics: all / open / with open work | 14 / 6 / 5 | 3 / 1 / 1 |
| Links: discovered-from / blocks / relates-to / duplicates | 40 / 12 / 30 / 2 | 5 / 1 / 4 / 0 |
`
