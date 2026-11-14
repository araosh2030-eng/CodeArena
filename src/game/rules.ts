import {
  CardInstance,
  CardType,
  ComebackBonusState,
  Difficulty,
  FinalMatchSummary,
  GameSettings,
  GameState,
  PlayerSwapRecord,
  QualityIssue,
  Question,
  QuestionEffectType,
  QuestionType,
  RoundType,
  ScheduledRound,
  Student,
  Team,
  TeamMember,
  TeamRankingEntry,
  TeamRivalryEvent
} from '../types/game';
import { CARD_DEFINITIONS, DEFAULT_SETTINGS } from './defaultData';

export const DEFAULT_TOTAL_ROUNDS = 50;
export const MIN_TOTAL_ROUNDS = 1;
export const MAX_TOTAL_ROUNDS = 70;

export function validateTotalRounds(totalRounds: unknown): {
  valid: boolean;
  rounds: number;
  error?: string;
} {
  const num = typeof totalRounds === 'number' ? totalRounds : Number(totalRounds);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { valid: false, rounds: DEFAULT_TOTAL_ROUNDS, error: 'Total rounds must be a whole number.' };
  }
  if (num < MIN_TOTAL_ROUNDS || num > MAX_TOTAL_ROUNDS) {
    return {
      valid: false,
      rounds: DEFAULT_TOTAL_ROUNDS,
      error: `Total rounds must be between ${MIN_TOTAL_ROUNDS} and ${MAX_TOTAL_ROUNDS}.`,
    };
  }
  return { valid: true, rounds: num };
}

export function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const DEFAULT_TEAM_CONFIGS = [
  { id: 'team1', name: 'Team 1', color: '#3b82f6' },
  { id: 'team2', name: 'Team 2', color: '#ef4444' },
  { id: 'team3', name: 'Team 3', color: '#10b981' },
  { id: 'team4', name: 'Team 4', color: '#f59e0b' },
];

export function assignRandomQuestionEffect(
  bonusChancePercent = DEFAULT_SETTINGS.questionBonusChancePercent,
  minusChancePercent = DEFAULT_SETTINGS.questionMinusChancePercent
): QuestionEffectType {
  const bonusPct = Math.max(0, Math.min(100, bonusChancePercent));
  const minusPct = Math.max(0, Math.min(100 - bonusPct, minusChancePercent));
  const roll = Math.random() * 100;
  if (roll < bonusPct) return 'bonus';
  if (roll < bonusPct + minusPct) return 'minus';
  return 'normal';
}

export function computeQuestionEffectOutcome(params: {
  effectType?: QuestionEffectType;
  bonusPoints: number;
  minusPoints: number;
  isCorrect: boolean;
  currentScore: number;
}): {
  effectType: QuestionEffectType;
  scoreDelta: number;
  newScore: number;
} {
  const effectType: QuestionEffectType = params.effectType || 'normal';
  if (effectType === 'bonus' && params.isCorrect) {
    const delta = Math.max(0, Math.round(params.bonusPoints || 0));
    return {
      effectType,
      scoreDelta: delta,
      newScore: params.currentScore + delta,
    };
  }
  if (effectType === 'minus' && !params.isCorrect) {
    const penalty = Math.max(0, Math.round(params.minusPoints || 0));
    const newScore = Math.max(0, params.currentScore - penalty);
    return {
      effectType,
      scoreDelta: newScore - params.currentScore,
      newScore,
    };
  }
  return {
    effectType,
    scoreDelta: 0,
    newScore: params.currentScore,
  };
}

/**
 * Determines whether a question is strictly ready to enter live gameplay.
 * Blocks unapproved questions, missing answers, flagged questions, and unresolved conflicts.
 */
export function isQuestionReadyForGame(q: Question): boolean {
  if (!q || !q.approved) return false;
  if (q.flaggedForReview) return false;
  if (!q.correctAnswer || q.correctAnswer.trim().length === 0) return false;
  if (q.correctAnswer.trim().toUpperCase() === 'NOT PROVIDED') return false;
  if (q.answerStatus === 'not_provided') return false;
  if (
    q.verificationStatus === 'not_provided' ||
    q.verificationStatus === 'needs_teacher_review' ||
    q.verificationStatus === 'conflicting'
  ) {
    return false;
  }
  return true;
}

export function generateAutomaticRoundSchedule(
  totalRounds: number,
  questions: Question[],
  options?: {
    teamIds?: string[];
    bonusChancePercent?: number;
    minusChancePercent?: number;
  }
): { schedule: ScheduledRound[]; warnings: string[] } {
  const warnings: string[] = [];
  const schedule: ScheduledRound[] = [];

  const roundCheck = validateTotalRounds(totalRounds);
  if (!roundCheck.valid) {
    warnings.push(roundCheck.error || `Total rounds cannot exceed ${MAX_TOTAL_ROUNDS}.`);
    return { schedule, warnings };
  }

  const approvedQuestions = questions.filter(isQuestionReadyForGame);

  if (approvedQuestions.length === 0) {
    warnings.push('Question Bank has no approved, verified questions with valid answers.');
    return { schedule, warnings };
  }

  const totalQuestionSlotsNeeded = totalRounds + 15; // extra slots for 4 questions per private round
  if (approvedQuestions.length < totalQuestionSlotsNeeded) {
    warnings.push(
      `Question count (${approvedQuestions.length}) is less than total slots needed (${totalQuestionSlotsNeeded}). Some questions may repeat across distant rounds.`
    );
  }

  const teamIds =
    options?.teamIds && options.teamIds.length === 4
      ? [...options.teamIds]
      : ['team1', 'team2', 'team3', 'team4'];
  const bonusChance = options?.bonusChancePercent ?? DEFAULT_SETTINGS.questionBonusChancePercent;
  const minusChance = options?.minusChancePercent ?? DEFAULT_SETTINGS.questionMinusChancePercent;

  const privateCount = Math.min(5, totalRounds);
  const minPrivateStart = totalRounds >= 15 ? 6 : 1;
  const maxPrivateStart = Math.max(minPrivateStart, totalRounds - privateCount + 1);
  const privateStartRound =
    Math.floor(Math.random() * (maxPrivateStart - minPrivateStart + 1)) + minPrivateStart;
  const privateEndRound = privateStartRound + privateCount - 1;

  const collaborativeRounds = new Set<number>();
  const num20Blocks = Math.ceil(totalRounds / 20);
  for (let block = 0; block < num20Blocks; block++) {
    const startR = block * 20 + 1;
    const endR = Math.min((block + 1) * 20, totalRounds);
    const nonPrivateCandidates: number[] = [];
    for (let cand = startR; cand <= endR; cand++) {
      if (cand < privateStartRound || cand > privateEndRound) {
        nonPrivateCandidates.push(cand);
      }
    }
    if (nonPrivateCandidates.length > 0) {
      const picked =
        nonPrivateCandidates[Math.floor(Math.random() * nonPrivateCandidates.length)];
      collaborativeRounds.add(picked);
    }
  }

  const standardRoundTypes: RoundType[] = ['group_speed', 'individual_teams', 'hidden_cards'];
  let shuffledQuestions = shuffleArray(approvedQuestions);
  let qIndex = 0;

  const drawNextQuestion = (excludeIds?: Set<string>): Question => {
    // Try to find an unused question in the current deck not in excludeIds
    for (let attempts = 0; attempts < approvedQuestions.length; attempts++) {
      if (qIndex >= shuffledQuestions.length) {
        shuffledQuestions = shuffleArray(approvedQuestions);
        qIndex = 0;
      }
      const candidate = shuffledQuestions[qIndex++];
      if (!excludeIds || !excludeIds.has(candidate.id) || approvedQuestions.length <= excludeIds.size) {
        return candidate;
      }
    }
    return approvedQuestions[0];
  };

  for (let r = 1; r <= totalRounds; r++) {
    let rType: RoundType;
    let isPrivate = false;
    let privateIdx: number | undefined = undefined;
    let isCollab = false;

    if (r >= privateStartRound && r <= privateEndRound) {
      rType = 'private_round';
      isPrivate = true;
      privateIdx = r - privateStartRound + 1;
    } else if (collaborativeRounds.has(r)) {
      rType = 'collaborative_coding';
      isCollab = true;
    } else {
      rType = standardRoundTypes[Math.floor(Math.random() * standardRoundTypes.length)];
    }

    if (isPrivate) {
      const usedInPrivateRound = new Set<string>();
      const privateQuestionsByTeam: Record<string, { questionId: string; effect: QuestionEffectType }> = {};
      const privateTeamOrder = shuffleArray(teamIds);

      for (const tid of privateTeamOrder) {
        const q = drawNextQuestion(usedInPrivateRound);
        usedInPrivateRound.add(q.id);
        privateQuestionsByTeam[tid] = {
          questionId: q.id,
          effect: assignRandomQuestionEffect(bonusChance, minusChance),
        };
      }

      const firstTeamId = privateTeamOrder[0];
      const firstEntry = privateQuestionsByTeam[firstTeamId];

      schedule.push({
        roundNumber: r,
        roundType: rType,
        questionId: firstEntry.questionId,
        questionEffect: firstEntry.effect,
        isPrivateGroupRound: true,
        privateRoundIndex: privateIdx,
        privateQuestionsByTeam,
        privateTeamOrder,
        isCollaborative: false,
      });
    } else {
      const question = drawNextQuestion();
      schedule.push({
        roundNumber: r,
        roundType: rType,
        questionId: question.id,
        questionEffect: assignRandomQuestionEffect(bonusChance, minusChance),
        isPrivateGroupRound: false,
        isCollaborative: isCollab,
      });
    }
  }

  return { schedule, warnings };
}

/**
 * Type-aware deterministic answer evaluator for live competition rounds.
 * Zero AI calls during active rounds: compares against verified answer & acceptedAnswers.
 */
export function normalizeCodeTokens(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/;+\s*$/g, '')
    .replace(/\s*([=+\-*/%<>!&|(),:{}[\]])\s*/g, '$1')
    .replace(/\s+/g, ' ');
}

export function normalizeOutputText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trimEnd())
    .join('\n')
    .trim();
}

export function evaluateQuestionAnswer(
  question: Question,
  submittedAnswer: string
): { isCorrect: boolean; matchMethod: string } {
  const rawSub = (submittedAnswer || '').trim();
  const rawExpected = (question.correctAnswer || '').trim();

  if (!rawSub || !rawExpected || rawExpected.toUpperCase() === 'NOT PROVIDED') {
    return { isCorrect: false, matchMethod: 'empty_or_missing' };
  }

  const candidates = [
    rawExpected,
    ...(Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : []),
  ]
    .map(c => c.trim())
    .filter(Boolean);

  // 1. Direct case-insensitive trimmed match against primary or accepted answers
  for (const cand of candidates) {
    if (rawSub.toLowerCase() === cand.toLowerCase()) {
      return { isCorrect: true, matchMethod: 'exact_match' };
    }
  }

  // 2. True/False boolean normalization
  if (question.type === 'true_false') {
    const normalizeBool = (v: string): 'true' | 'false' | null => {
      const lower = v.toLowerCase();
      if (['true', 't', 'yes', '1'].includes(lower)) return 'true';
      if (['false', 'f', 'no', '0'].includes(lower)) return 'false';
      return null;
    };
    const subBool = normalizeBool(rawSub);
    const expBool = normalizeBool(rawExpected);
    if (subBool && expBool && subBool === expBool) {
      return { isCorrect: true, matchMethod: 'boolean_normalized' };
    }
    return { isCorrect: false, matchMethod: 'boolean_mismatch' };
  }

  // 3. Multiple Choice letter/prefix normalization (handles option text, "B", or "B) text")
  if (question.type === 'multiple_choice' && question.options && question.options.length > 0) {
    const letterIndexMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
    const resolveMcqText = (val: string): string => {
      const trimmed = val.trim();
      if (/^[A-E]$/i.test(trimmed)) {
        const idx = letterIndexMap[trimmed.toUpperCase()];
        if (idx !== undefined && question.options![idx]) {
          return question.options![idx].trim().toLowerCase();
        }
      }
      const prefixMatch = trimmed.match(/^([A-E])\s*[.):]\s*(.+)$/i);
      if (prefixMatch) {
        return prefixMatch[2].trim().toLowerCase();
      }
      return trimmed.toLowerCase();
    };

    const resolvedSub = resolveMcqText(rawSub);
    for (const cand of candidates) {
      if (resolvedSub === resolveMcqText(cand)) {
        return { isCorrect: true, matchMethod: 'mcq_option_match' };
      }
    }
    return { isCorrect: false, matchMethod: 'mcq_mismatch' };
  }

  // 4. Find Output / Short Answer multi-line normalization
  if (question.type === 'find_output' || question.type === 'short_answer' || question.type === 'code_analysis') {
    const normSub = normalizeOutputText(rawSub).toLowerCase();
    for (const cand of candidates) {
      if (normSub === normalizeOutputText(cand).toLowerCase()) {
        return { isCorrect: true, matchMethod: 'normalized_output_match' };
      }
    }
  }

  // 5. Code Completion / Debugging / Programming normalized token comparison
  const isCodeType =
    question.type === 'code_completion' ||
    question.type === 'complete_code' ||
    question.type === 'debugging' ||
    question.type === 'programming';

  if (isCodeType) {
    const normSub = normalizeCodeTokens(rawSub);
    for (const cand of candidates) {
      if (normSub === normalizeCodeTokens(cand)) {
        return { isCorrect: true, matchMethod: 'normalized_code_tokens' };
      }
    }
  }

  return { isCorrect: false, matchMethod: 'mismatch' };
}

/**
 * Deterministic Question Bank Quality Control Validator.
 * Detects structural errors, duplicate stems, unmatched option keys, unbalanced code, and conflicts.
 */
export function analyzeQuestionQuality(questions: Question[]): {
  questionsWithIssues: Question[];
  summaryWarnings: string[];
} {
  const seenPrompts = new Map<string, number>();
  const summarySet = new Set<string>();

  // Pass 1: count duplicates
  for (const q of questions) {
    const key = `${q.questionText.trim().toLowerCase()}::${(q.codeSnippet || '').trim().toLowerCase()}`;
    seenPrompts.set(key, (seenPrompts.get(key) || 0) + 1);
  }

  const questionsWithIssues = questions.map(q => {
    const issues: QualityIssue[] = [];
    const trimmedText = (q.questionText || '').trim();
    const upperAns = (q.correctAnswer || '').trim().toUpperCase();
    const isMissingAns = !q.correctAnswer || upperAns === 'NOT PROVIDED';

    if (!trimmedText || trimmedText.length < 5) {
      issues.push({
        code: 'MISSING_QUESTION_TEXT',
        severity: 'error',
        message: 'Question wording is empty or too short.',
      });
    }

    const dupKey = `${trimmedText.toLowerCase()}::${(q.codeSnippet || '').trim().toLowerCase()}`;
    if ((seenPrompts.get(dupKey) || 0) > 1) {
      issues.push({
        code: 'DUPLICATE_QUESTION',
        severity: 'warning',
        message: 'Duplicate question detected in this batch.',
      });
    }

    if (q.type === 'multiple_choice') {
      const opts = (q.options || []).map(o => o.trim()).filter(Boolean);
      if (opts.length < 2) {
        issues.push({
          code: 'MISSING_MCQ_OPTIONS',
          severity: 'error',
          message: 'Multiple choice question has fewer than 2 valid options.',
        });
      } else if (!isMissingAns) {
        const matchesOption = opts.some(
          o => o.toLowerCase() === q.correctAnswer.trim().toLowerCase()
        );
        if (!matchesOption) {
          issues.push({
            code: 'INVALID_OPTION_REF',
            severity: 'error',
            message: `Answer "${q.correctAnswer}" does not match any listed option.`,
          });
        }
      }
    }

    if (q.type === 'true_false' && !isMissingAns) {
      if (!/^(true|false)$/i.test(q.correctAnswer.trim())) {
        issues.push({
          code: 'MALFORMED_TRUE_FALSE',
          severity: 'error',
          message: `True/False answer "${q.correctAnswer}" must be "True" or "False".`,
        });
      }
    }

    if (q.codeSnippet) {
      const openCurly = (q.codeSnippet.match(/\{/g) || []).length;
      const closeCurly = (q.codeSnippet.match(/\}/g) || []).length;
      const openParen = (q.codeSnippet.match(/\(/g) || []).length;
      const closeParen = (q.codeSnippet.match(/\)/g) || []).length;
      if (q.codeSnippet.includes('```') || Math.abs(openCurly - closeCurly) > 1 || Math.abs(openParen - closeParen) > 1) {
        issues.push({
          code: 'INCOMPLETE_CODE_BLOCK',
          severity: 'warning',
          message: 'Code snippet may have unbalanced brackets/parentheses or unclosed markdown fences.',
        });
      }
    }

    if (
      (q.type === 'find_output' ||
        q.type === 'code_completion' ||
        q.type === 'complete_code' ||
        q.type === 'debugging' ||
        q.type === 'programming') &&
      !q.programmingLanguage
    ) {
      issues.push({
        code: 'MISSING_LANGUAGE',
        severity: 'warning',
        message: 'Programming language was not automatically identified.',
      });
    }

    if (q.verificationStatus === 'conflicting') {
      issues.push({
        code: 'CONFLICTING_ANSWER',
        severity: 'error',
        message: 'Source document answer conflicts with AI/sandbox technical verification.',
      });
    } else if (isMissingAns) {
      issues.push({
        code: 'MISSING_ANSWER',
        severity: 'warning',
        message: 'Answer not provided in source document. Teacher review required.',
      });
    }

    for (const iss of issues) {
      if (iss.severity === 'error') {
        summarySet.add(iss.message);
      }
    }

    return {
      ...q,
      qualityIssues: issues,
    };
  });

  return {
    questionsWithIssues,
    summaryWarnings: Array.from(summarySet),
  };
}

export function createTeamsFromStudents(
  students: Student[],
  preselectedLeaderIds?: string[]
): Record<string, Team> {
  if (students.length !== 22) {
    throw new Error(`Expected exactly 22 students, got ${students.length}`);
  }

  let leaderIds: string[] = [];
  if (preselectedLeaderIds && preselectedLeaderIds.length === 4) {
    leaderIds = [...preselectedLeaderIds];
  } else {
    const shuffledStudents = shuffleArray(students);
    leaderIds = shuffledStudents.slice(0, 4).map(s => s.id);
  }

  const remainingStudents = shuffleArray(students.filter(s => !leaderIds.includes(s.id)));
  const sizes = shuffleArray([6, 6, 5, 5]);

  const teams: Record<string, Team> = {};
  let poolIndex = 0;

  DEFAULT_TEAM_CONFIGS.forEach((config, index) => {
    const leaderStudent = students.find(s => s.id === leaderIds[index])!;
    const targetSize = sizes[index];
    const nonLeaderCountNeeded = targetSize - 1;

    const assignedNonLeaders = remainingStudents.slice(poolIndex, poolIndex + nonLeaderCountNeeded);
    poolIndex += nonLeaderCountNeeded;

    const members: TeamMember[] = [
      {
        studentId: leaderStudent.id,
        name: leaderStudent.name,
        nickname: leaderStudent.nickname,
        isLeader: true,
        isLocked: false,
        participatedInPrivateRound: false,
      },
      ...assignedNonLeaders.map(s => ({
        studentId: s.id,
        name: s.name,
        nickname: s.nickname,
        isLeader: false,
        isLocked: false,
        participatedInPrivateRound: false,
      })),
    ];

    teams[config.id] = {
      id: config.id,
      name: config.name,
      color: config.color,
      leaderStudentId: leaderStudent.id,
      leaderName: leaderStudent.nickname
        ? `${leaderStudent.name} (${leaderStudent.nickname})`
        : leaderStudent.name,
      members,
      score: 0,
      streak: 0,
      highestStreak: 0,
      pointsAccumulatedForCards: 0,
      cardsClaimedCount: 0,
      secretCards: [],
      playerLockUsesCount: 0,
      activeSession: null,
    };
  });

  return teams;
}

export function validateTeamRosters(teams: Record<string, Team>): { isValid: boolean; error?: string } {
  const allStudentIds: string[] = [];
  const teamSizes = Object.values(teams).map(t => t.members.length);

  for (const team of Object.values(teams)) {
    for (const member of team.members) {
      if (allStudentIds.includes(member.studentId)) {
        return { isValid: false, error: `Student ${member.studentId} is in multiple teams` };
      }
      allStudentIds.push(member.studentId);
    }
  }

  if (allStudentIds.length !== 22) {
    return { isValid: false, error: `Expected 22 total students, got ${allStudentIds.length}` };
  }

  const sortedSizes = [...teamSizes].sort();
  if (sortedSizes[0] !== 5 || sortedSizes[1] !== 5 || sortedSizes[2] !== 6 || sortedSizes[3] !== 6) {
    return { isValid: false, error: `Team sizes must be [5, 5, 6, 6], got ${sortedSizes.join(', ')}` };
  }

  return { isValid: true };
}

export function selectPrivateRoundPlayersWithReport(
  teams: Record<string, Team>,
  participatedInBatch: Record<string, string[]>
): {
  selected: Record<string, { studentId: string; name: string }>;
  warnings: string[];
} {
  const selected: Record<string, { studentId: string; name: string }> = {};
  const warnings: string[] = [];

  for (const [teamId, team] of Object.entries(teams)) {
    const alreadyParticipated = participatedInBatch[teamId] || [];
    // Leaders ARE eligible alongside all other team members
    const eligibleMembers = team.members.filter(m => !alreadyParticipated.includes(m.studentId));

    if (eligibleMembers.length === 0) {
      warnings.push(
        `${team.name} has no remaining un-participated players in this Private Round sequence.`
      );
      if (team.members.length > 0) {
        const fallback = team.members[Math.floor(Math.random() * team.members.length)];
        selected[teamId] = { studentId: fallback.studentId, name: fallback.name };
      }
    } else {
      const chosen = eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)];
      selected[teamId] = { studentId: chosen.studentId, name: chosen.name };
    }
  }

  return { selected, warnings };
}

export function selectPrivateRoundPlayers(
  teams: Record<string, Team>,
  participatedInBatch: Record<string, string[]>
): Record<string, { studentId: string; name: string }> {
  return selectPrivateRoundPlayersWithReport(teams, participatedInBatch).selected;
}

export function calculateAnswerScore(
  question: Question,
  isCorrect: boolean,
  speedRank: number | undefined,
  currentStreak: number,
  settings: GameSettings = DEFAULT_SETTINGS,
  roundType: RoundType = 'group_speed',
  options?: { doublePointsApplied?: boolean }
): {
  pointsAwarded: number;
  basePoints: number;
  doubledBaseBonus: number;
  doublePointsApplied: boolean;
  speedBonus: number;
  streakBonus: number;
  newStreak: number;
} {
  if (!isCorrect) {
    return {
      pointsAwarded: 0,
      basePoints: 0,
      doubledBaseBonus: 0,
      doublePointsApplied: !!options?.doublePointsApplied,
      speedBonus: 0,
      streakBonus: 0,
      newStreak: 0,
    };
  }

  const basePoints = question.points || 100;
  const doublePointsApplied = !!options?.doublePointsApplied;
  const doubledBaseBonus = doublePointsApplied ? basePoints : 0;
  let speedBonus = 0;

  if (roundType === 'group_speed' && speedRank !== undefined) {
    switch (speedRank) {
      case 1:
        speedBonus = 50;
        break;
      case 2:
        speedBonus = 30;
        break;
      case 3:
        speedBonus = 15;
        break;
      case 4:
        speedBonus = 5;
        break;
      default:
        speedBonus = 0;
    }
  }

  const potentialStreak = currentStreak + 1;
  let streakBonus = 0;

  // Streak bonus MUST be calculated strictly from original un-doubled basePoints
  if (potentialStreak >= 3) {
    if (settings.streakRepeatMode === 'every_answer_after_three') {
      const streakPercent = (settings.streakBonusPercent || 10) / 100;
      streakBonus = Math.round(basePoints * streakPercent);
    } else if (potentialStreak === 3) {
      const streakPercent = (settings.streakBonusPercent || 10) / 100;
      streakBonus = Math.round(basePoints * streakPercent);
    }
  }

  const pointsAwarded = basePoints + doubledBaseBonus + speedBonus + streakBonus;

  return {
    pointsAwarded,
    basePoints,
    doubledBaseBonus,
    doublePointsApplied,
    speedBonus,
    streakBonus,
    newStreak: potentialStreak,
  };
}

export function calculateCardUnlocks(previousScore: number, newScore: number, threshold = 200): number {
  if (newScore <= previousScore) return 0;
  const previousMilestones = Math.floor(Math.max(0, previousScore) / threshold);
  const newMilestones = Math.floor(Math.max(0, newScore) / threshold);
  return Math.max(0, newMilestones - previousMilestones);
}

export function getInitialGlobalCardPool(): Record<CardType, number> {
  const pool: Record<string, number> = {};
  for (const [type, def] of Object.entries(CARD_DEFINITIONS)) {
    pool[type] = def.maxGlobalCopies;
  }
  return pool as Record<CardType, number>;
}

export function isCardEligibleForRound(card: CardInstance, currentRoundNumber: number): boolean {
  if (card.availableFromRound === undefined) return true;
  return currentRoundNumber >= card.availableFromRound;
}

export function drawCardFromGlobalPool(
  team: Team,
  globalPool: Record<CardType, number>,
  currentRoundNumber = 1
): {
  card: CardInstance | null;
  updatedPool: Record<CardType, number>;
  drawnType?: CardType;
} {
  const existingTeamCardTypes = new Set(team.secretCards.map(c => c.cardType));

  const availableTypes = (Object.keys(globalPool) as CardType[]).filter(
    type => globalPool[type] > 0 && !existingTeamCardTypes.has(type)
  );

  if (availableTypes.length === 0) {
    return { card: null, updatedPool: { ...globalPool } };
  }

  const chosenType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
  const remainingAfter = globalPool[chosenType] - 1;
  const updatedPool = { ...globalPool, [chosenType]: remainingAfter };

  const maxCopies = CARD_DEFINITIONS[chosenType].maxGlobalCopies;
  const copyNumber = (maxCopies - remainingAfter) as 1 | 2;

  const newCard: CardInstance = {
    id: `card-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    cardType: chosenType,
    copyNumber: maxCopies > 1 ? copyNumber : 1,
    acquiredAt: Date.now(),
    earnedInRound: currentRoundNumber,
    availableFromRound: currentRoundNumber + 1,
  };

  return {
    card: newCard,
    updatedPool,
    drawnType: chosenType,
  };
}

export function formatCardTitle(card: CardInstance): string {
  const def = CARD_DEFINITIONS[card.cardType];
  if (card.cardType === 'player_swap') {
    return card.copyNumber === 2 ? 'Player Swap II' : 'Player Swap I';
  }
  return def.titleEn;
}

export function shouldRevealAnswerResult(roundPhase: GameState['roundPhase']): boolean {
  return roundPhase === 'evaluating' || roundPhase === 'round_ended';
}

export function isMemberSwapEligible(member: TeamMember | undefined): boolean {
  if (!member) return false;
  return !member.isLeader && !member.isLocked;
}

export function validatePlayerSwapPair(params: {
  initiatingTeam: Team;
  targetTeam: Team;
  targetStudentId?: string;
  exchangeStudentId?: string;
}): {
  valid: boolean;
  error?: string;
  incomingMember?: TeamMember;
  outgoingMember?: TeamMember;
} {
  const { initiatingTeam, targetTeam, targetStudentId, exchangeStudentId } = params;

  if (!initiatingTeam || !targetTeam) {
    return { valid: false, error: 'Both initiating and target teams are required.' };
  }
  if (initiatingTeam.id === targetTeam.id) {
    return { valid: false, error: 'Cannot perform a Player Swap within the same team.' };
  }
  if (!targetStudentId) {
    return { valid: false, error: 'Step 1 required: Select an unprotected player from the rival team.' };
  }
  if (!exchangeStudentId) {
    return {
      valid: false,
      error: 'Step 2 required: Select one of your own unprotected teammates to send in exchange.',
    };
  }
  if (targetStudentId === exchangeStudentId) {
    return { valid: false, error: 'Incoming and outgoing players must be two different students.' };
  }

  const incomingMember = targetTeam.members.find(m => m.studentId === targetStudentId);
  if (!incomingMember) {
    return { valid: false, error: 'Selected incoming player no longer belongs to the target team.' };
  }
  if (incomingMember.isLeader) {
    return { valid: false, error: 'Team leaders are permanent and cannot be swapped.' };
  }
  if (incomingMember.isLocked) {
    return { valid: false, error: `${incomingMember.name} is protected by Player Lock.` };
  }

  const outgoingMember = initiatingTeam.members.find(m => m.studentId === exchangeStudentId);
  if (!outgoingMember) {
    return { valid: false, error: 'Selected outgoing teammate does not belong to your team.' };
  }
  if (outgoingMember.isLeader) {
    return { valid: false, error: 'Your team leader is permanent and cannot be exchanged.' };
  }
  if (outgoingMember.isLocked) {
    return {
      valid: false,
      error: `${outgoingMember.name} is protected by Player Lock and cannot leave in an exchange.`,
    };
  }

  return { valid: true, incomingMember, outgoingMember };
}

export function validateCardPlay(params: {
  game: GameState;
  team: Team;
  card: CardInstance;
  targetTeamId?: string;
  targetStudentId?: string;
  exchangeStudentId?: string;
}): { valid: boolean; error?: string } {
  const { game, team, card, targetTeamId, targetStudentId, exchangeStudentId } = params;
  const def = CARD_DEFINITIONS[card.cardType];

  if (!isCardEligibleForRound(card, game.currentRoundNumber)) {
    return {
      valid: false,
      error: `${def.titleEn} was earned in Round ${card.earnedInRound ?? game.currentRoundNumber} and cannot be used until Round ${card.availableFromRound}.`,
    };
  }

  if (def.isDefensive) {
    return {
      valid: false,
      error: `${def.titleEn} can only be played during an active incoming Reaction Window.`,
    };
  }

  if (card.cardType === 'double_points') {
    if (game.roundPhase !== 'card_window') {
      return {
        valid: false,
        error: 'Double Points can ONLY be activated during the Card Selection Window before the question is revealed.',
      };
    }
    if (game.answers?.[team.id]) {
      return {
        valid: false,
        error: 'Double Points cannot be activated after an answer has been submitted.',
      };
    }
    if (game.activeDoublePointsByTeam?.[team.id]) {
      return {
        valid: false,
        error: 'Double Points is already active for your team in this round.',
      };
    }
  }

  const usedThisRound = game.cardsUsedThisRound[team.id] || [];
  const nonDefenseUses =
    game.settings.defensiveCardLimitMode === 'free_defense'
      ? usedThisRound.filter(t => !CARD_DEFINITIONS[t]?.isDefensive)
      : usedThisRound;

  if (nonDefenseUses.length >= 1) {
    return { valid: false, error: 'Your team already played its card for this round.' };
  }

  if (def.requiresTargetTeam) {
    if (!targetTeamId || targetTeamId === team.id) {
      return { valid: false, error: 'Please select a valid rival team.' };
    }
    const targetTeam = game.teams[targetTeamId];
    if (!targetTeam) {
      return { valid: false, error: 'Target team not found.' };
    }

    if (card.cardType === 'player_swap') {
      const swapCheck = validatePlayerSwapPair({
        initiatingTeam: team,
        targetTeam,
        targetStudentId,
        exchangeStudentId,
      });
      if (!swapCheck.valid) {
        return { valid: false, error: swapCheck.error };
      }
    }

    if (card.cardType === 'card_steal') {
      if (!targetTeam.secretCards || targetTeam.secretCards.length === 0) {
        return { valid: false, error: `${targetTeam.name} currently holds no secret cards to steal.` };
      }
    }

    if (card.cardType === 'gift_player') {
      const eligibleOpponents = targetTeam.members.filter(isMemberSwapEligible);
      const eligibleOwn = team.members.filter(isMemberSwapEligible);
      if (eligibleOpponents.length === 0) {
        return { valid: false, error: 'Target team has no eligible unprotected non-leader players.' };
      }
      if (eligibleOwn.length === 0) {
        return { valid: false, error: 'Your team has no eligible unprotected non-leader players to exchange.' };
      }
      if (exchangeStudentId) {
        const ownMember = team.members.find(m => m.studentId === exchangeStudentId);
        if (!isMemberSwapEligible(ownMember)) {
          return { valid: false, error: 'Selected exchange player is invalid or protected.' };
        }
      }
    }
  }

  if (card.cardType === 'player_lock') {
    const currentlyLocked = team.members.filter(m => m.isLocked).length;
    const usesCount = team.playerLockUsesCount || 0;
    if (game.settings.playerLockMode === 'two_players' && currentlyLocked >= 2) {
      return { valid: false, error: 'Player Lock limit reached: max 2 protected players.' };
    }
    if (game.settings.playerLockMode === 'two_uses_any' && usesCount >= 2) {
      return { valid: false, error: 'Player Lock limit reached: max 2 uses per match.' };
    }
    if (!targetStudentId) {
      return { valid: false, error: 'Select a teammate to lock.' };
    }
    const ownMember = team.members.find(m => m.studentId === targetStudentId);
    if (!ownMember) {
      return { valid: false, error: 'Selected teammate not found.' };
    }
    if (ownMember.isLeader) {
      return { valid: false, error: 'Leaders are already permanently protected.' };
    }
    if (ownMember.isLocked) {
      return { valid: false, error: `${ownMember.name} is already protected.` };
    }
  }

  return { valid: true };
}

/**
 * Executes a mandatory 1-for-1 Player Swap atomically against staging state.
 * Preserves team sizes identically and throws before committing if any roster invariant fails.
 */
export function executeAtomicPlayerSwap(
  game: GameState,
  params: {
    initiatingTeamId: string;
    targetTeamId: string;
    targetStudentId: string;
    exchangeStudentId: string;
    requestId: string;
    reactionId?: string;
    now?: number;
  }
): {
  success: boolean;
  error?: string;
  incomingStudent?: TeamMember;
  outgoingStudent?: TeamMember;
  record?: PlayerSwapRecord;
} {
  const now = params.now ?? Date.now();
  const initTeam = game.teams[params.initiatingTeamId];
  const targetTeam = game.teams[params.targetTeamId];

  if (!initTeam || !targetTeam) {
    return { success: false, error: 'Initiating or target team missing.' };
  }

  if (game.processedSwapRequestIds?.includes(params.requestId)) {
    return { success: false, error: 'Duplicate Player Swap request already processed.' };
  }

  const pairCheck = validatePlayerSwapPair({
    initiatingTeam: initTeam,
    targetTeam,
    targetStudentId: params.targetStudentId,
    exchangeStudentId: params.exchangeStudentId,
  });
  if (!pairCheck.valid) {
    return { success: false, error: pairCheck.error };
  }

  const initIdx = initTeam.members.findIndex(m => m.studentId === params.exchangeStudentId);
  const targetIdx = targetTeam.members.findIndex(m => m.studentId === params.targetStudentId);
  if (initIdx === -1 || targetIdx === -1) {
    return { success: false, error: 'One of the selected players could not be located on their team.' };
  }

  const initBeforeLen = initTeam.members.length;
  const targetBeforeLen = targetTeam.members.length;

  // Stage cloned arrays first to prevent partial mutation on invariant error
  const nextInitMembers = [...initTeam.members];
  const nextTargetMembers = [...targetTeam.members];

  const [incoming] = nextTargetMembers.splice(targetIdx, 1);
  const [outgoing] = nextInitMembers.splice(initIdx, 1);

  nextInitMembers.push({ ...incoming });
  nextTargetMembers.push({ ...outgoing });

  if (nextInitMembers.length !== initBeforeLen || nextTargetMembers.length !== targetBeforeLen) {
    return { success: false, error: 'Roster count invariant violated during Player Swap.' };
  }

  const stagedTeams: Record<string, Team> = {
    ...game.teams,
    [initTeam.id]: { ...initTeam, members: nextInitMembers },
    [targetTeam.id]: { ...targetTeam, members: nextTargetMembers },
  };
  const rosterCheck = validateTeamRosters(stagedTeams);
  if (!rosterCheck.isValid) {
    return { success: false, error: rosterCheck.error || 'Team roster integrity check failed.' };
  }

  // Commit staged rosters
  initTeam.members = nextInitMembers;
  targetTeam.members = nextTargetMembers;

  if (!game.processedSwapRequestIds) game.processedSwapRequestIds = [];
  game.processedSwapRequestIds.push(params.requestId);

  const record: PlayerSwapRecord = {
    id: `swap-${now}-${Math.random().toString(36).slice(2, 6)}`,
    requestId: params.requestId,
    reactionId: params.reactionId,
    roundNumber: game.currentRoundNumber,
    initiatingTeamId: initTeam.id,
    initiatingTeamName: initTeam.name,
    targetTeamId: targetTeam.id,
    targetTeamName: targetTeam.name,
    incomingPlayerId: incoming.studentId,
    incomingPlayerName: incoming.name,
    outgoingPlayerId: outgoing.studentId,
    outgoingPlayerName: outgoing.name,
    status: 'executed',
    timestamp: now,
  };
  if (!game.swapHistory) game.swapHistory = [];
  game.swapHistory.unshift(record);

  return {
    success: true,
    incomingStudent: incoming,
    outgoingStudent: outgoing,
    record,
  };
}

/**
 * Standard competition ranking (1, 2, 2, 4).
 * Tied scores ALWAYS receive identical rank numbers and diffFromLeader.
 */
export function computeTeamRankings(teams: Record<string, Team>): TeamRankingEntry[] {
  const list = Object.values(teams || {});
  if (list.length === 0) return [];

  const sorted = [...list].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });

  const leaderScore = sorted[0].score;
  const scoreCounts = new Map<number, number>();
  for (const t of sorted) {
    scoreCounts.set(t.score, (scoreCounts.get(t.score) || 0) + 1);
  }

  let currentRank = 1;
  return sorted.map((t, index) => {
    if (index > 0 && t.score < sorted[index - 1].score) {
      currentRank = index + 1;
    }
    return {
      teamId: t.id,
      teamName: t.name,
      color: t.color,
      leaderName: t.leaderName,
      score: t.score,
      rank: currentRank,
      diffFromLeader: t.score - leaderScore,
      isLeader: t.score === leaderScore,
      isTiedRank: (scoreCounts.get(t.score) || 1) > 1,
      streak: t.streak,
      membersCount: t.members.length,
    };
  });
}

export function getLeaderSignature(teams: Record<string, Team>): string {
  const rankings = computeTeamRankings(teams);
  const leaders = rankings.filter(r => r.isLeader);
  if (leaders.length === 0 || leaders[0].score <= 0) return '';
  return leaders.map(l => l.teamId).sort().join(',');
}

/**
 * Selects 2 distinct random teams for visual-only Team Rivalry,
 * avoiding repeating the exact recent matchup when other pairs exist.
 */
export function selectTeamRivalryPair(
  teams: Record<string, Team>,
  rivalryHistory: TeamRivalryEvent[] = [],
  roundNumber = 1
): TeamRivalryEvent | null {
  const list = Object.values(teams || {});
  if (list.length < 2) return null;

  const allPairs: Array<[Team, Team]> = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      allPairs.push([list[i], list[j]]);
    }
  }

  const pairKey = (a: string, b: string) => [a, b].sort().join('::');
  const recentKeys = new Set(
    rivalryHistory.slice(0, 2).map(r => pairKey(r.teamAId, r.teamBId))
  );

  const freshPairs = allPairs.filter(([a, b]) => !recentKeys.has(pairKey(a.id, b.id)));
  const pool = freshPairs.length > 0 ? freshPairs : allPairs;
  const [pickedA, pickedB] = pool[Math.floor(Math.random() * pool.length)];

  // Randomly orient Team A vs Team B on stage
  const flip = Math.random() >= 0.5;
  const teamA = flip ? pickedA : pickedB;
  const teamB = flip ? pickedB : pickedA;

  return {
    id: `rivalry-r${roundNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    roundNumber,
    teamAId: teamA.id,
    teamBId: teamB.id,
    teamAName: teamA.name,
    teamBName: teamB.name,
    teamAColor: teamA.color,
    teamBColor: teamB.color,
    triggeredAt: Date.now(),
    dismissed: false,
  };
}

export function shouldTriggerTeamRivalryForRound(
  roundNumber: number,
  roundType: RoundType,
  rivalryHistory: TeamRivalryEvent[] = []
): boolean {
  if (roundType === 'private_round') return false;
  if (roundNumber < 2) return false;
  const lastRivalryRound = rivalryHistory[0]?.roundNumber ?? 0;
  // Trigger reliably on Round 2, then roughly every 3 regular rounds (never back-to-back)
  if (lastRivalryRound === roundNumber - 1) return false;
  if (roundNumber === 2) return true;
  if (roundNumber - lastRivalryRound >= 4) return true;
  return Math.random() < 0.35;
}

/**
 * Evaluates Comeback Bonus eligibility when gap >= 500 between highest and lowest teams.
 * Returns all last-place teams (including ties) who haven't yet received their 1 match opportunity.
 */
export function evaluateComebackEligibility(
  teams: Record<string, Team>,
  usedTeamIds: string[] = []
): {
  eligible: boolean;
  scoreDifference: number;
  eligibleTeamIds: string[];
  reason: string;
} {
  const list = Object.values(teams || {});
  if (list.length < 2) {
    return { eligible: false, scoreDifference: 0, eligibleTeamIds: [], reason: 'Not enough teams.' };
  }

  const scores = list.map(t => t.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const scoreDifference = maxScore - minScore;

  if (scoreDifference < 500) {
    return {
      eligible: false,
      scoreDifference,
      eligibleTeamIds: [],
      reason: `Score gap (${scoreDifference} pts) is below 500 pts threshold.`,
    };
  }

  const usedSet = new Set(usedTeamIds);
  const lowestTeams = list.filter(t => t.score === minScore && !usedSet.has(t.id));

  if (lowestTeams.length === 0) {
    return {
      eligible: false,
      scoreDifference,
      eligibleTeamIds: [],
      reason: 'Last-place team(s) already used their one Comeback Bonus opportunity.',
    };
  }

  return {
    eligible: true,
    scoreDifference,
    eligibleTeamIds: lowestTeams.map(t => t.id),
    reason: `Trailing by ${scoreDifference} points (>= 500 pts threshold) in last place.`,
  };
}

export function pickComebackQuestion(
  questions: Question[],
  usedQuestionIds: Set<string> = new Set()
): Question | null {
  const ready = questions.filter(isQuestionReadyForGame);
  if (ready.length === 0) return null;
  const unused = ready.filter(q => !usedQuestionIds.has(q.id));
  const pool = unused.length > 0 ? unused : ready;
  const mediumOrHard = pool.filter(q => q.difficulty === 'medium' || q.difficulty === 'hard');
  const finalPool = mediumOrHard.length > 0 ? mediumOrHard : pool;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

export function buildFinalMatchSummary(game: GameState): FinalMatchSummary {
  const standings = computeTeamRankings(game.teams);
  const topRankTeams = standings.filter(s => s.rank === 1);
  const isTieForFirst = topRankTeams.length > 1;

  // Prefer cumulative counters when tracked, falling back cleanly to current answers / transactions
  const stats = game.roundStats;
  const fallbackAnswers = Object.values(game.answers || {});
  const totalQuestionsAnswered =
    stats?.totalQuestionsAnswered ?? fallbackAnswers.length;
  const correctAnswersCount =
    stats?.correctAnswersCount ?? fallbackAnswers.filter(a => a.isCorrect).length;
  const incorrectAnswersCount =
    stats?.incorrectAnswersCount ??
    Math.max(0, totalQuestionsAnswered - correctAnswersCount);

  return {
    completedAt: Date.now(),
    totalRoundsCompleted: stats?.completedRoundsCount ?? game.currentRoundNumber,
    totalQuestionsAnswered,
    correctAnswersCount,
    incorrectAnswersCount,
    isTieForFirst,
    championTeamIds: topRankTeams.map(t => t.teamId),
    championTeamNames: topRankTeams.map(t => t.teamName),
    standings,
  };
}

export function createInitialComebackState(): ComebackBonusState {
  return {
    usedTeamIds: [],
    queuedTeamIds: [],
    activeEvent: null,
    history: [],
  };
}

/**
 * Extracts standalone Answer Key / Solutions sections from anywhere (typically end) of a document.
 */
export function extractAnswerKeyMap(rawText: string): {
  bodyText: string;
  answerKeyMap: Map<string, { answer: string; explanation?: string }>;
} {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const keySectionRegex = /(?:^|\n)(?:#+\s*)?(?:Answer\s*Key|Answers\s*Section|Solutions\s*Key|Correct\s*Answers|Solutions)\s*[:\-]?\s*\n([\s\S]+)$/i;
  const match = normalized.match(keySectionRegex);
  const answerKeyMap = new Map<string, { answer: string; explanation?: string }>();

  if (!match || match.index === undefined) {
    return { bodyText: normalized, answerKeyMap };
  }

  const bodyText = normalized.slice(0, match.index).trim();
  const keyBlock = match[1].trim();
  const lines = keyBlock.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Matches: "1. B", "Q1: C - because...", "Question 2: True", "3) 42 (Explanation: ...)"
    const entryMatch = line.match(/^(?:Question\s*|Q\s*)?(\d+)\s*[.):\-]\s*(.+)$/i);
    if (!entryMatch) continue;
    const numKey = entryMatch[1];
    let ansPart = entryMatch[2].trim();
    let explanation: string | undefined;

    const explSplit = ansPart.match(/^(.+?)\s*(?:\(|—|--|\s-\s)\s*(?:Explanation|Reason|Because|Note)?\s*[:\-]?\s*(.+?)\)?$/i);
    if (explSplit && explSplit[1].trim().length > 0 && explSplit[2].trim().length > 8) {
      ansPart = explSplit[1].trim();
      explanation = explSplit[2].trim();
    }

    answerKeyMap.set(numKey, { answer: ansPart, explanation });
  }

  return { bodyText, answerKeyMap };
}

/**
 * Verbatim parser for English programming questions.
 * Preserves exact wording and code snippets without rewriting or inventing answers.
 * Matches inline answers, worked solutions, and end-of-document answer keys.
 */
export function extractQuestionsFromRawText(
  rawText: string,
  options?: {
    sourceFileName?: string;
    sourcePage?: number;
    externalAnswerKey?: Map<string, { answer: string; explanation?: string }>;
  }
): Question[] {
  const normalizedInput = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalizedInput) return [];

  const { bodyText, answerKeyMap } = extractAnswerKeyMap(normalizedInput);
  const combinedKeyMap = new Map(answerKeyMap);
  if (options?.externalAnswerKey) {
    for (const [k, v] of options.externalAnswerKey.entries()) {
      if (!combinedKeyMap.has(k)) combinedKeyMap.set(k, v);
    }
  }

  const blocks = bodyText
    .split(/\n(?=(?:Question\s*\d+|Q\s*\d+|\d+\s*[.)]))/gi)
    .map(b => b.trim())
    .filter(b => b.length >= 10);

  const parsed: Question[] = [];

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];
    const numMatch = block.match(/^(?:Question\s*|Q\s*)?(\d+)\s*[.):\-]/i);
    const questionNumber = numMatch ? `Q${numMatch[1]}` : `Q${idx + 1}`;
    const numericKey = numMatch ? numMatch[1] : String(idx + 1);

    // Extract code block if enclosed in ```...```
    let codeSnippet: string | undefined = undefined;
    let workingBlock = block;
    const codeMatch = block.match(/```(?:[a-zA-Z0-9_+#-]*)\n([\s\S]*?)```/);
    if (codeMatch) {
      codeSnippet = codeMatch[1].replace(/\n+$/, '');
      workingBlock = block.replace(codeMatch[0], '').trim();
    }

    // Extract inline answer or worked solution line verbatim if provided
    const answerMatch = workingBlock.match(
      /^(?:Answer|Correct\s*Answer|Correct|Key|Ans|Expected\s*Output|Output)\s*[:\-]\s*(.+)$/im
    );
    const solutionMatch = workingBlock.match(
      /^(?:Solution|Explanation|Reason)\s*[:\-]\s*(.+)$/im
    );

    let rawAnswer = answerMatch ? answerMatch[1].trim() : '';
    let answerSource: Question['answerSource'] = answerMatch ? 'inline' : 'none';
    let sourceExplanation = solutionMatch ? solutionMatch[1].trim() : undefined;

    let bodyClean = workingBlock;
    if (answerMatch) bodyClean = bodyClean.replace(answerMatch[0], '').trim();
    if (solutionMatch) bodyClean = bodyClean.replace(solutionMatch[0], '').trim();

    if (!rawAnswer && combinedKeyMap.has(numericKey)) {
      const keyEntry = combinedKeyMap.get(numericKey)!;
      rawAnswer = keyEntry.answer;
      answerSource = 'answer_key_section';
      if (!sourceExplanation && keyEntry.explanation) {
        sourceExplanation = keyEntry.explanation;
      }
    } else if (!rawAnswer && solutionMatch) {
      // Check if worked solution line directly states a final result like "Output is 8"
      const solAns = solutionMatch[1].match(/^(?:output|result|answer)\s*(?:is|=|:)\s*([^\n.,;]+)/i);
      if (solAns) {
        rawAnswer = solAns[1].trim();
        answerSource = 'worked_solution';
      }
    }

    // Extract MCQ options (both vertical lines and compact inline A) ... B) ...)
    const optionEntries: Array<{ letter: string; text: string }> = [];
    const verticalOptionRegex = /^\s*\(?([A-D])\)?\s*[.):]\s*(.+)$/gm;
    let optMatch: RegExpExecArray | null;
    while ((optMatch = verticalOptionRegex.exec(bodyClean)) !== null) {
      const lineText = optMatch[2].trim();
      // Check if multiple inline options appear on the same line (e.g. "A) for  B) while  C) do-while")
      if (/\s+\(?[B-D]\)?\s*[.)]\s+/.test(lineText)) {
        const fullLine = optMatch[0];
        const inlineRegex = /\(?([A-D])\)?\s*[.)]\s*([\s\S]*?)(?=\s+\(?[A-D]\)?\s*[.)]\s*|$)/gi;
        let m: RegExpExecArray | null;
        while ((m = inlineRegex.exec(fullLine)) !== null) {
          optionEntries.push({ letter: m[1].toUpperCase(), text: m[2].trim() });
        }
      } else {
        optionEntries.push({
          letter: optMatch[1].toUpperCase(),
          text: lineText,
        });
      }
    }

    // Also try inline horizontal options embedded inside stem line e.g. "Question? A) 6  B) 8"
    let bodyWithoutOptions = bodyClean;
    if (optionEntries.length <= 1) {
      const inlineMatch = bodyClean.match(/(?:^|\n|\s)(\(?A\)?[.)]\s*.+?\s+\(?B\)?[.)]\s*.+)$/i);
      if (inlineMatch) {
        optionEntries.length = 0;
        const inlineRegex = /\(?([A-D])\)?\s*[.)]\s*([\s\S]*?)(?=\s+\(?[A-D]\)?\s*[.)]\s*|$)/gi;
        let m: RegExpExecArray | null;
        while ((m = inlineRegex.exec(inlineMatch[1])) !== null) {
          optionEntries.push({ letter: m[1].toUpperCase(), text: m[2].trim() });
        }
        if (optionEntries.length >= 2) {
          bodyWithoutOptions = bodyClean.slice(0, inlineMatch.index).trim();
        }
      }
    } else {
      bodyWithoutOptions = bodyClean
        .split('\n')
        .filter(line => !/^\s*\(?[A-D]\)?\s*[.):]\s*.+$/.test(line))
        .join('\n')
        .trim();
    }

    let questionText = bodyWithoutOptions
      .replace(/^(?:Question\s*\d+|Q\s*\d+|\d+)\s*[:.)-]?\s*/i, '')
      .trim();

    if (!questionText) continue;

    // Map letter answer (e.g., "B") to exact option text if applicable
    const optionTexts = optionEntries.map(o => o.text);
    if (rawAnswer && /^[A-D]$/i.test(rawAnswer) && optionEntries.length > 0) {
      const matchedOpt = optionEntries.find(o => o.letter === rawAnswer.toUpperCase());
      if (matchedOpt) {
        rawAnswer = matchedOpt.text;
      }
    }

    // Determine type without altering wording
    let type: QuestionType = 'multiple_choice';
    const isTF =
      (optionTexts.length === 2 &&
        optionTexts.some(o => /^true$/i.test(o)) &&
        optionTexts.some(o => /^false$/i.test(o))) ||
      /\(true\s*\/\s*false\)|\(t\s*\/\s*f\)/i.test(questionText);

    if (isTF || (/^(true|false)$/i.test(rawAnswer) && optionTexts.length === 0)) {
      type = 'true_false';
    } else if (optionTexts.length === 0) {
      if (/what\s+(?:is|will\s+be)\s+the\s+output|what\s+(?:does|will|would)\s+.*?\b(?:output|print|return|log|display|evaluate\s+to)\b|predict\s+the\s+output|find\s+the\s+output|trace\s+the\s+output/i.test(questionText)) {
        type = 'find_output';
      } else if (/debug|fix\s+the\s+bug|spot\s+the\s+error/i.test(questionText)) {
        type = 'debugging';
      } else if (codeSnippet || /complete|fill\s*in|_______/i.test(questionText)) {
        type = 'code_completion';
      } else if (/write\s+a\s+(program|function|script)|implement/i.test(questionText)) {
        type = 'programming';
      } else {
        type = 'short_answer';
      }
    }

    const answerProvided = rawAnswer.length > 0 && rawAnswer.toUpperCase() !== 'NOT PROVIDED';
    const correctAnswer = answerProvided ? rawAnswer : 'NOT PROVIDED';
    const difficulty: Difficulty =
      type === 'programming' || type === 'debugging'
        ? 'hard'
        : codeSnippet || type === 'find_output' || type === 'code_completion'
        ? 'medium'
        : 'easy';

    parsed.push({
      id: `q-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
      questionNumber,
      questionText,
      codeSnippet,
      type,
      difficulty,
      options:
        type === 'true_false'
          ? ['True', 'False']
          : optionTexts.length > 0
          ? optionTexts
          : undefined,
      correctAnswer,
      sourceAnswer: answerProvided ? correctAnswer : undefined,
      answerStatus: answerProvided ? 'provided' : 'not_provided',
      answerSource: answerProvided ? answerSource : 'none',
      answerExplanation: sourceExplanation,
      verificationStatus: answerProvided ? 'source_verified' : 'not_provided',
      answerConfidence: answerProvided ? 95 : 0,
      points: difficulty === 'hard' ? 150 : difficulty === 'medium' ? 120 : 100,
      approved: answerProvided,
      sourceFileName: options?.sourceFileName,
      sourcePage: options?.sourcePage,
      sourceExcerpt: block.slice(0, 380),
    });
  }

  return parsed;
}
