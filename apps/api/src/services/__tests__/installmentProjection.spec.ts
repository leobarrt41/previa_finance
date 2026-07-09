import { shouldProjectInstallmentSeries } from '../installmentProjection.js'

describe('shouldProjectInstallmentSeries', () => {
  it('skips installment series that are already advanced in the invoice semantics', () => {
    expect(shouldProjectInstallmentSeries('PARC AUTOMATIC 02/12')).toBe(false)
    expect(shouldProjectInstallmentSeries('Fin parc 03/24')).toBe(false)
  })

  it('keeps regular installment series projected', () => {
    expect(shouldProjectInstallmentSeries('Casas Bahia 01/10')).toBe(true)
    expect(shouldProjectInstallmentSeries('Compra parcelada 03/12')).toBe(true)
  })
})

