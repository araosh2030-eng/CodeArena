import { GoogleGenAI, Type } from '@google/genai';
import {
  AnswerSourceType,
  Difficulty,
  QuestionType,
  VerificationStatus,
} from '../../types/game';

export const DEFAULT_GEMINI_MODEL =
  process.env.CODEARENA_GEMINI_MODEL || 'gemini-4-hydrogen';

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim() && key !== 'MY_GEMINI_API_KEY');
}

export function getGenAIClient(): GoogleGenAI | null {
  if (!isGeminiConfigured()) return null;
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export const DOCUMENT_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionNumber: {
            type: Type.STRING,
            description: 'Original question number/label if present (e.g., "Q1", "12", "Problem 3").',
          },
          questionText: {
            type: Type.STRING,
            description:
              'Exact verbatim English question wording from the source document without rewriting, paraphrasing, or translating.',
          },
          codeSnippet: {
            type: Type.STRING,
            description:
              'Exact verbatim code block associated with this question preserving syntax and indentation. Empty string if none.',
          },
          type: {
            type: Type.STRING,
            description:
              'One of: multiple_choice, true_false, complete_code, code_completion, find_output, debugging, programming, short_answer, code_analysis',
          },
          difficulty: {
            type: Type.STRING,
            description: 'One of: easy, medium, hard, expert',
          },
          programmingLanguage: {
            type: Type.STRING,
            description: 'Detected programming language e.g. Python, JavaScript, C++, Java, SQL, or General.',
          },
          topic: {
            type: Type.STRING,
            description: 'Short CS/programming topic e.g. Loops, Recursion, OOP, Arrays, Strings, Algorithms.',
          },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Exact verbatim options for MCQ, ["True", "False"] for true_false, or [] if open-ended.',
          },
          sourceAnswer: {
            type: Type.STRING,
            description:
              'Exact answer explicitly provided by the document (inline, answer key, or worked solution; resolved from option letter if applicable). Strictly "NOT PROVIDED" if absent.',
          },
          answerSource: {
            type: Type.STRING,
            description: 'One of: inline, answer_key_section, worked_solution, none',
          },
          sourceExplanation: {
            type: Type.STRING,
            description: 'Verbatim or closely summarized explanation found in the document if provided.',
          },
          sourcePage: {
            type: Type.INTEGER,
            description: '1-based page number where this question appeared.',
          },
          sourceExcerpt: {
            type: Type.STRING,
            description: 'Short verbatim excerpt from the source document showing this question.',
          },
        },
        required: ['questionText', 'type', 'difficulty', 'sourceAnswer'],
      },
    },
    answerKeyMap: {
      type: Type.ARRAY,
      description: 'Standalone answer key entries found at the end or separate section of the document.',
      items: {
        type: Type.OBJECT,
        properties: {
          questionNumber: { type: Type.STRING },
          answer: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ['questionNumber', 'answer'],
      },
    },
  },
  required: ['questions'],
};

export const ANSWER_VERIFICATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verifications: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionId: { type: Type.STRING },
          aiSuggestedAnswer: {
            type: Type.STRING,
            description:
              'Verified technical answer determined by reasoning over the question/code. Empty string if ambiguous or unsolvable.',
          },
          acceptedAnswers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Alternative valid formatted answers / equivalent expressions if applicable.',
          },
          confidence: {
            type: Type.INTEGER,
            description: 'Confidence score from 0 to 100.',
          },
          matchesSourceAnswer: {
            type: Type.BOOLEAN,
            description:
              'True if sourceAnswer is present and agrees technically with aiSuggestedAnswer. False if sourceAnswer disagrees or is missing.',
          },
          conflictReason: {
            type: Type.STRING,
            description: 'If sourceAnswer disagrees with verified output/answer, explain why clearly.',
          },
          explanation: {
            type: Type.STRING,
            description: 'Concise technical explanation of the solution or why teacher review is needed.',
          },
        },
        required: ['questionId', 'aiSuggestedAnswer', 'confidence', 'matchesSourceAnswer', 'explanation'],
      },
    },
  },
  required: ['verifications'],
};

export interface RawExtractedQuestionItem {
  questionNumber?: string;
  questionText: string;
  codeSnippet?: string;
  type: QuestionType;
  difficulty: Difficulty;
  programmingLanguage?: string;
  topic?: string;
  options?: string[];
  sourceAnswer: string;
  answerSource?: AnswerSourceType;
  sourceExplanation?: string;
  sourcePage?: number;
  sourceExcerpt?: string;
}

export interface AnswerKeyEntry {
  questionNumber: string;
  answer: string;
  explanation?: string;
}

export interface VerificationItemResult {
  questionId: string;
  aiSuggestedAnswer: string;
  acceptedAnswers?: string[];
  confidence: number;
  matchesSourceAnswer: boolean;
  conflictReason?: string;
  explanation: string;
}

export interface AiAnalysisSummary {
  totalExtracted: number;
  sourceVerified: number;
  aiSuggested: number;
  needsReview: number;
  missingAnswers: number;
  conflictingAnswers: number;
  qualityWarningsCount: number;
  usedGemini: boolean;
  cacheHit: boolean;
  modelUsed: string;
}

export interface QuestionIntelligenceResult {
  questions: import('../../types/game').Question[];
  method: 'pdf_text' | 'pdf_vision_ocr' | 'docx' | 'plain_text';
  pagesProcessed?: number;
  extractedTextPreview?: string;
  warnings: string[];
  summary: AiAnalysisSummary;
}

export function isValidVerificationStatus(val: string): val is VerificationStatus {
  return [
    'source_verified',
    'ai_verified',
    'needs_teacher_review',
    'not_provided',
    'conflicting',
  ].includes(val);
}
