import { mysqlTable, int, varchar, char, timestamp, text, json, decimal } from 'drizzle-orm/mysql-core'

export const receiptDocuments = mysqlTable('receipt_documents', {
  id:                   int('id').autoincrement().primaryKey(),
  userId:               varchar('user_id', { length: 128 }).notNull(),
  ownerId:              int('owner_id').notNull(),

  amountMinor:          int('amount_minor').notNull(),
  currencyCode:         varchar('currency_code', { length: 3 }).notNull().default('BRL'),

  purchaseDate:         timestamp('purchase_date').notNull(),
  purchaseMonth:        char('purchase_month', { length: 7 }).notNull(),
  expectedInvoiceMonth: char('expected_invoice_month', { length: 7 }),

  merchantName:         varchar('merchant_name', { length: 255 }),
  merchantCnpj:         varchar('merchant_cnpj', { length: 20 }),
  merchantDocument:     varchar('merchant_document', { length: 20 }),
  paymentKind:          varchar('payment_kind', { length: 20 }),
  issuerName:           varchar('issuer_name', { length: 200 }),
  cardBrand:            varchar('card_brand', { length: 50 }),
  cardLast4:            varchar('card_last4', { length: 4 }),
  maskedNumber:         varchar('masked_number', { length: 32 }),
  ownerName:            varchar('owner_name', { length: 200 }),
  closingDay:           int('closing_day'),
  dueDay:               int('due_day'),
  ocrConfidenceScore:   decimal('ocr_confidence_score', { precision: 5, scale: 4 }),

  categoryId:           varchar('category_id', { length: 128 }),
  accountId:            int('account_id'),

  nfeKey:               varchar('nfe_key', { length: 64 }),
  nfeNumber:            varchar('nfe_number', { length: 20 }),
  nfeSeries:            varchar('nfe_series', { length: 5 }),
  rawPayload:           json('raw_payload'),

  fileUrl:              text('file_url'),
  fileType:             varchar('file_type', { length: 20 }),

  installmentTotal:     int('installment_total'),
  installmentCurrent:   int('installment_current'),

  dataState:            varchar('data_state', { length: 20 }).notNull().default('projected'),
  cardTransactionId:    int('card_transaction_id'),
  transactionId:        int('transaction_id'),
  reconcileSource:      varchar('reconcile_source', { length: 20 }),
  reconciledAt:         timestamp('reconciled_at'),

  description:          text('description'),

  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
})
