/**
 * How the base drew each lane heading of the wide board (`laneWideFixture.ts`), before its actions
 * kept a place of their own: measured at rest in the built app, with its fonts, at each of
 * `SWEEP`. A heading reads `<rows>`, the lines it took, with `c` where its actions lay over the
 * counts or the note, at rest or when up; `<reading>*<n>` stands for n widths in a row that read
 * alike. Keyed by locale, pointer or touch, the board at its first states or its middle ones, and
 * the lane's reference or name.
 */

/** The widths where every state of a heading is read, from the narrowest phone to a wide desktop. */
export const WIDTHS = [320, 350, 390, 430, 480, 530, 560, 600, 680, 760, 900, 1024, 1280, 1440]

/** The widths where a heading is read at rest: every 10px, which finds where its lines change. */
export const SWEEP = [
  ...new Set([...Array.from({ length: 113 }, (_, at) => 320 + 10 * at), ...WIDTHS]),
].toSorted((one, two) => one - two)

export interface Drawn {
  covered: boolean
  rows: number
}

const BASE: Record<string, string> = {
  'en-US|pointer|middle|MAIN-401': '3c*17 2c*9 2*19 2c 2*68',
  'en-US|pointer|middle|MAIN-410': '2*33 1*12 2*8 1*61',
  'en-US|pointer|middle|MAIN-420': '2c*3 2*13 1c*9 1*89',
  'en-US|pointer|middle|MAIN-491': '3c*2 3 2c*9 2*75 1*27',
  'en-US|pointer|middle|MAIN-493': '3c*2 3 2c*9 2*75 1*27',
  'en-US|pointer|middle|No parent': '2*14 1*100',
  'en-US|pointer|start|MAIN-401': '3c 2c*9 2*23 1*12 2*8 1*61',
  'en-US|pointer|start|MAIN-410': '2*33 1*12 2*8 1*61',
  'en-US|pointer|start|MAIN-420': '2c*3 2*13 1c*9 1*89',
  'en-US|pointer|start|MAIN-491': '3c*2 3 2c*9 2*87 1*15',
  'en-US|pointer|start|MAIN-493': '3c*2 3 2c*9 2*102',
  'en-US|pointer|start|No parent': '2*5 1*109',
  'en-US|touch|middle|MAIN-401': '4*9 3*19 2*17 3*3 2*66',
  'en-US|touch|middle|MAIN-410': '2*33 1*12 2*8 1*61',
  'en-US|touch|middle|MAIN-420': '3*4 2*24 1*17 2*2 1*67',
  'en-US|touch|middle|MAIN-491': '3*14 2*73 1*27',
  'en-US|touch|middle|MAIN-493': '3*14 2*73 1*27',
  'en-US|touch|middle|No parent': '2*14 1*100',
  'en-US|touch|start|MAIN-401': '3*12 2*21 1*12 2*8 1*61',
  'en-US|touch|start|MAIN-410': '2*33 1*12 2*8 1*61',
  'en-US|touch|start|MAIN-420': '3*4 2*24 1*17 2*2 1*67',
  'en-US|touch|start|MAIN-491': '3*14 2*85 1*15',
  'en-US|touch|start|MAIN-493': '3*14 2*100',
  'en-US|touch|start|No parent': '2*5 1*109',
  'ru-RU|pointer|middle|MAIN-401': '4c*4 3c*20 2c*9 3*9 2*3 2c*8 3*9 2*52',
  'ru-RU|pointer|middle|MAIN-410': '2c*5 2*28 1*12 2*8 1*61',
  'ru-RU|pointer|middle|MAIN-420': '2c*5 2*14 1c*14 1*12 1c*8 1*61',
  'ru-RU|pointer|middle|MAIN-491': '3c*7 2c*15 2*65 1*27',
  'ru-RU|pointer|middle|MAIN-493': '3c*7 2c*15 2*65 1*27',
  'ru-RU|pointer|middle|Без родителя': '3*3 2*18 1*93',
  'ru-RU|pointer|start|MAIN-401': '3c*5 2c*14 2*14 1*12 2*8 1*61',
  'ru-RU|pointer|start|MAIN-410': '2c*5 2*28 1*12 2*8 1*61',
  'ru-RU|pointer|start|MAIN-420': '2c*5 2*14 1c*14 1*12 1c*8 1*61',
  'ru-RU|pointer|start|MAIN-491': '3c*7 2c*15 2*87 1*5',
  'ru-RU|pointer|start|MAIN-493': '3c*7 2c*15 2*92',
  'ru-RU|pointer|start|Без родителя': '2*11 1*103',
  'ru-RU|touch|middle|MAIN-401': '5*2 4*12 3*28 2*3 3*17 2*52',
  'ru-RU|touch|middle|MAIN-410': '3*7 2*26 1*12 2*8 1*61',
  'ru-RU|touch|middle|MAIN-420': '3*7 2*26 1*12 2*8 1*61',
  'ru-RU|touch|middle|MAIN-491': '4*4 3*20 2*63 1*27',
  'ru-RU|touch|middle|MAIN-493': '4*4 3*20 2*63 1*27',
  'ru-RU|touch|middle|Без родителя': '3*3 2*18 1*93',
  'ru-RU|touch|start|MAIN-401': '4 3*19 2*13 1*12 2*8 1*61',
  'ru-RU|touch|start|MAIN-410': '3*7 2*26 1*12 2*8 1*61',
  'ru-RU|touch|start|MAIN-420': '3*7 2*26 1*12 2*8 1*61',
  'ru-RU|touch|start|MAIN-491': '4*4 3*20 2*85 1*5',
  'ru-RU|touch|start|MAIN-493': '4*4 3*20 2*90',
  'ru-RU|touch|start|Без родителя': '2*11 1*103',
}

/** One heading's readings, a token per width of `SWEEP`. */
const tokens = (key: string) =>
  BASE[key]?.split(' ').flatMap((run) => {
    const [token = '', times = '1'] = run.split('*')
    return Array.from({ length: Number(times) }, () => token)
  }) ?? []

/** How the base drew one heading at `width`; undefined where it was not measured. */
export function baseOf(key: string, width: number): Drawn | undefined {
  const match = tokens(key)[SWEEP.indexOf(width)]?.match(/^(\d+)(c?)$/)
  return match ? { covered: match[2] === 'c', rows: Number(match[1]) } : undefined
}
