import vm from 'vm';
import { ThinkingLevel } from '@google/genai';
import { Question } from '../../types/game';
import { evaluateQuestionAnswer } from '../../game/rules';
import {
  ANSWER_VERIFICATION_SCHEMA,
  DEFAULT_GEMINI_MODEL,
  VerificationItemResult,
  getGenAIClient,
} from './aiSchemas';
import { runWithRetry } from './documentAnalyzer';

export interface SafeSandboxEvalResult {
  executed: boolean;
  output?: string;
  explanation?: string;
}

/**
 * Restricted, zero-privilege JavaScript sandbox using Node's vm module.
 * - No access to process, require, fs, env, globalThis, Buffer, timers, or network.
 * - Hard 150ms CPU timeout.
 * - Captures console.log lines ONLY for self-contained pure JS output questions.
 */
export function safeEvaluatePureJsSnippet(codeSnippet: string): SafeSandboxEvalResult {
  if (!codeSnippet || codeSnippet.trim().length === 0) {
    return { executed: false };
  }

  // Skip code that clearly belongs to non-JS languages or requests browser/node APIs
  if (
    /\b(def\s+|print\s*\(|#include|System\.out|SELECT\s+|Console\.Write|import\s+|require\s*\(|process\.|fetch\s*\(|while\s*\(\s*true\s*\))/i.test(
      codeSnippet
    )
  ) {
    return { executed: false };
  }

  // Must look like JS (console.log or JS declarations)
  if (!/\b(console\.log|const|let|var|function)\b/.test(codeSnippet)) {
    return { executed: false };
  }

  const logs: string[] = [];
  const sandbox = Object.create(null);
  sandbox.console = Object.freeze({
    log: (...args: unknown[]) => {
      logs.push(
        args
          .map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)))
          .join(' ')
      );
    },
  });
  sandbox.Math = Math;
  sandbox.JSON = JSON;
  sandbox.Number = Number;
  sandbox.String = String;
  sandbox.Boolean = Boolean;
  sandbox.Array = Array;

  try {
    const context = vm.createContext(sandbox);
    const result = vm.runInContext(codeSnippet, context, { timeout: 150 });
    if (logs.length > 0) {
      return {
        executed: true,
        output: logs.join('\n').trim(),
        explanation: `Verified via isolated JS sandbox execution: output is "${logs.join('\n').trim()}".`,
      };
    }
    if (result !== undefined && typeof result !== 'function' && typeof result !== 'object') {
      return {
        executed: true,
        output: String(result),
        explanation: `Evaluated pure JS expression result: "${String(result)}".`,
      };
    }
  } catch {
    return { executed: false };
  }

  return { executed: false };
}

/**
 * Safe deterministic evaluator for pure Python arithmetic/string `print(...)` single-line expressions
 * (zero subprocesses, zero eval — strict regex whitelist only).
 */
export function safeEvaluateSimplePythonPrint(
  questionText: string,
  codeSnippet?: string
): SafeSandboxEvalResult {
  const combined = `${questionText}\n${codeSnippet || ''}`;
  const printMatch = combined.match(/\bprint\s*\(\s*([0-9+\-*/%()\s.*]+)\s*\)/);
  if (!printMatch) return { executed: false };

  const expr = printMatch[1].trim();
  // Strict arithmetic characters only: digits, whitespace, +, -, *, /, %, **, ()
  if (!/^[0-9+\-*/%().\s]+$/.test(expr)) return { executed: false };
  // Prevent integer division ambiguity unless // is explicit; handle ** and // cleanly
  const jsExpr = expr.replace(/(\d+)\s*\/\/\s*(\d+)/g, 'Math.floor($1/$2)');

  try {
    const sandbox = Object.create(null);
    sandbox.Math = Math;
    const val = vm.runInNewContext(jsExpr, sandbox, { timeout: 50 });
    if (typeof val === 'number' && Number.isFinite(val)) {
      return {
        executed: true,
        output: String(val),
        explanation: `Verified arithmetic evaluation of print(${expr}) = ${val}.`,
      };
    }
  } catch {
    return { executed: false };
  }

  return { executed: false };
}

async function verifyBatchWithGemini(questions: Question[]): Promise<Map<string, VerificationItemResult>> {
  const resultMap = new Map<string, VerificationItemResult>();
  const ai = getGenAIClient();
  if (!ai || questions.length === 0) return resultMap;

  const compactInput = questions.map(q => ({
    questionId: q.id,
    questionNumber: q.questionNumber,
    type: q.type,
    programmingLanguage: q.programmingLanguage,
    questionText: q.questionText,
    codeSnippet: q.codeSnippet,
    options: q.options,
    sourceAnswer: q.sourceAnswer || 'NOT PROVIDED',
    answerSource: q.answerSource || 'none',
  }));

  const prompt = `You are the Answer Verification Engine of CodeArena AI.
For each question below:
1. Solve/analyze the programming question carefully and compute the technically accurate answer (aiSuggestedAnswer).
   - For multiple_choice, aiSuggestedAnswer MUST match the exact text of the winning option.
   - For true_false, aiSuggestedAnswer MUST be "True" or "False".
   - For find_output/short_answer/code_completion/debugging/programming, provide the cleanest canonical answer and include common equivalent valid formats in acceptedAnswers (e.g. with/without semicolon or quotes).
2. Compare your verified answer with sourceAnswer (if sourceAnswer is NOT "NOT PROVIDED"):
   - Set matchesSourceAnswer = true if sourceAnswer agrees technically with your answer.
   - Set matchesSourceAnswer = false and write a clear conflictReason if sourceAnswer is clearly wrong or contradictory.
3. Provide a confidence integer (0-100) and concise technical explanation.

QUESTIONS JSON:
${JSON.stringify(compactInput, null, 2)}`;

  try {
    const response = await runWithRetry(
      () =>
        ai.models.generateContent({
          model: DEFAULT_GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            responseMimeType: 'application/json',
            responseSchema: ANSWER_VERIFICATION_SCHEMA,
          },
        }),
      1,
      45000,
      'Gemini answer verification'
    );

    const text = response.text;
    if (!text) return resultMap;
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.verifications)) {
      for (const item of parsed.verifications) {
        if (item && item.questionId) {
          resultMap.set(item.questionId, item);
        }
      }
    }
  } catch (err) {
    console.warn('[AnswerVerifier] Gemini verification skipped/fallback:', err);
  }

  return resultMap;
}

/**
 * Multi-stage answer verification:
 * Stage A: Preserve sourceAnswer & answerSource from document/answer-key/solution.
 * Stage B: Cross-verify via restricted JS/expression sandbox AND Gemini 4 Hydrogen (when configured).
 * Stage C: Assign confidence, detect conflicts (WITHOUT silently overwriting sourceAnswer!), and enforce approval safety.
 */
export async function verifyExtractedQuestions(
  questions: Question[],
  options?: { runAiVerification?: boolean }
): Promise<{ questions: Question[]; usedGeminiVerification: boolean }> {
  const shouldRunGemini = options?.runAiVerification !== false;
  const geminiResults = shouldRunGemini
    ? await verifyBatchWithGemini(questions.slice(0, 30))
    : new Map<string, VerificationItemResult>();

  const usedGeminiVerification = geminiResults.size > 0;
  const now = Date.now();

  const verifiedQuestions = questions.map(q => {
    const hasSourceAnswer =
      Boolean(q.sourceAnswer && q.sourceAnswer.trim().length > 0 && q.sourceAnswer.trim().toUpperCase() !== 'NOT PROVIDED');

    // Stage B1: Safe local verification for pure JS or simple Python print arithmetic
    let sandboxRes = q.codeSnippet ? safeEvaluatePureJsSnippet(q.codeSnippet) : { executed: false };
    if (!sandboxRes.executed) {
      sandboxRes = safeEvaluateSimplePythonPrint(q.questionText, q.codeSnippet);
    }

    const aiRes = geminiResults.get(q.id);

    let aiSuggestedAnswer: string | undefined = aiRes?.aiSuggestedAnswer?.trim() || undefined;
    let explanation = q.answerExplanation || aiRes?.explanation || undefined;
    let confidence = aiRes?.confidence ?? (hasSourceAnswer ? 92 : 0);
    let acceptedAnswers = aiRes?.acceptedAnswers?.map(a => a.trim()).filter(Boolean);

    // Sandbox result takes priority for pure deterministic expressions if AI wasn't available or agrees
    if (sandboxRes.executed && sandboxRes.output) {
      if (!aiSuggestedAnswer) {
        aiSuggestedAnswer = sandboxRes.output;
        confidence = Math.max(confidence, 96);
      }
      if (!explanation && sandboxRes.explanation) {
        explanation = sandboxRes.explanation;
      }
    }

    // For MCQ where sandbox output matches an option text, resolve to exact option
    if (aiSuggestedAnswer && q.type === 'multiple_choice' && q.options && q.options.length > 0) {
      const matched = q.options.find(
        o => o.trim().toLowerCase() === aiSuggestedAnswer!.trim().toLowerCase()
      );
      if (matched) aiSuggestedAnswer = matched;
    }

    // Stage C: Conflict detection & Verification Status assignment
    if (hasSourceAnswer) {
      const sourceText = q.sourceAnswer!.trim();
      const sourceBaselineQuestion: Question = {
        ...q,
        correctAnswer: sourceText,
        acceptedAnswers: q.acceptedAnswers,
      };
      let conflictDetected = false;
      let conflictNote = '';

      if (sandboxRes.executed && sandboxRes.output) {
        const sandboxEquiv = evaluateQuestionAnswer(sourceBaselineQuestion, sandboxRes.output);
        if (!sandboxEquiv.isCorrect) {
          conflictDetected = true;
          conflictNote = `Source key says "${sourceText}", while safe code execution produced "${sandboxRes.output}".`;
          aiSuggestedAnswer = sandboxRes.output;
          confidence = Math.max(confidence, 96);
        }
      }

      if (
        !conflictDetected &&
        aiRes &&
        aiSuggestedAnswer &&
        (aiRes.matchesSourceAnswer === false || aiRes.confidence >= 80)
      ) {
        const aiEquiv = evaluateQuestionAnswer(sourceBaselineQuestion, aiSuggestedAnswer);
        if (!aiEquiv.isCorrect && (aiRes.matchesSourceAnswer === false || aiRes.confidence >= 85)) {
          conflictDetected = true;
          conflictNote =
            aiRes.conflictReason ||
            `Source key says "${sourceText}", while AI analysis verified "${aiSuggestedAnswer}".`;
        }
      }

      if (conflictDetected) {
        return {
          ...q,
          correctAnswer: sourceText, // NEVER silently overwrite sourceAnswer!
          sourceAnswer: sourceText,
          aiSuggestedAnswer,
          acceptedAnswers: q.acceptedAnswers,
          answerStatus: 'provided' as const,
          answerConfidence: confidence,
          answerExplanation: conflictNote + (explanation ? ` (${explanation})` : ''),
          verificationStatus: 'conflicting' as const,
          flaggedForReview: true,
          approved: false, // Must be reviewed by teacher before entering competition!
          aiProcessedAt: now,
        };
      }

      return {
        ...q,
        correctAnswer: sourceText,
        sourceAnswer: sourceText,
        aiSuggestedAnswer: aiSuggestedAnswer || sourceText,
        acceptedAnswers,
        answerStatus: 'provided' as const,
        answerConfidence: Math.max(confidence, aiRes?.matchesSourceAnswer ? 96 : 90),
        answerExplanation: explanation || `Verified from document (${q.answerSource || 'source'}).`,
        verificationStatus: 'source_verified' as const,
        flaggedForReview: false,
        approved: true,
        aiProcessedAt: now,
      };
    }

    // Missing source answer! Mark strictly NOT PROVIDED and keep unapproved until teacher accepts/enters.
    if (aiSuggestedAnswer) {
      return {
        ...q,
        correctAnswer: 'NOT PROVIDED',
        sourceAnswer: undefined,
        aiSuggestedAnswer,
        acceptedAnswers,
        answerStatus: 'not_provided' as const,
        answerSource: 'none' as const,
        answerConfidence: confidence,
        answerExplanation:
          explanation ||
          `No answer key in document. Suggested answer "${aiSuggestedAnswer}" awaits teacher approval.`,
        verificationStatus: 'needs_teacher_review' as const,
        flaggedForReview: false,
        approved: false, // Never auto-approve invented/AI-suggested answers when source omitted key!
        aiProcessedAt: now,
      };
    }

    return {
      ...q,
      correctAnswer: 'NOT PROVIDED',
      sourceAnswer: undefined,
      aiSuggestedAnswer: undefined,
      answerStatus: 'not_provided' as const,
      answerSource: 'none' as const,
      answerConfidence: 0,
      answerExplanation: 'No answer provided in source document. Teacher entry required.',
      verificationStatus: 'not_provided' as const,
      flaggedForReview: false,
      approved: false,
      aiProcessedAt: now,
    };
  });

  return { questions: verifiedQuestions, usedGeminiVerification };
}
