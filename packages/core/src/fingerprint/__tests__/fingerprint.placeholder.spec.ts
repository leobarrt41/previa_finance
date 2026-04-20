import { normalizeDescription, generateFingerprint } from '../..'

describe('fingerprint utilities (placeholder)', () => {
  it('normalizes accented descriptions', () => {
    const s = 'Água e LUZ  - Nº 123'
    const normalized = normalizeDescription(s)
    expect(typeof normalized).toBe('string')
  })
  it('generates a fingerprint', () => {
    const fp = generateFingerprint('1', '01/01/2026', 100)
    expect(typeof fp).toBe('string')
  })
})
