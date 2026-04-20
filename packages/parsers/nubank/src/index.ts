export type Transaction = {
  id: string
  date: string
  description: string
  amountMinor: number
}

export async function parseCsvStatement(filePath: string): Promise<Transaction[]> {
  // TODO: implement CSV parser for statement exports
  return []
}

export async function parsePdfInvoice(buffer: Buffer): Promise<Transaction[]> {
  // TODO: implement PDF invoice parser
  return []
}
