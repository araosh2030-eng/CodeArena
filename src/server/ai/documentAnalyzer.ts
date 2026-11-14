import { ThinkingLevel } from '@google/genai';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import {
  AnswerKeyEntry,
  DEFAULT_GEMINI_MODEL,
  DOCUMENT_EXTRACTION_SCHEMA,
  RawExtractedQuestionItem,
  getGenAIClient,
} from './aiSchemas';
import { extractAnswerKeyMap } from '../../game/rules';

export interface DocumentChunk {
  chunkIndex: number;
  text: string;
  startPage?: number;
}

export interface AnalyzedDocumentPayload {
  method: 'pdf_text' | 'pdf_vision_ocr' | 'docx' | 'plain_text';
  pagesProcessed?: number;
  rawText: string;
  pages: Array<{ pageNumber: number; text: string }>;
  chunks: DocumentChunk[];
  externalAnswerKey: Map<string, { answer: string; explanation?: string }>;
  scannedPdfBuffer?: Buffer;
  fileName?: string;
}

const STRICT_DOCUMENT_PARSER_PROMPT = `You are the Document Analyzer module of CodeArena AI — Question Intelligence Engine.
RULES (MANDATORY):
1. Extract EVERY programming/CS question from the source document verbatim.
2. Preserve ALL English question wording, variable names, identifiers, and code snippets EXACTLY as written in the source.
3. NEVER rewrite, paraphrase, translate, or alter code syntax.
4. Separate question text cleanly from codeSnippet and options.
5. Extract any explicitly provided answer (inline, end-of-document Answer Key, or worked Solution) into sourceAnswer. Resolve option letters ("B") to exact option text when options are present.
6. If the document does NOT explicitly provide an answer for a question, set sourceAnswer strictly to "NOT PROVIDED" and answerSource to "none". NEVER invent a missing answer as a sourceAnswer.
7. Extract any standalone Answer Key entries into answerKeyMap as well.`;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  timeoutMs = 35000,
  label = 'Gemini request'
): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const delayMs = 600 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Splits a large document into controlled ~12k character chunks on question boundaries
 * while preserving page numbers so sourcePage attribution remains accurate.
 */
export function buildControlledChunks(
  pages: Array<{ pageNumber: number; text: string }>,
  maxChunkChars = 12000
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let currentBuffer = '';
  let currentStartPage = pages[0]?.pageNumber || 1;
  let chunkIndex = 0;

  for (const page of pages) {
    const pageHeader = pages.length > 1 ? `\n[SOURCE_PAGE ${page.pageNumber}]\n` : '';
    const pageText = `${pageHeader}${page.text.trim()}\n`;

    if (currentBuffer.length + pageText.length > maxChunkChars && currentBuffer.trim().length > 0) {
      chunks.push({
        chunkIndex: chunkIndex++,
        text: currentBuffer.trim(),
        startPage: currentStartPage,
      });
      currentBuffer = pageText;
      currentStartPage = page.pageNumber;
    } else {
      if (!currentBuffer) currentStartPage = page.pageNumber;
      currentBuffer += pageText;
    }
  }

  if (currentBuffer.trim().length > 0) {
    chunks.push({
      chunkIndex: chunkIndex++,
      text: currentBuffer.trim(),
      startPage: currentStartPage,
    });
  }

  return chunks;
}

export async function preparePlainTextDocument(
  rawText: string,
  fileName?: string
): Promise<AnalyzedDocumentPayload> {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  const { bodyText, answerKeyMap } = extractAnswerKeyMap(normalized);
  const pages = [{ pageNumber: 1, text: bodyText || normalized }];
  return {
    method: 'plain_text',
    pagesProcessed: 1,
    rawText: normalized,
    pages,
    chunks: buildControlledChunks(pages),
    externalAnswerKey: answerKeyMap,
    fileName,
  };
}

export async function prepareDocxDocument(
  buffer: Buffer,
  fileName: string
): Promise<AnalyzedDocumentPayload> {
  const result = await mammoth.extractRawText({ buffer });
  const rawText = (result.value || '').replace(/\r\n/g, '\n').trim();
  if (!rawText) {
    throw new Error('No readable text could be extracted from this Word (.docx) document.');
  }
  const { bodyText, answerKeyMap } = extractAnswerKeyMap(rawText);
  const pages = [{ pageNumber: 1, text: bodyText || rawText }];
  return {
    method: 'docx',
    pagesProcessed: 1,
    rawText,
    pages,
    chunks: buildControlledChunks(pages),
    externalAnswerKey: answerKeyMap,
    fileName,
  };
}

export async function preparePdfDocument(
  buffer: Buffer,
  fileName: string
): Promise<AnalyzedDocumentPayload> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textResult = await parser.getText();
    const totalPages = textResult.total || textResult.pages?.length || 1;
    const combinedText = (textResult.text || '').replace(/\r\n/g, '\n').trim();
    const nonSpaceLen = combinedText.replace(/\s+/g, '').length;

    if (nonSpaceLen < 60) {
      return {
        method: 'pdf_vision_ocr',
        pagesProcessed: totalPages,
        rawText: combinedText,
        pages: [],
        chunks: [],
        externalAnswerKey: new Map(),
        scannedPdfBuffer: buffer,
        fileName,
      };
    }

    const { answerKeyMap } = extractAnswerKeyMap(combinedText);
    const pages =
      textResult.pages && textResult.pages.length > 0
        ? textResult.pages.map(p => ({ pageNumber: p.num, text: p.text || '' }))
        : [{ pageNumber: 1, text: combinedText }];

    return {
      method: 'pdf_text',
      pagesProcessed: totalPages,
      rawText: combinedText,
      pages,
      chunks: buildControlledChunks(pages),
      externalAnswerKey: answerKeyMap,
      fileName,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export async function extractChunkWithGemini(
  chunk: DocumentChunk,
  answerKeyContextText?: string
): Promise<{
  questions: RawExtractedQuestionItem[];
  answerKeyMap: AnswerKeyEntry[];
} | null> {
  const ai = getGenAIClient();
  if (!ai) return null;

  const keyContext = answerKeyContextText
    ? `\nGLOBAL DOCUMENT ANSWER KEY CONTEXT (match by question number if applicable):\n${answerKeyContextText}\n`
    : '';

  const response = await runWithRetry(
    () =>
      ai.models.generateContent({
        model: DEFAULT_GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${STRICT_DOCUMENT_PARSER_PROMPT}${keyContext}\nCHUNK TEXT (starting near page ${chunk.startPage || 1}):\n"""\n${chunk.text}\n"""`,
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: DOCUMENT_EXTRACTION_SCHEMA,
        },
      }),
    2,
    40000,
    'Gemini chunk extraction'
  );

  const jsonText = response.text;
  if (!jsonText) return null;
  const parsed = JSON.parse(jsonText);
  return {
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    answerKeyMap: Array.isArray(parsed.answerKeyMap) ? parsed.answerKeyMap : [],
  };
}

export async function extractScannedPdfWithGemini(
  buffer: Buffer,
  fileName: string
): Promise<{
  questions: RawExtractedQuestionItem[];
  answerKeyMap: AnswerKeyEntry[];
}> {
  const ai = getGenAIClient();
  if (!ai) {
    throw new Error(
      `PDF "${fileName}" appears to be scanned/image-based with no selectable text, and GEMINI_API_KEY is not configured for OCR extraction.`
    );
  }

  const response = await runWithRetry(
    () =>
      ai.models.generateContent({
        model: DEFAULT_GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: buffer.toString('base64'),
                },
              },
              {
                text: `${STRICT_DOCUMENT_PARSER_PROMPT}\n\nExtract all programming questions, code blocks, options, page numbers, and any provided answer keys from this PDF verbatim.`,
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: DOCUMENT_EXTRACTION_SCHEMA,
        },
      }),
    2,
    55000,
    'Gemini scanned PDF OCR'
  );

  const jsonText = response.text;
  if (!jsonText) return { questions: [], answerKeyMap: [] };
  const parsed = JSON.parse(jsonText);
  return {
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    answerKeyMap: Array.isArray(parsed.answerKeyMap) ? parsed.answerKeyMap : [],
  };
}
