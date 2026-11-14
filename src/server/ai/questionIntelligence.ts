import crypto from 'crypto';
import { Question } from '../../types/game';
import {
  analyzeQuestionQuality,
  extractQuestionsFromRawText,
  isQuestionReadyForGame,
} from '../../game/rules';
import {
  AiAnalysisSummary,
  DEFAULT_GEMINI_MODEL,
  QuestionIntelligenceResult,
  RawExtractedQuestionItem,
  isGeminiConfigured,
} from './aiSchemas';
import {
  AnalyzedDocumentPayload,
  extractChunkWithGemini,
  extractScannedPdfWithGemini,
  prepareDocxDocument,
  preparePdfDocument,
  preparePlainTextDocument,
} from './documentAnalyzer';
import {
  detectProgrammingLanguage,
  detectQuestionTopic,
  inferDifficulty,
  normalizeQuestionType,
  pointsForDifficulty,
} from './questionClassifier';
import { verifyExtractedQuestions } from './answerVerifier';

const MAX_CACHE_ENTRIES = 25;
const extractionCache = new Map<string, QuestionIntelligenceResult>();

function computeContentHash(input: Buffer | string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function setCachedResult(key: string, value: QuestionIntelligenceResult): void {
  if (extractionCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = extractionCache.keys().next().value;
    if (oldestKey) extractionCache.delete(oldestKey);
  }
  extractionCache.set(key, value);
}

function normalizeRawAiItems(
  items: RawExtractedQuestionItem[],
  sourceFileName: string | undefined,
  externalAnswerKey: Map<string, { answer: string; explanation?: string }>,
  defaultPage = 1
): Question[] {
  return items
    .filter(item => item && typeof item.questionText === 'string' && item.questionText.trim().length > 0)
    .map((item, idx) => {
      const qNum = item.questionNumber?.trim() || `Q${idx + 1}`;
      const numDigits = qNum.replace(/\D+/g, '') || String(idx + 1);

      let rawAns = (item.sourceAnswer || '').trim();
      let ansSource = item.answerSource || 'none';
      let explanation = item.sourceExplanation?.trim();

      if ((!rawAns || rawAns.toUpperCase() === 'NOT PROVIDED') && externalAnswerKey.has(numDigits)) {
        const keyEntry = externalAnswerKey.get(numDigits)!;
        rawAns = keyEntry.answer;
        ansSource = 'answer_key_section';
        if (!explanation && keyEntry.explanation) explanation = keyEntry.explanation;
      }

      const rawOptions = Array.isArray(item.options)
        ? item.options.map(o => String(o).trim()).filter(Boolean)
        : [];

      const qType = normalizeQuestionType({
        rawType: item.type,
        questionText: item.questionText.trim(),
        codeSnippet: item.codeSnippet?.trim(),
        options: rawOptions,
        rawAnswer: rawAns,
      });

      const finalOptions =
        qType === 'true_false'
          ? ['True', 'False']
          : rawOptions.length > 0
          ? rawOptions
          : undefined;

      // Resolve letter answer e.g. "B" to exact option text
      if (rawAns && /^[A-E]$/i.test(rawAns) && finalOptions && finalOptions.length > 0) {
        const idxMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
        const optIdx = idxMap[rawAns.toUpperCase()];
        if (optIdx !== undefined && finalOptions[optIdx]) {
          rawAns = finalOptions[optIdx];
        }
      }

      const hasSourceAns = rawAns.length > 0 && rawAns.toUpperCase() !== 'NOT PROVIDED';
      const codeSnippet =
        typeof item.codeSnippet === 'string' && item.codeSnippet.trim().length > 0
          ? item.codeSnippet.replace(/\n+$/, '')
          : undefined;
      const diff = inferDifficulty(qType, codeSnippet, item.difficulty);
      const language =
        item.programmingLanguage?.trim() ||
        detectProgrammingLanguage(item.questionText, codeSnippet);
      const topic = item.topic?.trim() || detectQuestionTopic(item.questionText, codeSnippet);

      return {
        id: `q-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
        questionNumber: qNum,
        questionText: item.questionText.trim(),
        codeSnippet,
        type: qType,
        difficulty: diff,
        programmingLanguage: language,
        topic,
        options: finalOptions,
        correctAnswer: hasSourceAns ? rawAns : 'NOT PROVIDED',
        sourceAnswer: hasSourceAns ? rawAns : undefined,
        answerStatus: hasSourceAns ? ('provided' as const) : ('not_provided' as const),
        answerSource: hasSourceAns ? ansSource : ('none' as const),
        answerExplanation: explanation,
        verificationStatus: hasSourceAns ? ('source_verified' as const) : ('not_provided' as const),
        points: pointsForDifficulty(diff),
        approved: false, // Finalized by verifier & quality control below
        sourcePage: typeof item.sourcePage === 'number' ? item.sourcePage : defaultPage,
        sourceExcerpt:
          typeof item.sourceExcerpt === 'string' && item.sourceExcerpt.trim().length > 0
            ? item.sourceExcerpt.trim().slice(0, 380)
            : item.questionText.trim().slice(0, 240),
        sourceFileName,
      };
    });
}

function enrichDeterministicQuestions(questions: Question[]): Question[] {
  return questions.map(q => {
    const qType = normalizeQuestionType({
      rawType: q.type,
      questionText: q.questionText,
      codeSnippet: q.codeSnippet,
      options: q.options,
      rawAnswer: q.correctAnswer === 'NOT PROVIDED' ? '' : q.correctAnswer,
    });
    const lang = q.programmingLanguage || detectProgrammingLanguage(q.questionText, q.codeSnippet);
    const topic = q.topic || detectQuestionTopic(q.questionText, q.codeSnippet);
    return {
      ...q,
      type: qType,
      programmingLanguage: lang,
      topic,
    };
  });
}

function deduplicateQuestions(questions: Question[]): Question[] {
  const seen = new Set<string>();
  const unique: Question[] = [];
  for (const q of questions) {
    const key = `${q.questionText.trim().toLowerCase()}::${(q.codeSnippet || '').trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(q);
    }
  }
  return unique;
}

function buildSummaryAndWarnings(
  questions: Question[],
  usedGemini: boolean,
  cacheHit: boolean,
  extraWarnings: string[]
): { summary: AiAnalysisSummary; warnings: string[] } {
  const warnings = [...extraWarnings];
  const sourceVerified = questions.filter(q => q.verificationStatus === 'source_verified').length;
  const aiSuggested = questions.filter(
    q => !q.sourceAnswer && Boolean(q.aiSuggestedAnswer)
  ).length;
  const needsReview = questions.filter(
    q => q.verificationStatus === 'needs_teacher_review' || q.flaggedForReview
  ).length;
  const missingAnswers = questions.filter(
    q => !q.correctAnswer || q.correctAnswer.trim().toUpperCase() === 'NOT PROVIDED'
  ).length;
  const conflictingAnswers = questions.filter(q => q.verificationStatus === 'conflicting').length;
  const qualityWarningsCount = questions.reduce(
    (sum, q) => sum + (q.qualityIssues?.length || 0),
    0
  );

  if (conflictingAnswers > 0) {
    warnings.push(
      `${conflictingAnswers} question(s) have conflicting source vs verified answers and require teacher decision.`
    );
  }
  if (missingAnswers > 0) {
    warnings.push(
      `${missingAnswers} question(s) have "NOT PROVIDED" answers and cannot enter live rounds until reviewed or completed by teacher.`
    );
  }

  return {
    warnings,
    summary: {
      totalExtracted: questions.length,
      sourceVerified,
      aiSuggested,
      needsReview,
      missingAnswers,
      conflictingAnswers,
      qualityWarningsCount,
      usedGemini,
      cacheHit,
      modelUsed: usedGemini ? DEFAULT_GEMINI_MODEL : 'deterministic-engine',
    },
  };
}

async function runIntelligencePipeline(
  payload: AnalyzedDocumentPayload
): Promise<QuestionIntelligenceResult> {
  const extraWarnings: string[] = [];
  let usedGemini = false;
  let candidateQuestions: Question[] = [];

  if (payload.method === 'pdf_vision_ocr' && payload.scannedPdfBuffer) {
    const ocrRes = await extractScannedPdfWithGemini(
      payload.scannedPdfBuffer,
      payload.fileName || 'scanned.pdf'
    );
    usedGemini = true;
    const keyMap = new Map(payload.externalAnswerKey);
    for (const entry of ocrRes.answerKeyMap) {
      const digits = entry.questionNumber.replace(/\D+/g, '') || entry.questionNumber;
      keyMap.set(digits, { answer: entry.answer, explanation: entry.explanation });
    }
    candidateQuestions = normalizeRawAiItems(
      ocrRes.questions,
      payload.fileName,
      keyMap,
      1
    );
  } else {
    // Pass 1: Deterministic extraction per page / full document (zero hallucination, fast & exact)
    const deterministicPerPage: Question[] = [];
    for (const page of payload.pages) {
      const pageQs = extractQuestionsFromRawText(page.text, {
        sourceFileName: payload.fileName,
        sourcePage: page.pageNumber,
        externalAnswerKey: payload.externalAnswerKey,
      });
      deterministicPerPage.push(...pageQs);
    }

    // Also try combined document in case a question crosses a page break
    let deterministicCombined = deterministicPerPage;
    if (deterministicCombined.length === 0) {
      deterministicCombined = extractQuestionsFromRawText(payload.rawText, {
        sourceFileName: payload.fileName,
        sourcePage: 1,
        externalAnswerKey: payload.externalAnswerKey,
      });
    }

    // Pass 2: If Gemini is configured AND either deterministic found nothing OR doc uses non-standard layout,
    // use controlled chunk extraction with Gemini 4 Hydrogen
    if (isGeminiConfigured() && (deterministicCombined.length === 0 || payload.chunks.length > 0)) {
      // For documents where deterministic already parsed clean items, we preserve deterministic verbatim extraction
      // unless deterministic failed or extracted very little relative to document size
      const shouldUseGeminiExtractor =
        deterministicCombined.length === 0 ||
        (payload.rawText.length > 1500 && deterministicCombined.length <= 1);

      if (shouldUseGeminiExtractor) {
        const keyLines = Array.from(payload.externalAnswerKey.entries())
          .map(([num, entry]) => `Q${num}: ${entry.answer}${entry.explanation ? ` (${entry.explanation})` : ''}`)
          .join('\n');

        const aiExtractedAll: Question[] = [];
        const mergedKeyMap = new Map(payload.externalAnswerKey);

        for (const chunk of payload.chunks) {
          try {
            const chunkRes = await extractChunkWithGemini(chunk, keyLines || undefined);
            if (chunkRes) {
              usedGemini = true;
              for (const kEntry of chunkRes.answerKeyMap) {
                const digits = kEntry.questionNumber.replace(/\D+/g, '') || kEntry.questionNumber;
                if (!mergedKeyMap.has(digits)) {
                  mergedKeyMap.set(digits, {
                    answer: kEntry.answer,
                    explanation: kEntry.explanation,
                  });
                }
              }
              aiExtractedAll.push(
                ...normalizeRawAiItems(
                  chunkRes.questions,
                  payload.fileName,
                  mergedKeyMap,
                  chunk.startPage || 1
                )
              );
            }
          } catch (err) {
            console.warn('[QuestionIntelligence] Chunk extraction failed, keeping deterministic fallback:', err);
          }
        }

        if (aiExtractedAll.length > 0) {
          candidateQuestions = aiExtractedAll;
        }
      }
    }

    if (candidateQuestions.length === 0) {
      candidateQuestions = enrichDeterministicQuestions(deterministicCombined);
    }
  }

  // Deduplicate exact repeats across chunks/pages
  candidateQuestions = deduplicateQuestions(candidateQuestions);

  // Stage 2: Multi-stage Answer Verification (Source + Safe Sandbox + Gemini High Thinking)
  const verificationRes = await verifyExtractedQuestions(candidateQuestions, {
    runAiVerification: true,
  });
  if (verificationRes.usedGeminiVerification) {
    usedGemini = true;
  }

  // Stage 3: Deterministic Quality Control Validation & Final Approval Gating
  const { questionsWithIssues, summaryWarnings } = analyzeQuestionQuality(verificationRes.questions);
  extraWarnings.push(...summaryWarnings);

  const finalQuestions = questionsWithIssues.map(q => {
    const hasBlockingError = (q.qualityIssues || []).some(i => i.severity === 'error');
    const autoApproved =
      !hasBlockingError &&
      q.verificationStatus === 'source_verified' &&
      isQuestionReadyForGame({ ...q, approved: true });
    return {
      ...q,
      approved: autoApproved,
    };
  });

  const { warnings, summary } = buildSummaryAndWarnings(
    finalQuestions,
    usedGemini,
    false,
    extraWarnings
  );

  return {
    questions: finalQuestions,
    method: payload.method,
    pagesProcessed: payload.pagesProcessed,
    extractedTextPreview: payload.rawText.slice(0, 500),
    warnings,
    summary,
  };
}

export async function analyzePlainTextWithIntelligence(
  rawText: string,
  fileName?: string
): Promise<QuestionIntelligenceResult> {
  const hash = computeContentHash(`text:${fileName || ''}:${rawText}`);
  const cached = extractionCache.get(hash);
  if (cached) {
    return {
      ...cached,
      questions: cached.questions.map(q => ({
        ...q,
        id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      })),
      summary: { ...cached.summary, cacheHit: true },
    };
  }

  const payload = await preparePlainTextDocument(rawText, fileName);
  const result = await runIntelligencePipeline(payload);
  setCachedResult(hash, result);
  return result;
}

export async function analyzeDocxWithIntelligence(
  buffer: Buffer,
  fileName: string
): Promise<QuestionIntelligenceResult> {
  const hash = computeContentHash(Buffer.concat([Buffer.from(`docx:${fileName}:`), buffer]));
  const cached = extractionCache.get(hash);
  if (cached) {
    return {
      ...cached,
      questions: cached.questions.map(q => ({
        ...q,
        id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      })),
      summary: { ...cached.summary, cacheHit: true },
    };
  }

  const payload = await prepareDocxDocument(buffer, fileName);
  const result = await runIntelligencePipeline(payload);
  setCachedResult(hash, result);
  return result;
}

export async function analyzePdfWithIntelligence(
  buffer: Buffer,
  fileName: string
): Promise<QuestionIntelligenceResult> {
  const hash = computeContentHash(Buffer.concat([Buffer.from(`pdf:${fileName}:`), buffer]));
  const cached = extractionCache.get(hash);
  if (cached) {
    return {
      ...cached,
      questions: cached.questions.map(q => ({
        ...q,
        id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      })),
      summary: { ...cached.summary, cacheHit: true },
    };
  }

  const payload = await preparePdfDocument(buffer, fileName);
  const result = await runIntelligencePipeline(payload);
  setCachedResult(hash, result);
  return result;
}

export async function reprocessSingleQuestionWithIntelligence(
  question: Question
): Promise<Question> {
  const enriched = enrichDeterministicQuestions([
    {
      ...question,
      // Keep original sourceAnswer intact if present
      sourceAnswer:
        question.sourceAnswer ||
        (question.correctAnswer && question.correctAnswer.trim().toUpperCase() !== 'NOT PROVIDED'
          ? question.correctAnswer
          : undefined),
    },
  ]);
  const verified = await verifyExtractedQuestions(enriched, { runAiVerification: true });
  const { questionsWithIssues } = analyzeQuestionQuality(verified.questions);
  const updated = questionsWithIssues[0] || question;
  return updated;
}
