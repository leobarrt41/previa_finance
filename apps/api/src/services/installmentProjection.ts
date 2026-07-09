function normalizeSeriesText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

const NON_PROJECTED_INSTALLMENT_PATTERNS: RegExp[] = [
  /\bPARC\s+AUTOMATIC\b/,
  /\bPARCELAMENTO\s+AUTOMATICO\b/,
  /\bPARCELAMENTO\s+AUTOMATIC\b/,
  /\bFIN\s+PARC\b/,
  /\bCREDITO\s+PARCELADO\b/,
  /\bPARCELADO\s+AUTOMATICO\b/,
]

export function shouldProjectInstallmentSeries(description: string): boolean {
  const normalized = normalizeSeriesText(description)
  if (!normalized) return false

  return !NON_PROJECTED_INSTALLMENT_PATTERNS.some((pattern) => pattern.test(normalized))
}

