import { Question } from '../types/game';
import { AiAnalysisSummary, QuestionIntelligenceResult } from './ai/aiSchemas';
import {
  analyzeDocxWithIntelligence,
  analyzePdfWithIntelligence,
  analyzePlainTextWithIntelligence,
  reprocessSingleQuestionWithIntelligence,
} from './ai/questionIntelligence';

export type ExtractionResult = QuestionIntelligenceResult;
export type { AiAnalysisSummary };

export async function extractQuestionsFromPlainText(
  rawText: string,
  fileName?: string
): Promise<ExtractionResult> {
  return analyzePlainTextWithIntelligence(rawText, fileName);
}

export async function extractQuestionsFromDocxBuffer(
  buffer: Buffer,
  fileName: string
): Promise<ExtractionResult> {
  return analyzeDocxWithIntelligence(buffer, fileName);
}

export async function extractQuestionsFromPdfBuffer(
  buffer: Buffer,
  fileName: string
): Promise<ExtractionResult> {
  return analyzePdfWithIntelligence(buffer, fileName);
}

export async function reprocessQuestionWithAI(question: Question): Promise<Question> {
  return reprocessSingleQuestionWithIntelligence(question);
}
