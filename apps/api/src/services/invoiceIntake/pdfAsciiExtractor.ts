import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PdfPageCapture, PdfWord } from './types.js'

function runCommand(
  command: string,
  args: string[],
  input?: Buffer,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ stdout, stderr, code })
    })

    if (input) {
      child.stdin.write(input)
    }
    child.stdin.end()
  })
}

async function extractPdfTextWithPdftotext(
  pdfPath: string,
  password?: string,
): Promise<string> {
  const args = ['-layout', '-enc', 'UTF-8']
  if (password) {
    args.push('-upw', password)
  }
  args.push(pdfPath, '-')

  const { stdout, stderr, code } = await runCommand('pdftotext', args)
  if (code !== 0) {
    const message = stderr.trim() || stdout.trim() || `pdftotext failed with exit code ${code ?? 'unknown'}`
    if (/password/i.test(message)) {
      throw new Error(`PDF_PASSWORD_REQUIRED: ${message}`)
    }
    throw new Error(message)
  }
  return stdout.trim()
}

function buildPlainAsciiPages(text: string): PdfPageCapture[] {
  const pageTexts = text.split(/\f/g)
  return pageTexts.map((pageText, index) => ({
    pageNumber: index + 1,
    width: 0,
    height: 0,
    words: [],
  }))
}

function buildPlainAsciiMap(text: string): string {
  const pageTexts = text.split(/\f/g)
  const lines: string[] = []

  pageTexts.forEach((pageText, index) => {
    const normalized = pageText.trimEnd()
    lines.push(`===== PAGE ${index + 1} | width=0 | height=0 =====`)
    if (normalized) {
      lines.push(normalized)
    }
  })

  return lines.join('\n').trim()
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    if (lower === 'nbsp') return ' '

    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match
    }

    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match
    }

    return _match
  })
}

function parseAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  fragment.replace(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g, (_match, key: string, value: string) => {
    attributes[key] = value
    return _match
  })
  return attributes
}

type BboxPageParseResult = {
  pages: PdfPageCapture[]
  asciiText: string
}

type BboxLineCapture = {
  x0: number
  x1: number
  top: number
  bottom: number
  text: string
}

function renderWordsFromLine(words: PdfWord[], pageWidth: number): string {
  if (words.length === 0) return ''

  const ordered = [...words].sort((a, b) => a.x0 - b.x0 || a.top - b.top)
  const avgCharWidth = estimateAverageCharWidth(ordered)
  const lineWidth = pageWidth > 0 ? pageWidth : ordered.reduce((max, word) => Math.max(max, word.x1), 0)
  const indentWidth = ordered.length > 0 ? Math.max(0, Math.round(ordered[0].x0 / avgCharWidth)) : 0
  const segments: string[] = []
  let cursor = 0

  for (const word of ordered) {
    const target = Math.max(0, Math.round(word.x0 / avgCharWidth))
    const spaces = segments.length === 0
      ? Math.min(indentWidth, target)
      : Math.max(1, target - cursor)

    if (spaces > 0) {
      segments.push(' '.repeat(spaces))
    }
    segments.push(word.text)
    cursor = target + word.text.length
  }

  const text = segments.join('').replace(/\s+$/, '')
  if (!lineWidth || text.length <= lineWidth) return text
  return text.slice(0, lineWidth).trimEnd()
}

function renderFragmentsAtPositions(
  fragments: Array<{ x0: number; text: string }>,
  pageWidth: number,
  charWidth: number,
): string {
  if (fragments.length === 0) return ''

  const ordered = [...fragments].sort((a, b) => a.x0 - b.x0)
  const maxExtent = ordered.reduce((max, fragment) => {
    const start = Math.max(0, Math.round(fragment.x0 / charWidth))
    return Math.max(max, start + fragment.text.length)
  }, 0)
  const pageChars = pageWidth > 0 ? Math.max(0, Math.round(pageWidth / charWidth)) : 0
  const canvasLength = Math.max(maxExtent + 2, pageChars + 2)
  const canvas = Array.from({ length: canvasLength }, () => ' ')

  for (const fragment of ordered) {
    const text = fragment.text.replace(/\s+$/, '')
    if (!text) continue

    const start = Math.max(0, Math.round(fragment.x0 / charWidth))
    for (let index = 0; index < text.length; index += 1) {
      const position = start + index
      if (position >= canvas.length) {
        canvas.push(...Array.from({ length: position + 1 - canvas.length }, () => ' '))
      }

      const current = canvas[position]
      const next = text[index] ?? ' '
      if (current === ' ' || current === undefined) {
        canvas[position] = next
      }
    }
  }

  return canvas.join('').replace(/\s+$/, '')
}

function renderBboxLine(words: PdfWord[], pageWidth: number): string {
  const ordered = [...words].sort((a, b) => a.x0 - b.x0 || a.top - b.top)
  if (ordered.length === 0) return ''

  return renderWordsFromLine(ordered, pageWidth)
}

function parseBboxLayoutPages(xml: string): BboxPageParseResult {
  const pages: PdfPageCapture[] = []
  const pageRegex = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi
  const lineRegex = /<line\b([^>]*)>([\s\S]*?)<\/line>/gi
  const wordRegex = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi

  for (const pageMatch of xml.matchAll(pageRegex)) {
    const pageAttrs = parseAttributes(pageMatch[1] ?? '')
    const pageBody = pageMatch[2] ?? ''
    const words: PdfWord[] = []
    const lineCaptures: BboxLineCapture[] = []

    for (const lineMatch of pageBody.matchAll(lineRegex)) {
      const lineAttrs = parseAttributes(lineMatch[1] ?? '')
      const lineBody = lineMatch[2] ?? ''
      const lineWords: PdfWord[] = []

      for (const wordMatch of lineBody.matchAll(wordRegex)) {
        const attrs = parseAttributes(wordMatch[1] ?? '')
        const rawText = wordMatch[2] ?? ''
        const text = decodeHtmlEntities(rawText).replace(/\s+/g, ' ').trim()
        if (!text) continue

        const word: PdfWord = {
          text,
          x0: Number.parseFloat(attrs.xMin ?? attrs.x0 ?? '0') || 0,
          x1: Number.parseFloat(attrs.xMax ?? attrs.x1 ?? '0') || 0,
          top: Number.parseFloat(attrs.yMin ?? attrs.top ?? '0') || 0,
          bottom: Number.parseFloat(attrs.yMax ?? attrs.bottom ?? '0') || 0,
        }
        words.push(word)
        lineWords.push(word)
      }

      if (lineWords.length > 0) {
        const rendered = renderBboxLine(lineWords, Number.parseFloat(pageAttrs.width ?? '0') || 0)
        if (rendered) {
          lineCaptures.push({
            x0: Number.parseFloat(lineAttrs.xMin ?? lineAttrs.x0 ?? String(lineWords[0]?.x0 ?? 0)) || 0,
            x1: Number.parseFloat(lineAttrs.xMax ?? lineAttrs.x1 ?? String(lineWords.at(-1)?.x1 ?? 0)) || 0,
            top: Number.parseFloat(lineAttrs.yMin ?? lineAttrs.top ?? String(lineWords[0]?.top ?? 0)) || 0,
            bottom: Number.parseFloat(lineAttrs.yMax ?? lineAttrs.bottom ?? String(lineWords.at(-1)?.bottom ?? 0)) || 0,
            text: rendered,
          })
        }
      }
    }

    const renderedLines: string[] = []
    const orderedLines = lineCaptures.sort((a, b) => a.top - b.top || a.x0 - b.x0)
    const lineTolerance = 2.2
    let group: BboxLineCapture[] = []
    let groupTop: number | null = null
    const charWidth = estimateAverageCharWidth(words)

    const flushGroup = () => {
      if (group.length === 0) return
      const line = renderFragmentsAtPositions(
        group.map((entry) => ({ x0: entry.x0, text: entry.text })),
        Number.parseFloat(pageAttrs.width ?? '0') || 0,
        charWidth,
      )
      renderedLines.push(line)
      group = []
      groupTop = null
    }

    for (const line of orderedLines) {
      if (groupTop === null || Math.abs(line.top - groupTop) <= lineTolerance) {
        group.push(line)
        groupTop = groupTop === null ? line.top : Math.min(groupTop, line.top)
        continue
      }

      flushGroup()
      group.push(line)
      groupTop = line.top
    }
    flushGroup()

    pages.push({
      pageNumber: pages.length + 1,
      width: Number.parseFloat(pageAttrs.width ?? '0') || 0,
      height: Number.parseFloat(pageAttrs.height ?? '0') || 0,
      words,
    })
  }

  return {
    pages,
    asciiText: buildAsciiMap(pages),
  }
}

export async function extractPdfPagesWithCoordinates(
  buffer: Buffer,
  password?: string,
): Promise<{ pages: PdfPageCapture[]; asciiText?: string }> {
  const workDir = mkdtempSync(join(tmpdir(), 'previa-invoices-'))
  const pdfPath = join(workDir, 'invoice.pdf')
  writeFileSync(pdfPath, buffer)

  try {
    try {
      const args = ['-bbox-layout', '-enc', 'UTF-8']
      if (password) {
        args.push('-upw', password)
      }
      args.push(pdfPath, '-')

      const { stdout, stderr, code } = await runCommand('pdftotext', args)
      if (code === 0) {
        const parsed = parseBboxLayoutPages(stdout)
        const parsedPages = parsed.pages
        if (parsedPages.length > 0) {
          return {
            pages: parsedPages,
            asciiText: parsed.asciiText,
          }
        }
      } else {
        const message = stderr.trim() || stdout.trim() || `pdftotext failed with exit code ${code ?? 'unknown'}`
        if (/password/i.test(message)) {
          throw new Error(`PDF_PASSWORD_REQUIRED: ${message}`)
        }
      }
    } catch {
      // Fall back to pdftotext layout for encrypted PDFs, parser-specific
      // failures, or malformed bbox output. We prefer a usable structural
      // ASCII preview over a hard stop.
    }

    const text = await extractPdfTextWithPdftotext(pdfPath, password)
    if (!text.trim()) return { pages: [] }
    return {
      pages: buildPlainAsciiPages(text),
      asciiText: buildPlainAsciiMap(text),
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      // best effort cleanup
    }
  }
}

function median(values: number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function estimateAverageCharWidth(words: PdfWord[]): number {
  const samples = words
    .map((word) => {
      const length = Math.max(1, word.text.replace(/\s+/g, '').length)
      return (word.x1 - word.x0) / length
    })
    .filter((value) => Number.isFinite(value) && value > 0)

  return clamp(median(samples) || 6, 3.5, 14)
}

function estimateAverageRowHeight(words: PdfWord[]): number {
  const samples = words
    .map((word) => word.bottom - word.top)
    .filter((value) => Number.isFinite(value) && value > 0)

  return clamp(median(samples) || 10, 6, 20)
}

function groupWordsIntoRows(words: PdfWord[], rowTolerance: number): PdfWord[][] {
  const rows: PdfWord[][] = []
  const ordered = [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0)

  for (const word of ordered) {
    const lastRow = rows[rows.length - 1]
    if (!lastRow) {
      rows.push([word])
      continue
    }

    const rowTop = lastRow[0].top
    if (Math.abs(word.top - rowTop) <= rowTolerance) {
      lastRow.push(word)
      continue
    }

    rows.push([word])
  }

  return rows
}

function splitRowIntoRuns(words: PdfWord[], charWidth: number): PdfWord[][] {
  const ordered = [...words].sort((a, b) => a.x0 - b.x0 || a.top - b.top)
  if (ordered.length <= 1) return [ordered]

  const runs: PdfWord[][] = [[ordered[0]]]
  // Smaller threshold = melhor separação de colunas sem “colar” blocos distantes.
  const gapThreshold = clamp(Math.round(charWidth * 3.25), 16, 34)

  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index]
    const previous = runs[runs.length - 1][runs[runs.length - 1].length - 1]
    const gap = current.x0 - previous.x1

    if (gap > gapThreshold) {
      runs.push([current])
      continue
    }

    runs[runs.length - 1].push(current)
  }

  return runs
}

function renderAsciiRow(words: PdfWord[], charWidth: number, offsetX = 0): string {
  if (words.length === 0) return ''

  const ordered = [...words].sort((a, b) => a.x0 - b.x0)
  const segments: string[] = []
  let cursor = 0

  for (const word of ordered) {
    const target = Math.max(0, Math.round((word.x0 - offsetX) / charWidth))
    const spaces = segments.length === 0
      ? target
      : Math.max(1, target - cursor)

    if (spaces > 0) {
      segments.push(' '.repeat(spaces))
    }
    segments.push(word.text)
    cursor = target + word.text.length
  }

  return segments.join('').replace(/\s+$/, '')
}

export function buildAsciiMap(pages: PdfPageCapture[]): string {
  const lines: string[] = []

  for (const page of pages) {
    const charWidth = estimateAverageCharWidth(page.words)
    const rowTolerance = clamp(Math.round(estimateAverageRowHeight(page.words) * 0.55), 2, 8)
    const rows = groupWordsIntoRows(page.words, rowTolerance)
    let previousTop: number | null = null

    lines.push(`===== PAGE ${page.pageNumber} | width=${Math.round(page.width)} | height=${Math.round(page.height)} =====`)
    for (const row of rows) {
      const top = row[0]?.top ?? 0
      if (previousTop !== null) {
        const verticalGap = top - previousTop
        const blankLines = clamp(Math.round(verticalGap / (rowTolerance * 1.6)) - 1, 0, 3)
        for (const _ of Array.from({ length: blankLines })) {
          lines.push('')
        }
      }
      lines.push(renderAsciiRow(row, charWidth))
      previousTop = top
    }
  }

  return lines.join('\n').trim()
}

export async function extractAsciiStructuralTextFromPdf(
  buffer: Buffer,
  password?: string,
): Promise<{ pages: PdfPageCapture[]; asciiText: string }> {
  const result = await extractPdfPagesWithCoordinates(buffer, password)
  if (result.pages.length === 0) {
    throw new Error('PDF sem texto extraível.')
  }

  return {
    pages: result.pages,
    asciiText: result.asciiText ?? buildAsciiMap(result.pages),
  }
}
