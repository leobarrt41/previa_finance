import { parseCsvStatement } from '../src'

describe('nubank parser (placeholder)', () => {
  it('parses a sample CSV', async () => {
    const result = await parseCsvStatement('path/to/sample.csv')
    expect(Array.isArray(result)).toBe(true)
  })
})
