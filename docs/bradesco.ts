import { parseInvoiceTextLoose } from "../../cardInvoiceParser";
import type { InvoiceParser, InvoiceParserResult } from "../types";

const datePrefixRegex = /(\d{2}\/\d{2})\s+/;
const amountRegex = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
const installmentRegex = /(?:\(|PARC\s*)?(\d{1,2})\s*\/\s*(\d{1,2})(?:\))?/i;

function parseAmountToCents(value: string): number | null {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function parseDateDM(value: string, fallbackYear: number, dueDate?: Date | null): Date | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(value);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (!Number.isFinite(day) || !Number.isFinite(month) || month < 0 || month > 11) return null;
  let year = dueDate ? dueDate.getFullYear() : fallbackYear;
  const ref = dueDate ?? new Date();
  if (month > ref.getMonth()) year -= 1;
  const date = new Date(year, month, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeLine(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeDescription(raw: string) {
  return raw
    .replace(/\bR\$\s*$/i, "")
    .replace(/\s+\d{4}\.\d{2}\*{2}\.\*{4}\.\d{4}\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isGarbageDescription(raw: string) {
  const normalized = normalizeLine(raw)
    .replace(/R\$/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return normalized.length === 0;
}

function extractDueDate(text: string): Date | null {
  const normalized = text.replace(/\r/g, "\n");
  const m = normalized.match(/VENCIMENTO[:\s]*([0-3]\d)[\/-](\d{2})[\/-](\d{4})/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const year = Number(m[3]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  const d = new Date(year, month, day, 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function alignInstallmentDateWithDueDate(
  day: number,
  month: number, // 0-11
  dueDate: Date,
  installmentNumber: number
): Date {
  const candidates: Date[] = [];
  for (let y = dueDate.getFullYear() - 3; y <= dueDate.getFullYear(); y += 1) {
    const d = new Date(y, month, day, 12, 0, 0, 0);
    if (!Number.isNaN(d.getTime()) && d <= dueDate) candidates.push(d);
  }
  if (!candidates.length) return new Date(dueDate);

  const dueMonthIndex = dueDate.getFullYear() * 12 + dueDate.getMonth();
  const targetDiff = Math.max(0, installmentNumber - 1);
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const candMonthIndex = c.getFullYear() * 12 + c.getMonth();
    const monthDiff = dueMonthIndex - candMonthIndex;
    const score = Math.abs(monthDiff - targetDiff) * 1000 + Math.abs(dueDate.getTime() - c.getTime());
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function shouldSkipDescription(raw: string) {
  const normalized = normalizeLine(raw);
  if (!normalized) return true;
  const skipPatterns = [
    /TOTAL PARCELADO PARA AS PROXIMAS FATURAS/,
    /DEMAIS FATURAS/,
    /PROXIMA FATURA/,
    /TOTAL PARA AS PROXIMAS FATURAS/,
    /^PAGAMENTO RECEBIDO\b/,
    /^PAGAMENTO\b/,
    /^PGTO\b/,
    /BANCO BRADESCARD/,
    /CIDADE DE DEUS/,
    /LIMITE/,
    /OPCOES DE PAGAMENTO/,
    /PAGAMENTO MINIMO/,
    /^NACIONAIS EM REAIS/,
    /^DATA DESCRICAO/,
  ];
  if (skipPatterns.some((pattern) => pattern.test(normalized))) return true;
  // Linha de cartão mascarado usada como cabeçalho/resumo da fatura.
  if (/\d{4}\.\d{2}\*{2}\.\*{4}\.\d{4}/.test(raw) || /\*{4,}/.test(raw)) return true;
  return false;
}

function parseFromLines(text: string, fallbackYear: number): InvoiceParserResult["items"] {
  const lines = text
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items: InvoiceParserResult["items"] = [];
  const dueDate = extractDueDate(text);
  let inLancamentos = false;
  let hasSeenLancamentosHeader = false;

  for (const line of lines) {
    const normalized = normalizeLine(line);

    if (
      /^LANCAMENTOS\b/.test(normalized) ||
      /TRANSACOES NACIONAIS/.test(normalized) ||
      /NACIONAIS EM REAIS/.test(normalized)
    ) {
      inLancamentos = true;
      hasSeenLancamentosHeader = true;
      continue;
    }
    if (
      inLancamentos &&
      (/^TOTAL PARCELADO\b/.test(normalized) ||
        /^LIMITES\b/.test(normalized) ||
        /^OPCOES DE PAGAMENTO\b/.test(normalized) ||
        /^PAGAMENTO TOTAL\b/.test(normalized) ||
        /^PARCELAMENTO DA FATURA\b/.test(normalized) ||
        /^PAGAMENTO MINIMO\b/.test(normalized) ||
        /^TOTAL GERAL DOS LANCAMENTOS\b/.test(normalized))
    ) {
      break;
    }
    if (!inLancamentos && hasSeenLancamentosHeader) continue;
    if (!inLancamentos && !hasSeenLancamentosHeader) {
      // fallback: alguns PDFs vêm sem header claro, então permitimos varredura global
      // mas somente em linhas com formato de lançamento.
    }

    const dateMatch = datePrefixRegex.exec(line);
    if (!dateMatch?.[1]) continue;
    let date = parseDateDM(dateMatch[1], fallbackYear, dueDate);
    const start = dateMatch.index + dateMatch[0].length;
    const rest = line.slice(start).trim();
    if (!rest) continue;
    const amountMatch = amountRegex.exec(rest);
    amountRegex.lastIndex = 0;
    if (!amountMatch?.[0]) continue;
    const amountCents = parseAmountToCents(amountMatch[0]);
    let description = sanitizeDescription(rest.slice(0, amountMatch.index).trim());
    if (!date || !amountCents || !description || isGarbageDescription(description) || shouldSkipDescription(description)) continue;

    const inst = installmentRegex.exec(description);
    const instN = inst ? Number(inst[1]) : undefined;
    const instT = inst ? Number(inst[2]) : undefined;
    const validInstallment =
      instN &&
      instT &&
      instN >= 1 &&
      instT >= 1 &&
      instN <= instT &&
      instT <= 36;
    if (date && dueDate && validInstallment) {
      date = alignInstallmentDateWithDueDate(date.getDate(), date.getMonth(), dueDate, instN);
    }

    items.push({
      date,
      description,
      amountCents,
      installmentNumber: validInstallment ? instN : undefined,
      installmentTotal: validInstallment ? instT : undefined,
    });
  }

  return items;
}

export const bradescoInvoiceParser: InvoiceParser = {
  parserId: "bradesco_v1",
  institution: "bradesco",
  canHandle(text: string) {
    const normalized = normalizeLine(text);
    return /BRADESCO|BRADESCARD/.test(normalized);
  },
  parse(text, context): InvoiceParserResult {
    const strict = parseFromLines(text, context.fallbackYear);
    const loose = parseInvoiceTextLoose(text, context.fallbackYear).filter(
      (item) =>
        !!item?.description &&
        !isGarbageDescription(item.description) &&
        !shouldSkipDescription(item.description)
    );
    const source = strict.length > 0 ? strict : loose;

    const dedup = new Map<string, InvoiceParserResult["items"][number]>();
    for (const item of source) {
      if (!item?.description || shouldSkipDescription(item.description)) continue;
      const key = `${item.date.toISOString().slice(0, 10)}|${normalizeLine(item.description)}|${item.amountCents}`;
      dedup.set(key, item);
    }

    return {
      items: Array.from(dedup.values()),
      parserId: "bradesco_v1",
      institution: "bradesco",
    };
  },
};
