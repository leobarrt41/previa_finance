import { normalizeDescription, buildFingerprintFromRaw } from '../..'

describe('fingerprint utilities (placeholder)', () => {
  it('normalizes accented descriptions', () => {
    const s = 'Água e LUZ  - Nº 123'
    const normalized = normalizeDescription(s)
    expect(typeof normalized).toBe('string')
  })

  it('generates a fingerprint from raw input', () => {
    const raw = {
      competencyMonth: '2026-04',
      amountMinor: 100n,
      rawDescription: 'Água e LUZ  - Nº 123',
    }

    const { fingerprint, normalizedDescription } = buildFingerprintFromRaw(raw)
    expect(typeof fingerprint).toBe('string')
    expect(typeof normalizedDescription).toBe('string')
    expect(fingerprint.length).toBeGreaterThan(0)
  })
})
