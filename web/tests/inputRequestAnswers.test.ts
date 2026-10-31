import { expect, test } from 'vitest'

import { checkAnswers } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

const options = [
  { id: 'keep', label: 'Keep' },
  { id: 'merge', label: 'Merge' },
]
const fields: InputRequestField[] = [
  { id: 'proceed', label: 'Proceed', type: 'boolean', required: true, options: [] },
  { id: 'branch', label: 'Branch', type: 'choice', required: true, options },
  { id: 'extra', label: 'Extra', type: 'multi_choice', required: false, options },
  { id: 'note', label: 'Note', type: 'text', required: true, options: [] },
]

test('names every refused field, in the order the question lists them', () => {
  expect(checkAnswers(fields, {})).toEqual({
    refused: ['proceed', 'branch', 'note'],
    values: {},
  })
})

test('refuses a value that is present but not an answer', () => {
  const { refused } = checkAnswers(fields, {
    proceed: 'true',
    branch: 'unknown',
    note: '   ',
  })
  expect(refused).toEqual(['proceed', 'branch', 'note'])
})

test('sends false, leaves out an empty optional field and refuses nothing', () => {
  expect(checkAnswers(fields, { proceed: false, branch: 'merge', extra: [], note: 'why' })).toEqual(
    { refused: [], values: { proceed: false, branch: 'merge', note: 'why' } },
  )
})
