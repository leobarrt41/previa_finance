// API client stubs for frontend

export type CashFlowRequest = {
  start: string
  months: number
}

export type CashFlowResponse = {
  month: string
  balanceMinor: number
}[]

export async function getCashFlowProjection(params: CashFlowRequest): Promise<CashFlowResponse> {
  // TODO: call backend endpoint
  return []
}
