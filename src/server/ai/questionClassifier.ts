import { Difficulty, QuestionType } from '../../types/game';

const LANGUAGE_PATTERNS: Array<{ lang: string; patterns: RegExp[] }> = [
  {
    lang: 'Python',
    patterns: [/\bpython\b/i, /\bdef\s+\w+\s*\(/, /\bprint\s*\(/, /\belif\b/, /\*\*|\/\//, /\blambda\s+\w+\s*:/, /\brange\s*\(/],
  },
  {
    lang: 'JavaScript',
    patterns: [/\bjavascript\b|\bjs\b|\bnode\.?js\b/i, /\bconsole\.log\s*\(/, /\b(const|let|var)\s+\w+\s*=/, /=>/, /\bfunction\s+\w+\s*\(/, /===/],
  },
  {
    lang: 'TypeScript',
    patterns: [/\btypescript\b|\bts\b/i, /\binterface\s+\w+/, /:\s*(string|number|boolean|void)\b/],
  },
  {
    lang: 'C++',
    patterns: [/\bc\+\+\b|\bcpp\b/i, /#include\s*<iostream>/, /\bstd::(cout|cin|vector|string)/, /\bcout\s*<</],
  },
  {
    lang: 'C',
    patterns: [/#include\s*<stdio\.h>/, /\bprintf\s*\(/, /\bscanf\s*\(/, /\bint\s+main\s*\(/],
  },
  {
    lang: 'Java',
    patterns: [/\bjava\b/i, /System\.out\.print(ln)?\s*\(/, /public\s+static\s+void\s+main/, /\bpublic\s+class\s+\w+/],
  },
  {
    lang: 'C#',
    patterns: [/\bc#\b|\bcsharp\b/i, /Console\.Write(Line)?\s*\(/, /\busing\s+System;/],
  },
  {
    lang: 'SQL',
    patterns: [/\bSELECT\b[\s\S]+\bFROM\b/i, /\bINSERT\s+INTO\b/i, /\bUPDATE\b[\s\S]+\bSET\b/i, /\bCREATE\s+TABLE\b/i],
  },
  {
    lang: 'HTML/CSS',
    patterns: [/<(div|span|html|body|script|style|form|input)\b/i, /\bdisplay\s*:\s*(flex|grid|block)/i],
  },
];

const TOPIC_PATTERNS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: 'Recursion', pattern: /\brecurs(ion|ive)\b|base\s*case/i },
  { topic: 'Loops & Iteration', pattern: /\b(for|while|do\s*while)\b|\bloop\b|\biterate\b|\brange\(/i },
  { topic: 'Arrays & Lists', pattern: /\b(array|list|vector|slice|append|push|pop|index)\b|\[\s*\d+/i },
  { topic: 'Functions & Scope', pattern: /\b(function|def\s+|return|parameter|argument|closure|scope|hoist)\b/i },
  { topic: 'Object-Oriented Programming', pattern: /\b(class|object|inherit|polymorphism|encapsulation|constructor|this\.|self\.)\b/i },
  { topic: 'Data Structures & Complexity', pattern: /\b(stack|queue|linked\s*list|tree|graph|hash|big[\s-]*o|O\([^)]+\)|binary\s*search|sort)\b/i },
  { topic: 'Strings & Text', pattern: /\b(string|substring|char|split|join|replace|regex|len\()\b/i },
  { topic: 'Databases & SQL', pattern: /\b(sql|select|join|primary\s*key|foreign\s*key|query|table)\b/i },
  { topic: 'Conditionals & Logic', pattern: /\b(if\s*\(|else|elif|switch|boolean|true|false|&&|\|\|)\b/i },
  { topic: 'Debugging & Errors', pattern: /\b(bug|error|exception|syntax\s*error|fix|debug|trace)\b/i },
];

export function detectProgrammingLanguage(text: string, codeSnippet?: string): string | undefined {
  const combined = `${text}\n${codeSnippet || ''}`;
  for (const entry of LANGUAGE_PATTERNS) {
    let score = 0;
    for (const pat of entry.patterns) {
      if (pat.test(combined)) score++;
    }
    if (score >= 1) {
      return entry.lang;
    }
  }
  return undefined;
}

export function detectQuestionTopic(text: string, codeSnippet?: string): string {
  const combined = `${text}\n${codeSnippet || ''}`;
  for (const entry of TOPIC_PATTERNS) {
    if (entry.pattern.test(combined)) {
      return entry.topic;
    }
  }
  return 'Programming Fundamentals';
}

export function normalizeQuestionType(params: {
  rawType?: string;
  questionText: string;
  codeSnippet?: string;
  options?: string[];
  rawAnswer?: string;
}): QuestionType {
  const { rawType, questionText, codeSnippet, options, rawAnswer } = params;
  const cleanOptions = (options || []).map(o => o.trim()).filter(Boolean);
  const lowerText = questionText.toLowerCase();

  // Check True/False explicitly
  const isTFOptions =
    cleanOptions.length === 2 &&
    cleanOptions.some(o => /^true$/i.test(o)) &&
    cleanOptions.some(o => /^false$/i.test(o));

  if (
    rawType === 'true_false' ||
    isTFOptions ||
    (/\(true\s*\/\s*false\)|\(t\s*\/\s*f\)|true\s+or\s+false/i.test(lowerText) && cleanOptions.length <= 2) ||
    (/^(true|false)$/i.test((rawAnswer || '').trim()) && cleanOptions.length === 0)
  ) {
    return 'true_false';
  }

  // If valid MCQ options exist (> 1 and not T/F)
  if (cleanOptions.length >= 2 && (rawType === 'multiple_choice' || !rawType || rawType === 'short_answer')) {
    return 'multiple_choice';
  }

  const validTypes: QuestionType[] = [
    'multiple_choice',
    'true_false',
    'code_completion',
    'complete_code',
    'find_output',
    'debugging',
    'programming',
    'short_answer',
    'code_analysis',
  ];

  if (rawType && validTypes.includes(rawType as QuestionType)) {
    // Allow MCQ even with options + code if MCQ options present
    if (cleanOptions.length >= 2) return 'multiple_choice';
    return rawType as QuestionType;
  }

  if (cleanOptions.length >= 2) return 'multiple_choice';

  if (/(what\s+(?:is|will\s+be)\s+the\s+output|what\s+(?:does|will|would)\s+.*?\b(?:output|print|return|log|display|evaluate\s+to)\b|predict\s+the\s+output|find\s+the\s+output|trace\s+the\s+output)/i.test(lowerText)) {
    return 'find_output';
  }

  if (/(fix\s+the\s+bug|find\s+the\s+(error|bug)|debug\s+(this|the)|why\s+does\s+this\s+fail|spot\s+the\s+error)/i.test(lowerText)) {
    return 'debugging';
  }

  if (/(complete\s+the\s+code|fill\s+in\s+the\s+blank|missing\s+(line|statement|code)|____+)/i.test(lowerText)) {
    return 'code_completion';
  }

  if (/(time\s+complexity|space\s+complexity|what\s+does\s+this\s+function\s+do|analyze\s+the\s+code)/i.test(lowerText)) {
    return 'code_analysis';
  }

  if (/(write\s+a\s+(program|function|method|script|query)|implement\s+)/i.test(lowerText)) {
    return 'programming';
  }

  if (codeSnippet) {
    return 'find_output';
  }

  return 'short_answer';
}

export function inferDifficulty(type: QuestionType, codeSnippet?: string, rawDiff?: string): Difficulty {
  const validDiffs: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
  if (rawDiff && validDiffs.includes(rawDiff as Difficulty)) {
    return rawDiff as Difficulty;
  }
  if (type === 'programming' || type === 'debugging') return 'hard';
  if (type === 'code_analysis' || type === 'complete_code' || type === 'code_completion' || (codeSnippet && codeSnippet.split('\n').length >= 4)) {
    return 'medium';
  }
  return 'easy';
}

export function pointsForDifficulty(diff: Difficulty): number {
  switch (diff) {
    case 'expert':
      return 200;
    case 'hard':
      return 150;
    case 'medium':
      return 120;
    default:
      return 100;
  }
}
