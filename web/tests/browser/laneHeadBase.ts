/**
 * How the base drew each lane heading of the wide board (`laneWideFixture.ts`), before its actions
 * kept a place of their own: measured at rest in the built app, with its fonts, at each of
 * `WIDTHS`. A heading reads `<rows>.<letters>`, the lines it took and the letters of its title
 * drawn whole, with `c` where its actions lay over the counts or the note, at rest or when up.
 * Keyed by locale, pointer or touch, the board at its first states or its middle ones, and the
 * lane's reference or name.
 */

/** The widths where a heading's lines change, from the narrowest phone to a wide desktop. */
export const WIDTHS = [320, 350, 390, 430, 480, 530, 560, 600, 680, 760, 900, 1024, 1280, 1440]

export interface Drawn {
  covered: boolean
  letters: number
  rows: number
}

const BASE: Record<string, string> = {
  'en-US|pointer|middle|MAIN-401':
    '3.15c 3.20c 3.25c 3.31c 3.39c 2.46c 2.51c 2.57 2.69 2.77 2.69 2.85 2.105 2.105',
  'en-US|pointer|middle|MAIN-410':
    '2.14 2.19 2.24 2.30 2.37 2.45 2.52 2.57 1.33 1.42 1.33 1.53 1.90 1.101',
  'en-US|pointer|middle|MAIN-420':
    '2.15c 2.15 2.15 2.15 1.15c 1.15c 1.15c 1.15 1.15 1.15 1.15 1.15 1.15 1.15',
  'en-US|pointer|middle|MAIN-491':
    '3.14c 2.18c 2.25c 2.31c 2.39 2.47 2.50 2.57 2.71 2.71 2.71 2.71 1.71 1.71',
  'en-US|pointer|middle|MAIN-493':
    '3.15c 2.19c 2.26c 2.32c 2.40 2.48 2.52 2.59 2.70 2.80 2.71 2.89 1.83 1.100',
  'en-US|pointer|middle|No epic': '2.7 2.7 2.7 2.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7',
  'en-US|pointer|start|MAIN-401':
    '3.15c 2.20c 2.25c 2.31 2.39 2.46 2.51 2.57 1.26 1.36 1.27 1.45 1.79 1.105',
  'en-US|pointer|start|MAIN-410':
    '2.14 2.19 2.24 2.30 2.37 2.45 2.52 2.57 1.33 1.42 1.33 1.53 1.90 1.101',
  'en-US|pointer|start|MAIN-420':
    '2.15c 2.15 2.15 2.15 1.15c 1.15c 1.15c 1.15 1.15 1.15 1.15 1.15 1.15 1.15',
  'en-US|pointer|start|MAIN-491':
    '3.14c 2.18c 2.25c 2.31c 2.39 2.47 2.50 2.57 2.71 2.71 2.71 2.71 2.71 1.71',
  'en-US|pointer|start|MAIN-493':
    '3.15c 2.19c 2.26c 2.32c 2.40 2.48 2.52 2.59 2.70 2.80 2.71 2.89 2.100 2.100',
  'en-US|pointer|start|No epic': '2.7 2.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7',
  'en-US|touch|middle|MAIN-401':
    '4.15 4.20 4.25 3.31 3.39 3.46 3.51 2.57 2.69 2.77 2.69 2.85 2.105 2.105',
  'en-US|touch|middle|MAIN-410':
    '2.14 2.19 2.24 2.30 2.37 2.45 2.52 2.57 1.33 1.42 1.33 1.53 1.90 1.101',
  'en-US|touch|middle|MAIN-420':
    '3.15 3.15 2.15 2.15 2.15 2.15 2.15 1.15 1.15 1.15 1.15 1.15 1.15 1.15',
  'en-US|touch|middle|MAIN-491':
    '3.14 3.18 3.25 3.31 2.39 2.47 2.50 2.57 2.71 2.71 2.71 2.71 1.71 1.71',
  'en-US|touch|middle|MAIN-493':
    '3.15 3.19 3.26 3.32 2.40 2.48 2.52 2.59 2.70 2.80 2.71 2.89 1.83 1.100',
  'en-US|touch|middle|No epic': '2.7 2.7 2.7 2.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7',
  'en-US|touch|start|MAIN-401':
    '3.15 3.20 3.25 3.31 2.39 2.46 2.51 2.57 1.26 1.36 1.27 1.45 1.79 1.105',
  'en-US|touch|start|MAIN-410':
    '2.14 2.19 2.24 2.30 2.37 2.45 2.52 2.57 1.33 1.42 1.33 1.53 1.90 1.101',
  'en-US|touch|start|MAIN-420':
    '3.15 3.15 2.15 2.15 2.15 2.15 2.15 1.15 1.15 1.15 1.15 1.15 1.15 1.15',
  'en-US|touch|start|MAIN-491':
    '3.14 3.18 3.25 3.31 2.39 2.47 2.50 2.57 2.71 2.71 2.71 2.71 2.71 1.71',
  'en-US|touch|start|MAIN-493':
    '3.15 3.19 3.26 3.32 2.40 2.48 2.52 2.59 2.70 2.80 2.71 2.89 2.100 2.100',
  'en-US|touch|start|No epic': '2.7 2.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7 1.7',
  'ru-RU|pointer|middle|MAIN-401':
    '4.15c 4.20c 3.25c 3.31c 3.39c 3.46c 2.51c 2.57c 3.69 2.77 3.69 2.85 2.105 2.105',
  'ru-RU|pointer|middle|MAIN-410':
    '2.14c 2.19c 2.24 2.30 2.37 2.45 2.52 2.57 1.21 1.30 1.21 1.38 1.76 1.101',
  'ru-RU|pointer|middle|MAIN-420':
    '2.15c 2.15c 2.15 2.15 2.15 1.15c 1.15c 1.15c 1.15 1.15 1.15 1.15 1.15 1.15',
  'ru-RU|pointer|middle|MAIN-491':
    '3.14c 3.18c 2.25c 2.31c 2.39c 2.47c 2.50 2.57 2.71 2.71 2.71 2.71 1.68 1.71',
  'ru-RU|pointer|middle|MAIN-493':
    '3.15c 3.19c 2.26c 2.32c 2.40c 2.48c 2.52 2.59 2.70 2.80 2.71 2.89 1.70 1.96',
  'ru-RU|pointer|middle|Без эпика': '3.9 2.9 2.9 2.9 2.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9',
  'ru-RU|pointer|start|MAIN-401':
    '3.15c 3.20c 2.25c 2.31c 2.39c 2.46 2.51 2.57 1.15 1.24 1.15 1.32 1.68 1.91',
  'ru-RU|pointer|start|MAIN-410':
    '2.14c 2.19c 2.24 2.30 2.37 2.45 2.52 2.57 1.21 1.30 1.21 1.38 1.76 1.101',
  'ru-RU|pointer|start|MAIN-420':
    '2.15c 2.15c 2.15 2.15 2.15 1.15c 1.15c 1.15c 1.15 1.15 1.15 1.15 1.15 1.15',
  'ru-RU|pointer|start|MAIN-491':
    '3.14c 3.18c 2.25c 2.31c 2.39c 2.47c 2.50 2.57 2.71 2.71 2.71 2.71 2.71 1.71',
  'ru-RU|pointer|start|MAIN-493':
    '3.15c 3.19c 2.26c 2.32c 2.40c 2.48c 2.52 2.59 2.70 2.80 2.71 2.89 2.100 2.100',
  'ru-RU|pointer|start|Без эпика': '2.9 2.9 2.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9',
  'ru-RU|touch|middle|MAIN-401':
    '5.15 4.20 4.25 4.31 3.39 3.46 3.51 3.57 3.69 2.77 3.69 2.85 2.105 2.105',
  'ru-RU|touch|middle|MAIN-410':
    '3.14 3.19 2.24 2.30 2.37 2.45 2.52 2.57 1.21 1.30 1.21 1.38 1.76 1.101',
  'ru-RU|touch|middle|MAIN-420':
    '3.15 3.15 2.15 2.15 2.15 2.15 2.15 2.15 1.15 1.15 1.15 1.15 1.15 1.15',
  'ru-RU|touch|middle|MAIN-491':
    '4.14 4.18 3.25 3.31 3.39 3.47 2.50 2.57 2.71 2.71 2.71 2.71 1.68 1.71',
  'ru-RU|touch|middle|MAIN-493':
    '4.15 4.19 3.26 3.32 3.40 3.48 2.52 2.59 2.70 2.80 2.71 2.89 1.70 1.96',
  'ru-RU|touch|middle|Без эпика': '3.9 2.9 2.9 2.9 2.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9',
  'ru-RU|touch|start|MAIN-401':
    '4.15 3.20 3.25 3.31 3.39 2.46 2.51 2.57 1.15 1.24 1.15 1.32 1.68 1.91',
  'ru-RU|touch|start|MAIN-410':
    '3.14 3.19 2.24 2.30 2.37 2.45 2.52 2.57 1.21 1.30 1.21 1.38 1.76 1.101',
  'ru-RU|touch|start|MAIN-420':
    '3.15 3.15 2.15 2.15 2.15 2.15 2.15 2.15 1.15 1.15 1.15 1.15 1.15 1.15',
  'ru-RU|touch|start|MAIN-491':
    '4.14 4.18 3.25 3.31 3.39 3.47 2.50 2.57 2.71 2.71 2.71 2.71 2.71 1.71',
  'ru-RU|touch|start|MAIN-493':
    '4.15 4.19 3.26 3.32 3.40 3.48 2.52 2.59 2.70 2.80 2.71 2.89 2.100 2.100',
  'ru-RU|touch|start|Без эпика': '2.9 2.9 2.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9 1.9',
}

/** How the base drew one heading at `width`; undefined where it was not measured. */
export function baseOf(key: string, width: number): Drawn | undefined {
  const token = BASE[key]?.split(' ')[WIDTHS.indexOf(width)]
  const match = token?.match(/^(\d+)\.(\d+)(c?)$/)
  return match
    ? { covered: match[3] === 'c', letters: Number(match[2]), rows: Number(match[1]) }
    : undefined
}
