import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, REGISTERED_STUDENTS } from './defaultData';
import {
  createTeamsFromStudents,
  validateTeamRosters,
  selectPrivateRoundPlayers,
  selectPrivateRoundPlayersWithReport,
  calculateAnswerScore,
  calculateCardUnlocks,
  computeQuestionEffectOutcome,
  getInitialGlobalCardPool,
  drawCardFromGlobalPool,
  generateAutomaticRoundSchedule,
  formatCardTitle,
  isCardEligibleForRound,
  shouldRevealAnswerResult,
  validateCardPlay,
  validateTotalRounds,
  DEFAULT_TOTAL_ROUNDS,
  MAX_TOTAL_ROUNDS,
  extractQuestionsFromRawText,
  evaluateQuestionAnswer,
  isQuestionReadyForGame,
  analyzeQuestionQuality,
  computeTeamRankings,
  executeAtomicPlayerSwap,
  selectTeamRivalryPair,
  evaluateComebackEligibility,
  buildFinalMatchSummary
} from './rules';
import { GameState, Question } from '../types/game';

test('createTeamsFromStudents distributes 22 students into 4 teams with sizes [5, 5, 6, 6]', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);

  const teamKeys = Object.keys(teams);
  assert.equal(teamKeys.length, 4, 'Must create exactly 4 teams');

  const validation = validateTeamRosters(teams);
  assert.equal(validation.isValid, true, validation.error || 'Team roster invalid');

  for (const team of Object.values(teams)) {
    const leader = team.members.find(m => m.isLeader);
    assert.ok(leader, `Team ${team.id} must have an identified leader`);
    assert.equal(leader.studentId, team.leaderStudentId, 'Leader ID must match team.leaderStudentId');
  }
});

test('selectPrivateRoundPlayers picks unique students across 5 consecutive rounds for each team and leaders are eligible', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  const participated: Record<string, string[]> = {
    team1: [],
    team2: [],
    team3: [],
    team4: [],
  };

  for (let round = 1; round <= 5; round++) {
    const selected = selectPrivateRoundPlayers(teams, participated);

    for (const [teamId, player] of Object.entries(selected)) {
      assert.ok(player.studentId, `Round ${round}: team ${teamId} must have a selected player`);
      assert.ok(
        !participated[teamId].includes(player.studentId),
        `Round ${round}: player ${player.name} (${player.studentId}) was already picked!`
      );
      participated[teamId].push(player.studentId);
    }
  }

  for (const [teamId, list] of Object.entries(participated)) {
    assert.equal(list.length, 5, `Team ${teamId} should have 5 distinct participants`);
    assert.equal(new Set(list).size, 5, `Team ${teamId} has duplicate participants`);
    // For a 5-member team, all 5 members (including the leader!) must be picked across 5 rounds
    if (teams[teamId].members.length === 5) {
      assert.ok(
        list.includes(teams[teamId].leaderStudentId),
        `Leader of 5-member team ${teamId} must be eligible and selected during the 5-round sequence`
      );
    }
  }
});

test('selectPrivateRoundPlayersWithReport emits warning instead of crashing when a team has < 5 members', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  // Shrink team1 to 2 members due to hypothetical swaps
  teams.team1.members = teams.team1.members.slice(0, 2);
  const participated: Record<string, string[]> = {
    team1: teams.team1.members.map(m => m.studentId),
    team2: [],
    team3: [],
    team4: [],
  };

  const { selected, warnings } = selectPrivateRoundPlayersWithReport(teams, participated);
  assert.ok(selected.team1?.studentId, 'Fallback player should still be returned');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no remaining un-participated players/i);
});

test('calculateAnswerScore computes base points, speed rank bonuses, and streaks correctly', () => {
  const sampleQuestion: Question = {
    id: 'test-q',
    questionText: 'Test question',
    type: 'multiple_choice',
    difficulty: 'medium',
    correctAnswer: 'A',
    points: 100,
    approved: true,
  };

  const wrongRes = calculateAnswerScore(sampleQuestion, false, 1, 5);
  assert.equal(wrongRes.pointsAwarded, 0);
  assert.equal(wrongRes.newStreak, 0);

  const rank1Res = calculateAnswerScore(sampleQuestion, true, 1, 0);
  assert.equal(rank1Res.pointsAwarded, 150);
  assert.equal(rank1Res.newStreak, 1);

  const streak3Res = calculateAnswerScore(sampleQuestion, true, 2, 2);
  assert.equal(streak3Res.pointsAwarded, 140);
  assert.equal(streak3Res.newStreak, 3);
});

test('computeQuestionEffectOutcome applies bonus on correct, minus on incorrect clamped >= 0, and 0 otherwise', () => {
  const bonusCorrect = computeQuestionEffectOutcome({
    effectType: 'bonus',
    bonusPoints: 50,
    minusPoints: 50,
    isCorrect: true,
    currentScore: 120,
  });
  assert.equal(bonusCorrect.scoreDelta, 50);
  assert.equal(bonusCorrect.newScore, 170);

  const bonusWrong = computeQuestionEffectOutcome({
    effectType: 'bonus',
    bonusPoints: 50,
    minusPoints: 50,
    isCorrect: false,
    currentScore: 120,
  });
  assert.equal(bonusWrong.scoreDelta, 0);
  assert.equal(bonusWrong.newScore, 120);

  const minusWrong = computeQuestionEffectOutcome({
    effectType: 'minus',
    bonusPoints: 50,
    minusPoints: 50,
    isCorrect: false,
    currentScore: 30,
  });
  assert.equal(minusWrong.scoreDelta, -30);
  assert.equal(minusWrong.newScore, 0);

  const minusCorrect = computeQuestionEffectOutcome({
    effectType: 'minus',
    bonusPoints: 50,
    minusPoints: 50,
    isCorrect: true,
    currentScore: 200,
  });
  assert.equal(minusCorrect.scoreDelta, 0);
  assert.equal(minusCorrect.newScore, 200);
});

test('calculateCardUnlocks calculates milestone increments of 200 points', () => {
  assert.equal(calculateCardUnlocks(0, 190), 0);
  assert.equal(calculateCardUnlocks(0, 210), 1);
  assert.equal(calculateCardUnlocks(190, 410), 2);
  assert.equal(calculateCardUnlocks(200, 200), 0);
  assert.equal(calculateCardUnlocks(450, 420), 0);
});

test('Global card pool sets earnedInRound and availableFromRound = currentRound + 1', () => {
  const pool = getInitialGlobalCardPool();
  assert.equal(pool.player_swap, 2);
  assert.equal(pool.player_lock, 1);

  assert.equal(
    formatCardTitle({ id: 'c1', cardType: 'player_swap', copyNumber: 1, acquiredAt: 0 }),
    'Player Swap I'
  );
  assert.equal(
    formatCardTitle({ id: 'c2', cardType: 'player_swap', copyNumber: 2, acquiredAt: 0 }),
    'Player Swap II'
  );

  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  const drawRound4 = drawCardFromGlobalPool(teams.team1, pool, 4);
  assert.ok(drawRound4.card);
  assert.equal(drawRound4.card!.earnedInRound, 4);
  assert.equal(drawRound4.card!.availableFromRound, 5);
  assert.equal(isCardEligibleForRound(drawRound4.card!, 4), false);
  assert.equal(isCardEligibleForRound(drawRound4.card!, 5), true);
  assert.equal(drawRound4.updatedPool[drawRound4.card!.cardType], pool[drawRound4.card!.cardType] - 1);
});

test('shouldRevealAnswerResult gates answer feedback until evaluating or round_ended', () => {
  assert.equal(shouldRevealAnswerResult('idle'), false);
  assert.equal(shouldRevealAnswerResult('card_window'), false);
  assert.equal(shouldRevealAnswerResult('question_active'), false);
  assert.equal(shouldRevealAnswerResult('evaluating'), true);
  assert.equal(shouldRevealAnswerResult('round_ended'), true);
});

test('validateCardPlay enforces next-round eligibility, protection rules, playerLockMode, and defensiveCardLimitMode', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  const baseGame: GameState = {
    gameId: 'g-1',
    name: 'Test',
    createdAt: 0,
    updatedAt: 0,
    status: 'in_progress',
    currentRoundNumber: 2,
    totalRounds: 50,
    currentRoundType: 'group_speed',
    roundSchedule: [],
    teams,
    roundPhase: 'question_active',
    answers: {},
    privateRoundGroup: {
      isInPrivateGroup: false,
      batchNumber: 0,
      roundIndexInBatch: 0,
      selectedPlayerPerTeam: {},
      participatedStudentsInBatch: { team1: [], team2: [], team3: [], team4: [] },
    },
    globalCardPoolRemaining: getInitialGlobalCardPool(),
    cardsUsedThisRound: { team1: [], team2: [], team3: [], team4: [] },
    activeReactions: [],
    scoreTransactions: [],
    auditLogs: [],
    settings: { ...DEFAULT_SETTINGS },
  };

  const t1 = baseGame.teams.team1;
  const t2 = baseGame.teams.team2;

  const sameRoundBonus = {
    id: 'c-bonus-r2',
    cardType: 'bonus_card' as const,
    acquiredAt: 0,
    earnedInRound: 2,
    availableFromRound: 3,
  };
  const sameRoundRes = validateCardPlay({
    game: baseGame,
    team: t1,
    card: sameRoundBonus,
  });
  assert.equal(sameRoundRes.valid, false);
  assert.match(sameRoundRes.error || '', /Round 3/);

  baseGame.currentRoundNumber = 3;
  const nextRoundRes = validateCardPlay({
    game: baseGame,
    team: t1,
    card: sameRoundBonus,
  });
  assert.equal(nextRoundRes.valid, true);

  const swapCard = { id: 'c-swap', cardType: 'player_swap' as const, copyNumber: 1 as const, acquiredAt: 0 };
  const lockCard = { id: 'c-lock', cardType: 'player_lock' as const, acquiredAt: 0 };

  const t2Leader = t2.members.find(m => m.isLeader)!;
  const leaderSwap = validateCardPlay({
    game: baseGame,
    team: t1,
    card: swapCard,
    targetTeamId: 'team2',
    targetStudentId: t2Leader.studentId,
  });
  assert.equal(leaderSwap.valid, false);

  const t2NonLeader = t2.members.find(m => !m.isLeader)!;
  t2NonLeader.isLocked = true;
  const lockedSwap = validateCardPlay({
    game: baseGame,
    team: t1,
    card: swapCard,
    targetTeamId: 'team2',
    targetStudentId: t2NonLeader.studentId,
  });
  assert.equal(lockedSwap.valid, false);

  baseGame.cardsUsedThisRound.team1 = ['anti_swap'];
  baseGame.settings.defensiveCardLimitMode = 'free_defense';
  t2NonLeader.isLocked = false;
  const t1FirstTeammate = t1.members.find(m => !m.isLeader)!;
  const freeDefenseRes = validateCardPlay({
    game: baseGame,
    team: t1,
    card: swapCard,
    targetTeamId: 'team2',
    targetStudentId: t2NonLeader.studentId,
    exchangeStudentId: t1FirstTeammate.studentId,
  });
  assert.equal(freeDefenseRes.valid, true);

  const t1NonLeaders = t1.members.filter(m => !m.isLeader);
  t1NonLeaders[0].isLocked = true;
  t1NonLeaders[1].isLocked = true;
  const lockOverLimit = validateCardPlay({
    game: baseGame,
    team: t1,
    card: lockCard,
    targetStudentId: t1NonLeaders[2].studentId,
  });
  assert.equal(lockOverLimit.valid, false);
});

test('extractQuestionsFromRawText preserves verbatim English text, matches end-of-doc answer keys, and marks missing answers as NOT PROVIDED', () => {
  const sample = `Q1: What is the output of print(2 ** 3) in Python?
A) 6
B) 8
C) 9
D) 16

Q2: Explain why Big-O notation ignores constant factors.

Answer Key:
1. B
`;

  const parsed = extractQuestionsFromRawText(sample, { sourceFileName: 'exam.txt', sourcePage: 1 });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].questionText, 'What is the output of print(2 ** 3) in Python?');
  assert.equal(parsed[0].correctAnswer, '8');
  assert.equal(parsed[0].answerStatus, 'provided');
  assert.equal(parsed[0].answerSource, 'answer_key_section');
  assert.equal(parsed[0].approved, true);

  assert.equal(parsed[1].questionText, 'Explain why Big-O notation ignores constant factors.');
  assert.equal(parsed[1].correctAnswer, 'NOT PROVIDED');
  assert.equal(parsed[1].answerStatus, 'not_provided');
  assert.equal(parsed[1].approved, false);
});

test('evaluateQuestionAnswer handles MCQ letters, True/False, acceptedAnswers, and normalized code tokens', () => {
  const mcq: Question = {
    id: 'q-mcq',
    questionText: '2 + 2?',
    type: 'multiple_choice',
    difficulty: 'easy',
    options: ['3', '4', '5', '6'],
    correctAnswer: '4',
    points: 100,
    approved: true,
  };
  assert.equal(evaluateQuestionAnswer(mcq, '4').isCorrect, true);
  assert.equal(evaluateQuestionAnswer(mcq, 'B').isCorrect, true);
  assert.equal(evaluateQuestionAnswer(mcq, 'B) 4').isCorrect, true);
  assert.equal(evaluateQuestionAnswer(mcq, '5').isCorrect, false);

  const codeQ: Question = {
    id: 'q-code',
    questionText: 'Complete the return statement.',
    type: 'code_completion',
    difficulty: 'medium',
    correctAnswer: 'return x + y;',
    acceptedAnswers: ['return (x + y)'],
    points: 120,
    approved: true,
  };
  assert.equal(evaluateQuestionAnswer(codeQ, 'return x+y').isCorrect, true);
  assert.equal(evaluateQuestionAnswer(codeQ, 'return (x + y)').isCorrect, true);
  assert.equal(evaluateQuestionAnswer(codeQ, 'return x - y').isCorrect, false);
});

test('isQuestionReadyForGame and analyzeQuestionQuality enforce strict review gates', () => {
  const goodQ: Question = {
    id: 'q-good',
    questionText: 'Is Python dynamically typed?',
    type: 'true_false',
    difficulty: 'easy',
    options: ['True', 'False'],
    correctAnswer: 'True',
    verificationStatus: 'source_verified',
    points: 100,
    approved: true,
  };
  const conflictQ: Question = {
    ...goodQ,
    id: 'q-conflict',
    verificationStatus: 'conflicting',
  };
  const needsReviewQ: Question = {
    ...goodQ,
    id: 'q-review',
    verificationStatus: 'needs_teacher_review',
    correctAnswer: 'NOT PROVIDED',
  };
  const badMcq: Question = {
    id: 'q-bad-mcq',
    questionText: 'Pick an option',
    type: 'multiple_choice',
    difficulty: 'easy',
    options: ['OnlyOne'],
    correctAnswer: 'MissingOption',
    points: 100,
    approved: true,
  };

  assert.equal(isQuestionReadyForGame(goodQ), true);
  assert.equal(isQuestionReadyForGame(conflictQ), false);
  assert.equal(isQuestionReadyForGame(needsReviewQ), false);

  const qc = analyzeQuestionQuality([goodQ, conflictQ, badMcq]);
  assert.ok(qc.questionsWithIssues[1].qualityIssues?.some(i => i.code === 'CONFLICTING_ANSWER'));
  assert.ok(qc.questionsWithIssues[2].qualityIssues?.some(i => i.code === 'MISSING_MCQ_OPTIONS'));
});

test('validateTotalRounds enforces default 50 and max 70 limit, rejecting > 70', () => {
  assert.equal(DEFAULT_TOTAL_ROUNDS, 50);
  assert.equal(MAX_TOTAL_ROUNDS, 70);
  assert.equal(DEFAULT_SETTINGS.totalRounds, 50);
  assert.equal(validateTotalRounds(50).valid, true);
  assert.equal(validateTotalRounds(70).valid, true);
  assert.equal(validateTotalRounds(71).valid, false);
  assert.equal(validateTotalRounds(0).valid, false);
  assert.equal(validateTotalRounds(12.5).valid, false);
});

test('generateAutomaticRoundSchedule supports 50 and 70 rounds, 5 consecutive private rounds with 4 distinct questions each', () => {
  const dummyQuestions: Question[] = Array.from({ length: 30 }, (_, i) => ({
    id: `q-${i + 1}`,
    questionText: `Question ${i + 1}`,
    type: 'multiple_choice',
    difficulty: 'medium',
    correctAnswer: 'A',
    verificationStatus: 'source_verified',
    points: 100,
    approved: true,
  }));

  for (const targetCount of [50, 70]) {
    const { schedule } = generateAutomaticRoundSchedule(targetCount, dummyQuestions);
    assert.equal(schedule.length, targetCount);

    const privateRounds = schedule.filter(r => r.roundType === 'private_round');
    assert.equal(privateRounds.length, 5);

    for (let i = 1; i < privateRounds.length; i++) {
      assert.equal(privateRounds[i].roundNumber, privateRounds[i - 1].roundNumber + 1);
    }

    for (const pr of privateRounds) {
      assert.equal(pr.privateTeamOrder?.length, 4);
      const qIds = Object.values(pr.privateQuestionsByTeam || {}).map(x => x.questionId);
      assert.equal(qIds.length, 4);
      assert.equal(new Set(qIds).size, 4, 'Each Private Round must have 4 distinct questions');
    }
  }
});

test('computeTeamRankings assigns standard tie ranks [1, 2, 2, 4] and diffs from leader', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  teams.team1.score = 500;
  teams.team2.score = 300;
  teams.team3.score = 300;
  teams.team4.score = 100;

  const rankings = computeTeamRankings(teams);
  assert.deepEqual(
    rankings.map(r => r.rank),
    [1, 2, 2, 4]
  );
  assert.deepEqual(
    rankings.map(r => r.diffFromLeader),
    [0, -200, -200, -400]
  );
  assert.equal(rankings[0].isLeader, true);
  assert.equal(rankings[1].isLeader, false);

  teams.team2.score = 500;
  const tiedFirst = computeTeamRankings(teams);
  assert.deepEqual(
    tiedFirst.filter(r => r.rank === 1).map(r => r.teamId).sort(),
    ['team1', 'team2']
  );
});

test('calculateAnswerScore with doublePointsApplied doubles ONLY base points and keeps streak on un-doubled base', () => {
  const q: Question = {
    id: 'q-dp',
    questionText: 'Base 100 question',
    type: 'multiple_choice',
    difficulty: 'medium',
    correctAnswer: 'A',
    points: 100,
    approved: true,
  };

  // Streak 2 -> newStreak 3 (+10% of 100 = 10), Speed Rank 1 (+50), Double base (+100) => 200 + 50 + 10 = 260
  const res = calculateAnswerScore(q, true, 1, 2, DEFAULT_SETTINGS, 'group_speed', {
    doublePointsApplied: true,
  });
  assert.equal(res.basePoints, 100);
  assert.equal(res.doubledBaseBonus, 100);
  assert.equal(res.speedBonus, 50);
  assert.equal(res.streakBonus, 10);
  assert.equal(res.pointsAwarded, 260);
  assert.equal(res.doublePointsApplied, true);

  // Wrong answer must gain 0 even with doublePointsApplied
  const wrong = calculateAnswerScore(q, false, 1, 2, DEFAULT_SETTINGS, 'group_speed', {
    doublePointsApplied: true,
  });
  assert.equal(wrong.pointsAwarded, 0);
  assert.equal(wrong.doubledBaseBonus, 0);
});

test('validateCardPlay enforces card_window only for double_points and mandatory 1-for-1 for player_swap', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  const game: GameState = {
    gameId: 'g-cards',
    name: 'Test',
    createdAt: 0,
    updatedAt: 0,
    status: 'in_progress',
    currentRoundNumber: 2,
    totalRounds: 50,
    currentRoundType: 'group_speed',
    roundSchedule: [],
    teams,
    roundPhase: 'question_active',
    answers: {},
    privateRoundGroup: {
      isInPrivateGroup: false,
      batchNumber: 0,
      roundIndexInBatch: 0,
      selectedPlayerPerTeam: {},
      participatedStudentsInBatch: { team1: [], team2: [], team3: [], team4: [] },
    },
    globalCardPoolRemaining: getInitialGlobalCardPool(),
    cardsUsedThisRound: { team1: [], team2: [], team3: [], team4: [] },
    activeReactions: [],
    scoreTransactions: [],
    auditLogs: [],
    settings: { ...DEFAULT_SETTINGS },
  };

  const dpCard = { id: 'c-dp', cardType: 'double_points' as const, acquiredAt: 0 };
  const blockedActive = validateCardPlay({ game, team: game.teams.team1, card: dpCard });
  assert.equal(blockedActive.valid, false);

  game.roundPhase = 'card_window';
  const allowedWindow = validateCardPlay({ game, team: game.teams.team1, card: dpCard });
  assert.equal(allowedWindow.valid, true);

  const swapCard = { id: 'c-swap', cardType: 'player_swap' as const, copyNumber: 1 as const, acquiredAt: 0 };
  const t2Member = game.teams.team2.members.find(m => !m.isLeader)!;
  const t1Member = game.teams.team1.members.find(m => !m.isLeader)!;

  const missingOutgoing = validateCardPlay({
    game,
    team: game.teams.team1,
    card: swapCard,
    targetTeamId: 'team2',
    targetStudentId: t2Member.studentId,
  });
  assert.equal(missingOutgoing.valid, false);

  const completeSwap = validateCardPlay({
    game,
    team: game.teams.team1,
    card: swapCard,
    targetTeamId: 'team2',
    targetStudentId: t2Member.studentId,
    exchangeStudentId: t1Member.studentId,
  });
  assert.equal(completeSwap.valid, true);
});

test('executeAtomicPlayerSwap exchanges 1-for-1 preserving [5,5,6,6] roster sizes and prevents duplicate requestId', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  const game: GameState = {
    gameId: 'g-swap',
    name: 'Swap Test',
    createdAt: 0,
    updatedAt: 0,
    status: 'in_progress',
    currentRoundNumber: 2,
    totalRounds: 50,
    currentRoundType: 'group_speed',
    roundSchedule: [],
    teams,
    roundPhase: 'card_window',
    answers: {},
    privateRoundGroup: {
      isInPrivateGroup: false,
      batchNumber: 0,
      roundIndexInBatch: 0,
      selectedPlayerPerTeam: {},
      participatedStudentsInBatch: { team1: [], team2: [], team3: [], team4: [] },
    },
    globalCardPoolRemaining: getInitialGlobalCardPool(),
    cardsUsedThisRound: { team1: [], team2: [], team3: [], team4: [] },
    activeReactions: [],
    scoreTransactions: [],
    auditLogs: [],
    settings: { ...DEFAULT_SETTINGS },
    processedSwapRequestIds: [],
    swapHistory: [],
  };

  const t1SizeBefore = game.teams.team1.members.length;
  const t2SizeBefore = game.teams.team2.members.length;
  const outgoing = game.teams.team1.members.find(m => !m.isLeader)!;
  const incoming = game.teams.team2.members.find(m => !m.isLeader)!;

  const res = executeAtomicPlayerSwap(game, {
    requestId: 'req-swap-1',
    initiatingTeamId: 'team1',
    targetTeamId: 'team2',
    targetStudentId: incoming.studentId,
    exchangeStudentId: outgoing.studentId,
  });
  assert.equal(res.success, true);
  assert.equal(game.teams.team1.members.length, t1SizeBefore);
  assert.equal(game.teams.team2.members.length, t2SizeBefore);
  assert.ok(game.teams.team1.members.some(m => m.studentId === incoming.studentId));
  assert.ok(game.teams.team2.members.some(m => m.studentId === outgoing.studentId));
  assert.equal(validateTeamRosters(game.teams).isValid, true);

  // Duplicate requestId rejected without mutation
  const dup = executeAtomicPlayerSwap(game, {
    requestId: 'req-swap-1',
    initiatingTeamId: 'team1',
    targetTeamId: 'team2',
    targetStudentId: incoming.studentId,
    exchangeStudentId: outgoing.studentId,
  });
  assert.equal(dup.success, false);
});

test('selectTeamRivalryPair selects 2 distinct teams without repeating immediate previous matchup', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  const pair1 = selectTeamRivalryPair(teams, [], 2);
  assert.ok(pair1);
  assert.notEqual(pair1.teamAId, pair1.teamBId);

  const pair2 = selectTeamRivalryPair(teams, [pair1], 4);
  assert.ok(pair2);
  const sig1 = [pair1.teamAId, pair1.teamBId].sort().join('|');
  const sig2 = [pair2.teamAId, pair2.teamBId].sort().join('|');
  assert.notEqual(sig1, sig2);
});

test('evaluateComebackEligibility enforces >= 500pt gap, 1x per team per match, and fair tied-last queue', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  teams.team1.score = 1000;
  teams.team2.score = 700;
  teams.team3.score = 400; // -600 gap
  teams.team4.score = 400; // -600 tied last!

  const check1 = evaluateComebackEligibility(teams, []);
  assert.equal(check1.eligible, true);
  assert.deepEqual(check1.eligibleTeamIds.sort(), ['team3', 'team4']);

  // Once team3 receives opportunity, team4 remains eligible on subsequent between-round check
  const check2 = evaluateComebackEligibility(teams, ['team3']);
  assert.equal(check2.eligible, true);
  assert.deepEqual(check2.eligibleTeamIds, ['team4']);

  // Once both used it, neither qualifies again
  const check3 = evaluateComebackEligibility(teams, ['team3', 'team4']);
  assert.equal(check3.eligible, false);
});

test('buildFinalMatchSummary reports tie-aware champions and exact totals', () => {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  teams.team1.score = 850;
  teams.team2.score = 850;
  teams.team3.score = 500;
  teams.team4.score = 300;
  const game: GameState = {
    gameId: 'g-summary',
    name: 'Final Test',
    createdAt: 0,
    updatedAt: 0,
    status: 'completed',
    currentRoundNumber: 10,
    totalRounds: 10,
    currentRoundType: 'group_speed',
    roundSchedule: [],
    teams,
    roundPhase: 'round_ended',
    answers: {},
    privateRoundGroup: {
      isInPrivateGroup: false,
      batchNumber: 0,
      roundIndexInBatch: 0,
      selectedPlayerPerTeam: {},
      participatedStudentsInBatch: { team1: [], team2: [], team3: [], team4: [] },
    },
    globalCardPoolRemaining: getInitialGlobalCardPool(),
    cardsUsedThisRound: { team1: [], team2: [], team3: [], team4: [] },
    activeReactions: [],
    scoreTransactions: [],
    auditLogs: [],
    settings: { ...DEFAULT_SETTINGS },
    roundStats: {
      completedRoundsCount: 10,
      totalQuestionsAnswered: 32,
      correctAnswersCount: 24,
      incorrectAnswersCount: 8,
    },
  };

  const summary = buildFinalMatchSummary(game);
  assert.equal(summary.totalRoundsCompleted, 10);
  assert.equal(summary.totalQuestionsAnswered, 32);
  assert.equal(summary.correctAnswersCount, 24);
  assert.equal(summary.incorrectAnswersCount, 8);
  assert.equal(summary.isTieForFirst, true);
  assert.deepEqual(summary.championTeamIds.sort(), ['team1', 'team2']);
});
