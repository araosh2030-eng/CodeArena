import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  ActiveReaction,
  CardType,
  ComebackBonusRecord,
  GameSettings,
  GameState,
  Question,
  QuestionEffectType,
  ScheduledRound,
  SoundEventType
} from './src/types/game';
import { CARD_DEFINITIONS } from './src/game/defaultData';
import {
  buildFinalMatchSummary,
  calculateAnswerScore,
  calculateCardUnlocks,
  computeQuestionEffectOutcome,
  createInitialComebackState,
  createTeamsFromStudents,
  drawCardFromGlobalPool,
  evaluateComebackEligibility,
  evaluateQuestionAnswer,
  executeAtomicPlayerSwap,
  formatCardTitle,
  generateAutomaticRoundSchedule,
  getLeaderSignature,
  isCardEligibleForRound,
  isQuestionReadyForGame,
  pickComebackQuestion,
  selectPrivateRoundPlayersWithReport,
  selectTeamRivalryPair,
  shouldRevealAnswerResult,
  shouldTriggerTeamRivalryForRound,
  shuffleArray,
  validateCardPlay,
  validateTotalRounds
} from './src/game/rules';
import {
  extractQuestionsFromDocxBuffer,
  extractQuestionsFromPdfBuffer,
  extractQuestionsFromPlainText,
  reprocessQuestionWithAI
} from './src/server/questionExtractor';
import {
  checkAndNotifyScoreMilestones,
  evaluateAndNotifyRankChanges,
  notifyAllTeams,
  notifyConfirmedScoringOutcome,
  notifyQuestionActiveEvents,
  notifyRoundStartEvents,
  pushTeamNotification,
  resetNotificationState
} from './src/game/notifications';
import { NotificationCategory } from './src/types/game';
import { gameStorage, verifyAuthToken } from './src/server/storage';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.use(express.json({ limit: '25mb' }));

interface SseClient {
  res: Response;
  portal?: string;
  teamId?: string;
}

const sseClients: Set<SseClient> = new Set();

function broadcastGameState(state: GameState) {
  let fullPayload: string | null = null;
  for (const client of sseClients) {
    try {
      if (client.portal === 'team') {
        const scoped = gameStorage.getSanitizedStateForTeam(state, client.teamId);
        client.res.write(`data: ${JSON.stringify(scoped)}\n\n`);
      } else {
        if (!fullPayload) {
          fullPayload = `data: ${JSON.stringify(state)}\n\n`;
        }
        client.res.write(fullPayload);
      }
    } catch {
      sseClients.delete(client);
    }
  }
}

function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const userId = verifyAuthToken(token);
  if (!userId) return null;
  return gameStorage.getUserById(userId);
}

function verifyTeamControllerAccess(
  req: Request,
  game: GameState,
  teamId: string
): { ok: true; team: NonNullable<GameState['teams'][string]> } | { ok: false; status: number; error: string } {
  const team = game.teams[teamId];
  if (!team) {
    return { ok: false, status: 404, error: 'Team not found' };
  }
  const user = getAuthenticatedUser(req);
  if (!user) {
    return {
      ok: false,
      status: 401,
      error: 'Authentication token required. Please sign in and select your team.',
    };
  }
  if (!team.activeSession) {
    return {
      ok: false,
      status: 403,
      error: 'No active controller session for this team. Please join the team first.',
    };
  }
  if (team.activeSession.userId !== user.id) {
    return {
      ok: false,
      status: 403,
      error: 'Session invalidated: another device is currently controlling this team.',
    };
  }
  team.activeSession.lastActiveAt = Date.now();
  return { ok: true, team };
}

function emitSoundEvent(
  game: GameState,
  type: SoundEventType,
  meta?: { teamId?: string; label?: string; now?: number }
) {
  const now = meta?.now ?? Date.now();
  if (!game.soundEvents) game.soundEvents = [];
  game.soundEvents.push({
    id: `snd-${now}-${type}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    roundNumber: game.currentRoundNumber || 1,
    timestamp: now,
    teamId: meta?.teamId,
    label: meta?.label,
  });
  if (game.soundEvents.length > 30) {
    game.soundEvents = game.soundEvents.slice(-30);
  }
}

function detectAndEmitLeaderChange(game: GameState, prevLeaderSig: string, now: number) {
  const nextSig = getLeaderSignature(game.teams);
  if (nextSig && nextSig !== prevLeaderSig) {
    emitSoundEvent(game, 'leader_change', { now, label: nextSig });
  }
}

function emitEvaluatedGroupRoundNotifications(
  game: GameState,
  now: number,
  contextKey: string
) {
  for (const teamId of Object.keys(game.teams)) {
    const team = game.teams[teamId];
    const ans = game.answers[teamId];
    if (!team || !ans) continue;

    notifyConfirmedScoringOutcome(game, teamId, {
      now,
      contextKey,
      isCorrect: ans.isCorrect,
      pointsAwarded: ans.pointsAwarded,
      basePoints: ans.basePoints,
      doubledBaseBonus: ans.doubledBaseBonus,
      doublePointsApplied: ans.doublePointsApplied,
      streakBonus: ans.streakBonus,
      prevStreak: ans.prevStreakSnapshot ?? 0,
      newStreak: team.streak,
      effectApplied: ans.effectApplied,
      effectDelta: ans.effectDelta,
      cardsUnlocked: ans.cardsUnlockedSnapshot ?? 0,
    });

    if (ans.isCorrect && ans.pointsAwarded > 0) {
      const prevScore = Math.max(0, team.score - ans.pointsAwarded);
      checkAndNotifyScoreMilestones(game, teamId, prevScore, team.score, now);
    }
  }

  evaluateAndNotifyRankChanges(game, now, contextKey);

  if (game.activeRivalry && !game.activeRivalry.dismissed) {
    const rivPairs = [game.activeRivalry.teamAId, game.activeRivalry.teamBId];
    for (const rTeamId of rivPairs) {
      const oppName =
        rTeamId === game.activeRivalry.teamAId
          ? game.activeRivalry.teamBName
          : game.activeRivalry.teamAName;
      pushTeamNotification(game, rTeamId, {
        eventId: `riv-end-${game.currentRoundNumber}-${rTeamId}`,
        dedupeKey: `riv_end:${game.gameId}:${game.currentRoundNumber}:${rTeamId}`,
        category: 'rivalry',
        priority: 'low',
        tone: 'info',
        emoji: '🏁',
        titleEn: 'Rivalry Round Completed!',
        titleAr: 'انتهت جولة التنافس الخاص!',
        messageEn: `Head-to-head spotlight against ${oppName} finished.`,
        messageAr: `انتهت جولة التنافس أمام ${oppName}.`,
        now,
      });
    }
  }

  notifyAllTeams(game, teamId => ({
    eventId: `round-end-${game.currentRoundNumber}-${teamId}`,
    dedupeKey: `round_end:${game.gameId}:${game.currentRoundNumber}:${teamId}`,
    category: 'rounds',
    priority: 'low',
    tone: 'info',
    emoji: '🏁',
    titleEn: `Round ${game.currentRoundNumber} Completed!`,
    titleAr: `انتهت الجولة ${game.currentRoundNumber}!`,
    messageEn: 'Results are now on the scoreboard.',
    messageAr: 'ظهرت نتائج الجولة على لوحة الصدارة.',
    now,
  }));
}

function maybeTriggerRivalryForRound(game: GameState, now: number) {
  if (!game.rivalryHistory) game.rivalryHistory = [];
  if (shouldTriggerTeamRivalryForRound(game.currentRoundNumber, game.currentRoundType, game.rivalryHistory)) {
    const rivalry = selectTeamRivalryPair(game.teams, game.rivalryHistory, game.currentRoundNumber);
    if (rivalry) {
      game.activeRivalry = rivalry;
      game.rivalryHistory.unshift(rivalry);
      emitSoundEvent(game, 'team_rivalry_intro', { now, label: `${rivalry.teamAName} VS ${rivalry.teamBName}` });
      game.auditLogs.unshift({
        id: `log-riv-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'round',
        messageAr: `تحدي خاص بين الفريقين (مرئي فقط): ${rivalry.teamAName} ضد ${rivalry.teamBName}`,
        messageEn: `Team Rivalry Spotlight (Visual Only): ${rivalry.teamAName} vs ${rivalry.teamBName}`,
      });

      pushTeamNotification(game, rivalry.teamAId, {
        eventId: `riv-start-${game.currentRoundNumber}-${rivalry.teamAId}`,
        dedupeKey: `riv_start:${game.gameId}:${game.currentRoundNumber}:${rivalry.teamAId}`,
        category: 'rivalry',
        priority: 'medium',
        tone: 'warning',
        emoji: '🔥',
        titleEn: 'Team Rivalry Selected!',
        titleAr: 'تم اختيار فريقك لجولة التنافس!',
        messageEn: `Spotlight showdown against ${rivalry.teamBName} this round!`,
        messageAr: `تحدي مباشر بين فريقك وفريق ${rivalry.teamBName} في هذه الجولة!`,
        now,
      });

      pushTeamNotification(game, rivalry.teamBId, {
        eventId: `riv-start-${game.currentRoundNumber}-${rivalry.teamBId}`,
        dedupeKey: `riv_start:${game.gameId}:${game.currentRoundNumber}:${rivalry.teamBId}`,
        category: 'rivalry',
        priority: 'medium',
        tone: 'warning',
        emoji: '🔥',
        titleEn: 'Team Rivalry Selected!',
        titleAr: 'تم اختيار فريقك لجولة التنافس!',
        messageEn: `Spotlight showdown against ${rivalry.teamAName} this round!`,
        messageAr: `تحدي مباشر بين فريقك وفريق ${rivalry.teamAName} في هذه الجولة!`,
        now,
      });
    }
  } else {
    game.activeRivalry = null;
  }
}

function finalizeCompletedMatch(game: GameState, now: number) {
  game.status = 'completed';
  game.roundPhase = 'round_ended';
  game.questionTimerEndsAt = undefined;
  game.cardWindowEndsAt = undefined;
  game.activeRivalry = null;
  const summary = buildFinalMatchSummary(game);
  game.ceremony = {
    ceremonyCompleted: false,
    summary,
  };
  emitSoundEvent(game, 'final_ceremony', { now });
  game.auditLogs.unshift({
    id: `log-fin-${now}`,
    timestamp: now,
    roundNumber: game.currentRoundNumber,
    category: 'game',
    messageAr: summary.isTieForFirst
      ? `اكتملت المسابقة! تعادل في المركز الأول بين: ${summary.championTeamNames.join(' و ')}`
      : `اكتملت المسابقة! الفائز بالمركز الأول: ${summary.championTeamNames[0] || '—'}`,
    messageEn: summary.isTieForFirst
      ? `Competition completed! Shared 1st Place Tie: ${summary.championTeamNames.join(' & ')}`
      : `Competition completed! Champion: ${summary.championTeamNames[0] || '—'}`,
  });

  for (const entry of summary.standings) {
    pushTeamNotification(game, entry.teamId, {
      eventId: `match-end-${entry.teamId}`,
      dedupeKey: `match_end:${game.gameId}:${entry.teamId}`,
      category: 'match_status',
      priority: 'high',
      tone: entry.rank === 1 ? 'positive' : 'info',
      emoji: entry.rank === 1 ? '🏆' : '🎉',
      titleEn: 'The Match Has Ended!',
      titleAr: 'انتهت المسابقة!',
      messageEn: `Final standing: #${entry.rank}${entry.isTiedRank ? ' (tied)' : ''} with ${entry.score} pts. Thank you for competing!`,
      messageAr: `الترتيب النهائي: المركز ${entry.rank}${entry.isTiedRank ? ' (مكرر)' : ''} برصيد ${entry.score} نقطة!`,
      now,
      metadata: { rank: entry.rank, score: entry.score },
    });
  }
}

function activateComebackEventForTeam(
  game: GameState,
  teamId: string,
  scoreDifference: number,
  reason: string,
  now: number
): boolean {
  const team = game.teams[teamId];
  if (!team) return false;
  if (!game.comebackBonus) game.comebackBonus = createInitialComebackState();
  const usedQIds = new Set<string>();
  for (const r of game.comebackBonus.history || []) {
    usedQIds.add(r.assignedQuestionId);
  }
  if (game.currentQuestion?.id) usedQIds.add(game.currentQuestion.id);

  const qBank = gameStorage.getQuestionBank();
  const question = pickComebackQuestion(qBank, usedQIds);
  if (!question) return false;

  const rewardValue = Math.max(50, Math.round(game.settings.comebackBonusPoints ?? 250));
  game.comebackBonus.activeEvent = {
    id: `cb-${now}-${teamId}`,
    roundNumber: game.currentRoundNumber,
    eligibleTeamId: team.id,
    eligibleTeamName: team.name,
    eligibleTeamColor: team.color,
    reason,
    scoreDifferenceAtActivation: scoreDifference,
    rewardValue,
    assignedQuestion: { ...question, questionEffect: 'normal', questionEffectPoints: 0 },
    status: 'announced',
    rewardTransactionStatus: 'pending',
    activatedAt: now,
  };

  emitSoundEvent(game, 'comeback_bonus', { now, teamId: team.id, label: team.name });
  game.auditLogs.unshift({
    id: `log-cb-${now}`,
    timestamp: now,
    roundNumber: game.currentRoundNumber,
    category: 'game',
    messageAr: `فرصة عودة (Comeback Bonus) متاحة لفريق ${team.name} (+${rewardValue} نقطة — الفارق ${scoreDifference} نقطة)!`,
    messageEn: `Comeback Bonus activated for ${team.name} (+${rewardValue} pts reward — trailing by ${scoreDifference} pts).`,
  });

  pushTeamNotification(game, team.id, {
    eventId: `cb-avail-${game.comebackBonus.activeEvent.id}`,
    dedupeKey: `cb_avail:${game.gameId}:${game.comebackBonus.activeEvent.id}:${team.id}`,
    category: 'comeback',
    priority: 'high',
    tone: 'positive',
    emoji: '⚡',
    titleEn: 'Comeback Bonus Opportunity Available!',
    titleAr: 'فرصة عودة (Comeback Bonus) متاحة لفريقك!',
    messageEn: `Answer the bonus question correctly to earn +${rewardValue} pts (0 penalty if wrong).`,
    messageAr: `أجب عن سؤال العودة لتحصل على +${rewardValue} نقطة (بدون خصم عند الخطأ).`,
    now,
    metadata: { rewardValue },
  });
  return true;
}

function buildRoundQuestion(
  baseQ: Question,
  effect: QuestionEffectType | undefined,
  settings: GameSettings
): Question {
  const eff: QuestionEffectType = effect || 'normal';
  const effectPts =
    eff === 'bonus'
      ? settings.questionBonusPoints ?? 50
      : eff === 'minus'
      ? settings.questionMinusPoints ?? 50
      : 0;
  const normalizedType = baseQ.type || (baseQ as unknown as { questionType?: Question['type'] }).questionType || 'multiple_choice';
  const normalizedPoints =
    typeof baseQ.points === 'number'
      ? baseQ.points
      : typeof (baseQ as unknown as { basePoints?: number }).basePoints === 'number'
      ? (baseQ as unknown as { basePoints: number }).basePoints
      : 100;
  return {
    ...baseQ,
    type: normalizedType,
    points: normalizedPoints,
    questionEffect: eff,
    questionEffectPoints: effectPts,
  };
}

function applyUnansweredFallback(
  game: GameState,
  teamId: string,
  responseTimeMs: number,
  now: number
) {
  if (game.answers[teamId]) return game.answers[teamId];
  const team = game.teams[teamId];
  const question = game.currentQuestion;
  let effectApplied: QuestionEffectType = question?.questionEffect || 'normal';
  let effectDelta = 0;

  let prevStreakSnapshot = 0;
  if (team && question) {
    prevStreakSnapshot = team.streak || 0;
    const eff = computeQuestionEffectOutcome({
      effectType: question.questionEffect,
      bonusPoints: question.questionEffectPoints ?? game.settings.questionBonusPoints ?? 50,
      minusPoints: question.questionEffectPoints ?? game.settings.questionMinusPoints ?? 50,
      isCorrect: false,
      currentScore: team.score,
    });
    effectApplied = eff.effectType;
    effectDelta = eff.scoreDelta;
    if (eff.scoreDelta !== 0) {
      const prevScore = team.score;
      team.score = eff.newScore;
      game.scoreTransactions.unshift({
        id: `tx-${now}-${teamId}-eff`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        teamId: team.id,
        teamName: team.name,
        pointsChange: eff.scoreDelta,
        previousScore: prevScore,
        newScore: team.score,
        reasonAr: `تأثير سؤال خصم لعدم الإجابة (${eff.scoreDelta} نقطة)`,
        reasonEn: `Minus Question Effect (${eff.scoreDelta} pts for no/wrong answer)`,
        performedBy: 'server:question_effect',
      });
    }
    team.streak = 0;
  }

  game.answers[teamId] = {
    teamId,
    answer: '',
    submittedAtServerTime: now,
    responseTimeMs,
    isCorrect: false,
    pointsAwarded: 0,
    effectApplied,
    effectDelta,
    correctAnswerSnapshot: question?.correctAnswer,
    prevStreakSnapshot,
    cardsUnlockedSnapshot: 0,
  };

  if (!game.roundStats) {
    game.roundStats = {
      completedRoundsCount: 0,
      totalQuestionsAnswered: 0,
      correctAnswersCount: 0,
      incorrectAnswersCount: 0,
    };
  }
  game.roundStats.totalQuestionsAnswered += 1;
  game.roundStats.incorrectAnswersCount += 1;
  return game.answers[teamId];
}

function setupPrivateRoundState(
  game: GameState,
  scheduled: ScheduledRound | undefined,
  qBank: Question[],
  forceNewBatch: boolean,
  now: number
) {
  const startNewBatch =
    forceNewBatch ||
    !game.privateRoundGroup.isInPrivateGroup ||
    game.privateRoundGroup.roundIndexInBatch >= 5;

  if (startNewBatch) {
    for (const t of Object.values(game.teams)) {
      for (const m of t.members) {
        m.participatedInPrivateRound = false;
      }
    }
    game.privateRoundGroup = {
      isInPrivateGroup: true,
      batchNumber: forceNewBatch ? 1 : (game.privateRoundGroup.batchNumber || 0) + 1,
      roundIndexInBatch: 1,
      selectedPlayerPerTeam: {},
      participatedStudentsInBatch: { team1: [], team2: [], team3: [], team4: [] },
      activeTurnIndex: 0,
      teamOrder: [],
      questionsByTeam: {},
      turnSubmissions: {},
      warnings: [],
    };
  } else {
    game.privateRoundGroup.roundIndexInBatch += 1;
    game.privateRoundGroup.activeTurnIndex = 0;
    game.privateRoundGroup.turnSubmissions = {};
    game.privateRoundGroup.warnings = [];
  }

  const { selected, warnings } = selectPrivateRoundPlayersWithReport(
    game.teams,
    game.privateRoundGroup.participatedStudentsInBatch
  );
  game.privateRoundGroup.selectedPlayerPerTeam = selected;
  game.privateRoundGroup.warnings = warnings;

  for (const [tId, p] of Object.entries(selected)) {
    if (!game.privateRoundGroup.participatedStudentsInBatch[tId]) {
      game.privateRoundGroup.participatedStudentsInBatch[tId] = [];
    }
    if (!game.privateRoundGroup.participatedStudentsInBatch[tId].includes(p.studentId)) {
      game.privateRoundGroup.participatedStudentsInBatch[tId].push(p.studentId);
    }
    const member = game.teams[tId]?.members.find(m => m.studentId === p.studentId);
    if (member) {
      member.participatedInPrivateRound = true;
    }
  }

  for (const w of warnings) {
    game.auditLogs.unshift({
      id: `log-warn-${now}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      roundNumber: game.currentRoundNumber,
      category: 'round',
      messageAr: `تنبيه جولة خاصة: ${w}`,
      messageEn: `Private Round Notice: ${w}`,
    });
  }

  const teamIds = Object.keys(game.teams);
  const teamOrder =
    scheduled?.privateTeamOrder &&
    scheduled.privateTeamOrder.length === teamIds.length &&
    scheduled.privateTeamOrder.every(id => game.teams[id])
      ? [...scheduled.privateTeamOrder]
      : shuffleArray(teamIds);
  game.privateRoundGroup.teamOrder = teamOrder;

  const questionsByTeam: Record<string, Question> = {};
  const usedIds = new Set<string>();
  const shuffledBank = shuffleArray(qBank);

  for (const tId of teamOrder) {
    const slot = scheduled?.privateQuestionsByTeam?.[tId];
    let baseQ = slot ? qBank.find(q => q.id === slot.questionId) : undefined;
    if (!baseQ || (usedIds.has(baseQ.id) && qBank.length > usedIds.size)) {
      baseQ = shuffledBank.find(q => !usedIds.has(q.id)) || qBank[0];
    }
    usedIds.add(baseQ.id);
    questionsByTeam[tId] = buildRoundQuestion(baseQ, slot?.effect ?? 'normal', game.settings);
  }

  game.privateRoundGroup.questionsByTeam = questionsByTeam;
  game.currentQuestion = questionsByTeam[teamOrder[0]] || game.currentQuestion;
  game.roundPhase = 'card_window';
  game.cardWindowEndsAt = now + (game.settings.cardWindowSeconds || 20) * 1000;
  game.questionTimerEndsAt = undefined;
}

// 1-second server heartbeat loop for timers and card reactions
setInterval(() => {
  const game = gameStorage.getCurrentGame();
  let stateChanged = false;
  const now = Date.now();

  // 1. Check Card Window expiration
  if (game.roundPhase === 'card_window' && game.cardWindowEndsAt && now >= game.cardWindowEndsAt) {
    game.roundPhase = 'question_active';
    game.cardWindowEndsAt = undefined;

    let activePrivateTeamId: string | undefined;
    if (game.currentRoundType !== 'private_round') {
      const timerSec =
        game.currentRoundType === 'group_speed'
          ? game.settings.groupSpeedTimerSeconds
          : game.settings.individualTimerSeconds;
      game.questionTimerEndsAt = now + timerSec * 1000;
    } else {
      game.questionTimerEndsAt = undefined;
      const order = game.privateRoundGroup.teamOrder || Object.keys(game.teams);
      const turnIdx = game.privateRoundGroup.activeTurnIndex ?? 0;
      activePrivateTeamId = order[turnIdx];
      if (activePrivateTeamId && game.privateRoundGroup.questionsByTeam?.[activePrivateTeamId]) {
        game.currentQuestion = game.privateRoundGroup.questionsByTeam[activePrivateTeamId];
      }
    }

    emitSoundEvent(game, 'question_reveal', { now });
    game.auditLogs.unshift({
      id: `log-${now}`,
      timestamp: now,
      roundNumber: game.currentRoundNumber,
      category: 'round',
      messageAr: 'انتهت نافذة استخدام الكروت وبدأ وقت الإجابة على السؤال',
      messageEn: 'Card window closed. Question answering is now active.',
    });
    notifyQuestionActiveEvents(game, now, activePrivateTeamId);
    stateChanged = true;
  }

  // 2. Check Question Answer Timer expiration
  if (game.roundPhase === 'question_active' && game.questionTimerEndsAt && now >= game.questionTimerEndsAt) {
    const prevLeaderSig = getLeaderSignature(game.teams);
    game.roundPhase = 'evaluating';
    game.questionTimerEndsAt = undefined;

    for (const teamId of Object.keys(game.teams)) {
      applyUnansweredFallback(game, teamId, game.settings.groupSpeedTimerSeconds * 1000, now);
    }

    detectAndEmitLeaderChange(game, prevLeaderSig, now);
    emitEvaluatedGroupRoundNotifications(game, now, `timeout-${game.currentRoundNumber}`);
    game.auditLogs.unshift({
      id: `log-${now}`,
      timestamp: now,
      roundNumber: game.currentRoundNumber,
      category: 'round',
      messageAr: 'انتهى وقت الإجابة على السؤال وتم كشف النتائج',
      messageEn: 'Question time expired. Results evaluated and revealed.',
    });
    stateChanged = true;
  }

  // 3. Check Active Card Reactions
  if (game.activeReactions && game.activeReactions.length > 0) {
    const expiredReactions = game.activeReactions.filter(
      r => (r.status === 'pending' || r.status === 'waiting_for_response') && now >= r.expiresAt
    );

    if (expiredReactions.length > 0) {
      if (stateChanged) {
        gameStorage.setCurrentGame(game);
        stateChanged = false;
      }

      for (const rxSnapshot of expiredReactions) {
        const rxId = rxSnapshot.id;
        try {
          gameStorage.runAtomicGameMutation(draft => {
            const reaction = draft.activeReactions.find(r => r.id === rxId);
            if (!reaction || (reaction.status !== 'pending' && reaction.status !== 'waiting_for_response')) {
              return;
            }

            const prevLeaderSig = getLeaderSignature(draft.teams);
            const targetTeam = draft.teams[reaction.targetTeamId];
            const initTeam = draft.teams[reaction.initiatingTeamId];

            if (reaction.initiatingCardType === 'player_swap') {
              if (!reaction.targetStudentId || !reaction.exchangeStudentId) {
                reaction.status = 'cancelled';
                reaction.resultMessageEn = 'Player Swap cancelled: both incoming and outgoing players must be selected.';
                reaction.resultMessageAr = 'تم إلغاء تبديل اللاعبين لعدم تحديد كلا اللاعبين للتبادل 1 مقابل 1.';
                pushTeamNotification(draft, reaction.initiatingTeamId, {
                  eventId: `swap-cancel-${rxId}-init`,
                  dedupeKey: `swap_cancel:${rxId}:init`,
                  category: 'player_exchange',
                  priority: 'medium',
                  tone: 'info',
                  emoji: '❌',
                  titleEn: 'Player Swap Cancelled',
                  titleAr: 'تم إلغاء تبديل اللاعبين',
                  messageEn: reaction.resultMessageEn,
                  messageAr: reaction.resultMessageAr,
                  now,
                });
                return;
              }

              const swapRes = executeAtomicPlayerSwap(draft, {
                initiatingTeamId: reaction.initiatingTeamId,
                targetTeamId: reaction.targetTeamId,
                targetStudentId: reaction.targetStudentId,
                exchangeStudentId: reaction.exchangeStudentId,
                requestId: reaction.requestId || reaction.id,
                reactionId: reaction.id,
                now,
              });

              if (swapRes.success && swapRes.incomingStudent && swapRes.outgoingStudent) {
                reaction.status = 'executed';
                reaction.executedAt = now;
                reaction.resultMessageEn = `1-for-1 Swap completed: ${swapRes.incomingStudent.name} (${targetTeam?.name}) ↔ ${swapRes.outgoingStudent.name} (${initTeam?.name}).`;
                reaction.resultMessageAr = `تم التبادل 1 مقابل 1: ${swapRes.incomingStudent.name} (${targetTeam?.name}) ↔ ${swapRes.outgoingStudent.name} (${initTeam?.name}).`;
                emitSoundEvent(draft, 'player_swap', { now, label: reaction.resultMessageEn });
                draft.auditLogs.unshift({
                  id: `log-${now}-${rxId}`,
                  timestamp: now,
                  roundNumber: draft.currentRoundNumber,
                  category: 'card',
                  messageAr: `انتهت مهلة الرد: ${reaction.resultMessageAr}`,
                  messageEn: `Reaction window expired: ${reaction.resultMessageEn}`,
                });

                pushTeamNotification(draft, reaction.initiatingTeamId, {
                  eventId: `swap-done-${rxId}-init`,
                  dedupeKey: `swap_done:${rxId}:init`,
                  category: 'player_exchange',
                  priority: 'high',
                  tone: 'positive',
                  emoji: '🔄',
                  titleEn: 'Player Exchange Completed!',
                  titleAr: 'اكتمل تبديل اللاعبين بنجاح!',
                  messageEn: `${swapRes.incomingStudent.name} joined your team and ${swapRes.outgoingStudent.name} moved to ${targetTeam?.name || 'opponent'}.`,
                  messageAr: `انضم ${swapRes.incomingStudent.name} لفريقك وانتقل ${swapRes.outgoingStudent.name} إلى ${targetTeam?.name || 'المنافس'}.`,
                  now,
                });
                pushTeamNotification(draft, reaction.initiatingTeamId, {
                  eventId: `roster-join-${rxId}-init`,
                  dedupeKey: `roster_join:${rxId}:init`,
                  category: 'team_activity',
                  priority: 'medium',
                  tone: 'positive',
                  emoji: '👤',
                  titleEn: 'New Player Joined Your Team!',
                  titleAr: 'انضم لاعب جديد إلى فريقك!',
                  messageEn: `${swapRes.incomingStudent.name} is now on your roster.`,
                  messageAr: `${swapRes.incomingStudent.name} أصبح الآن ضمن صفوف فريقك.`,
                  now,
                });

                pushTeamNotification(draft, reaction.targetTeamId, {
                  eventId: `swap-done-${rxId}-tgt`,
                  dedupeKey: `swap_done:${rxId}:tgt`,
                  category: 'player_exchange',
                  priority: 'high',
                  tone: 'warning',
                  emoji: '🔄',
                  titleEn: 'Player Exchange Completed!',
                  titleAr: 'تم تنفيذ تبديل اللاعبين!',
                  messageEn: `${swapRes.outgoingStudent.name} joined your team and ${swapRes.incomingStudent.name} moved to ${initTeam?.name || 'opponent'}.`,
                  messageAr: `انضم ${swapRes.outgoingStudent.name} لفريقك وانتقل ${swapRes.incomingStudent.name} إلى ${initTeam?.name || 'المنافس'}.`,
                  now,
                });
                pushTeamNotification(draft, reaction.targetTeamId, {
                  eventId: `roster-leave-${rxId}-tgt`,
                  dedupeKey: `roster_leave:${rxId}:tgt`,
                  category: 'team_activity',
                  priority: 'medium',
                  tone: 'warning',
                  emoji: '👋',
                  titleEn: 'Player Left Your Team',
                  titleAr: 'غادر لاعب صفوف فريقك',
                  messageEn: `${swapRes.incomingStudent.name} moved out in the 1-for-1 exchange.`,
                  messageAr: `غادر ${swapRes.incomingStudent.name} في صفقة التبادل 1 مقابل 1.`,
                  now,
                });
              } else {
                reaction.status = 'cancelled';
                reaction.resultMessageEn = swapRes.error || 'Player became protected or unavailable before swap completed.';
                reaction.resultMessageAr = swapRes.error || 'أصبح أحد اللاعبين محمياً أو غير متاح قبل اكتمال التبادل.';
                if (!draft.swapHistory) draft.swapHistory = [];
                draft.swapHistory.unshift({
                  id: `swap-cancel-${now}`,
                  requestId: reaction.requestId || reaction.id,
                  reactionId: reaction.id,
                  roundNumber: draft.currentRoundNumber,
                  initiatingTeamId: reaction.initiatingTeamId,
                  initiatingTeamName: reaction.initiatingTeamName || reaction.initiatingTeamId,
                  targetTeamId: reaction.targetTeamId,
                  targetTeamName: reaction.targetTeamName || reaction.targetTeamId,
                  incomingPlayerId: reaction.targetStudentId,
                  incomingPlayerName: reaction.targetStudentName || '',
                  outgoingPlayerId: reaction.exchangeStudentId,
                  outgoingPlayerName: reaction.exchangeStudentName || '',
                  status: 'cancelled',
                  timestamp: now,
                  note: reaction.resultMessageEn,
                });
                pushTeamNotification(draft, reaction.initiatingTeamId, {
                  eventId: `swap-cancel-${rxId}-init`,
                  dedupeKey: `swap_cancel:${rxId}:init`,
                  category: 'player_exchange',
                  priority: 'medium',
                  tone: 'info',
                  emoji: '❌',
                  titleEn: 'Player Swap Cancelled',
                  titleAr: 'تم إلغاء تبديل اللاعبين',
                  messageEn: reaction.resultMessageEn,
                  messageAr: reaction.resultMessageAr,
                  now,
                });
                pushTeamNotification(draft, reaction.targetTeamId, {
                  eventId: `swap-cancel-${rxId}-tgt`,
                  dedupeKey: `swap_cancel:${rxId}:tgt`,
                  category: 'player_exchange',
                  priority: 'low',
                  tone: 'info',
                  emoji: '🛡️',
                  titleEn: 'Player Swap Request Cancelled',
                  titleAr: 'تم إلغاء طلب تبديل اللاعبين',
                  messageEn: reaction.resultMessageEn,
                  messageAr: reaction.resultMessageAr,
                  now,
                });
              }
            } else if (reaction.initiatingCardType === 'minus_card') {
              const penalty = reaction.value || 100;
              if (targetTeam) {
                const oldScore = targetTeam.score;
                targetTeam.score = Math.max(0, targetTeam.score - penalty);
                reaction.status = 'executed';
                reaction.executedAt = now;
                reaction.resultMessageEn = `${targetTeam.name} lost ${penalty} pts from Minus Card.`;
                reaction.resultMessageAr = `تم خصم ${penalty} نقطة من ${targetTeam.name} بواسطة Minus Card.`;

                draft.scoreTransactions.unshift({
                  id: `tx-${now}-${rxId}`,
                  timestamp: now,
                  roundNumber: draft.currentRoundNumber,
                  teamId: targetTeam.id,
                  teamName: targetTeam.name,
                  pointsChange: -penalty,
                  previousScore: oldScore,
                  newScore: targetTeam.score,
                  reasonAr: `خصم نقاط بواسطة Minus Card من ${initTeam?.name || 'منافس'}`,
                  reasonEn: `Minus Card penalty applied from ${initTeam?.name || 'Opponent'}`,
                  performedBy: 'card:minus_card',
                });
                detectAndEmitLeaderChange(draft, prevLeaderSig, now);

                pushTeamNotification(draft, targetTeam.id, {
                  eventId: `minus-hit-${rxId}`,
                  dedupeKey: `minus_hit:${rxId}:${targetTeam.id}`,
                  category: 'cards',
                  priority: 'high',
                  tone: 'negative',
                  emoji: '💔',
                  titleEn: `-${penalty} Points! (Minus Card)`,
                  titleAr: `-${penalty} نقطة! (بطاقة خصم)`,
                  messageEn: `${initTeam?.name || 'An opponent'}'s Minus Card deducted ${penalty} pts.`,
                  messageAr: `خصمت بطاقة Minus Card من ${initTeam?.name || 'منافس'} ${penalty} نقطة.`,
                  now,
                });
                pushTeamNotification(draft, reaction.initiatingTeamId, {
                  eventId: `minus-ok-${rxId}`,
                  dedupeKey: `minus_ok:${rxId}:${reaction.initiatingTeamId}`,
                  category: 'cards',
                  priority: 'medium',
                  tone: 'positive',
                  emoji: '✅',
                  titleEn: 'Minus Card Applied!',
                  titleAr: 'تم تطبيق بطاقة الخصم!',
                  messageEn: `${targetTeam.name} lost ${penalty} pts.`,
                  messageAr: `تم خصم ${penalty} نقطة من ${targetTeam.name}.`,
                  now,
                });
                evaluateAndNotifyRankChanges(draft, now, `minus-${rxId}`);
              }
            } else if (reaction.initiatingCardType === 'card_steal') {
              if (targetTeam && initTeam && targetTeam.secretCards.length > 0) {
                const stealIdx = Math.floor(Math.random() * targetTeam.secretCards.length);
                const [stolenCard] = targetTeam.secretCards.splice(stealIdx, 1);
                initTeam.secretCards.push(stolenCard);
                reaction.status = 'executed';
                reaction.executedAt = now;
                reaction.resultMessageEn = `${initTeam.name} stole a secret card from ${targetTeam.name}.`;
                reaction.resultMessageAr = `قام ${initTeam.name} بسرقة كارت سري من ${targetTeam.name}.`;

                draft.auditLogs.unshift({
                  id: `log-${now}-${rxId}`,
                  timestamp: now,
                  roundNumber: draft.currentRoundNumber,
                  category: 'card',
                  messageAr: reaction.resultMessageAr,
                  messageEn: reaction.resultMessageEn,
                });

                pushTeamNotification(draft, targetTeam.id, {
                  eventId: `steal-hit-${rxId}`,
                  dedupeKey: `steal_hit:${rxId}:${targetTeam.id}`,
                  category: 'cards',
                  priority: 'high',
                  tone: 'negative',
                  emoji: '🕵️',
                  titleEn: 'A Card Was Stolen From Your Team!',
                  titleAr: 'تمت سرقة كارت من فريقك!',
                  messageEn: `${initTeam.name} stole one of your secret cards.`,
                  messageAr: `استولى فريق ${initTeam.name} على أحد كروتك السرية.`,
                  now,
                });
                pushTeamNotification(draft, initTeam.id, {
                  eventId: `steal-ok-${rxId}`,
                  dedupeKey: `steal_ok:${rxId}:${initTeam.id}`,
                  category: 'cards',
                  priority: 'medium',
                  tone: 'positive',
                  emoji: '🃏',
                  titleEn: 'Card Steal Succeeded!',
                  titleAr: 'نجحت سرقة الكارت!',
                  messageEn: `Acquired "${formatCardTitle(stolenCard)}" from ${targetTeam.name}.`,
                  messageAr: `حصلت على كارت "${formatCardTitle(stolenCard)}" من ${targetTeam.name}.`,
                  now,
                });
              } else {
                reaction.status = 'cancelled';
                reaction.resultMessageEn = 'Target team had no secret cards remaining to steal.';
                reaction.resultMessageAr = 'لم يعد لدى الفريق المستهدف كروت متاحة للسرقة.';
                pushTeamNotification(draft, reaction.initiatingTeamId, {
                  eventId: `steal-miss-${rxId}`,
                  dedupeKey: `steal_miss:${rxId}:${reaction.initiatingTeamId}`,
                  category: 'cards',
                  priority: 'low',
                  tone: 'info',
                  emoji: '🔍',
                  titleEn: 'Card Steal Failed',
                  titleAr: 'لم تنجح سرقة الكارت',
                  messageEn: reaction.resultMessageEn,
                  messageAr: reaction.resultMessageAr,
                  now,
                });
              }
            } else {
              reaction.status = 'expired';
            }
          });
          broadcastGameState(gameStorage.getCurrentGame());
        } catch (err) {
          console.error('[Heartbeat Reaction Execution Error]:', err);
        }
      }
      return;
    }
  }

  if (stateChanged) {
    gameStorage.setCurrentGame(game);
    broadcastGameState(game);
  }
}, 1000);

// SSE Real-Time Event Stream (Role- and Team-scoped)
app.get('/api/events', (req: Request, res: Response) => {
  const portal = req.query.portal as string | undefined;
  const teamId = req.query.teamId as string | undefined;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const current = gameStorage.getCurrentGame();
  const initialPayload =
    portal === 'team' ? gameStorage.getSanitizedStateForTeam(current, teamId) : current;
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

  const client: SseClient = { res, portal, teamId };
  sseClients.add(client);

  req.on('close', () => {
    sseClients.delete(client);
  });
});

// GET current game state (respects ?portal=team&teamId=... sanitization)
app.get('/api/game', (req: Request, res: Response) => {
  const portal = req.query.portal as string | undefined;
  const teamId = req.query.teamId as string | undefined;
  const current = gameStorage.getCurrentGame();
  if (portal === 'team') {
    res.json(gameStorage.getSanitizedStateForTeam(current, teamId));
    return;
  }
  res.json(current);
});

// Independent Account System Endpoints
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { email, password, displayName } = req.body;
  const result = gameStorage.registerUser(email, password, displayName);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, user: result.user, token: result.token });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  const result = gameStorage.loginUser(email, password);
  if (!result) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  res.json({ success: true, user: result.user, token: result.token });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({ user });
});

// Available Teams for Post-Login Selection (reads dynamic 4 teams without leaking secret cards)
app.get('/api/game/teams/available', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const teamsSummary = Object.values(game.teams || {}).map((team, idx) => ({
    teamId: team.id,
    teamNumber: idx + 1,
    name: team.name,
    color: team.color,
    leaderStudentId: team.leaderStudentId,
    leaderName: team.leaderName,
    membersCount: team.members.length,
    members: team.members,
    score: team.score,
    hasActiveSession: !!team.activeSession,
    activeSessionOperator: team.activeSession?.operatorName || team.activeSession?.userEmail || null,
    activeSessionUserId: team.activeSession?.userId || null,
  }));

  res.json({
    gameId: game.gameId,
    gameName: game.name,
    status: game.status,
    teams: teamsSummary,
  });
});

// Join or Take Over a Team Session (never alters official team roster or official leader)
app.post('/api/game/team/join', (req: Request, res: Response) => {
  const { teamId, operatorName, forceTakeover } = req.body;
  let user = getAuthenticatedUser(req);

  if (!user && req.body.userId) {
    user = gameStorage.getUserById(req.body.userId);
  }

  if (!user) {
    res.status(401).json({ error: 'Authentication required before selecting a team.' });
    return;
  }

  const result = gameStorage.joinTeamSession({
    teamId,
    user,
    operatorName,
    forceTakeover: !!forceTakeover,
  });

  if (!result.success) {
    res.status(result.conflict ? 409 : 400).json(result);
    return;
  }

  broadcastGameState(gameStorage.getCurrentGame());
  res.json({ success: true, teamId, session: result.session });
});

app.post('/api/game/team/leave', (req: Request, res: Response) => {
  const { teamId } = req.body;
  let user = getAuthenticatedUser(req);
  if (!user && req.body.userId) {
    user = gameStorage.getUserById(req.body.userId);
  }
  if (!user || !teamId) {
    res.status(400).json({ error: 'Valid session and teamId required' });
    return;
  }

  gameStorage.leaveTeamSession(teamId, user.id);
  broadcastGameState(gameStorage.getCurrentGame());
  res.json({ success: true });
});

// Wizard Endpoints
app.post('/api/game/wizard/start', (_req: Request, res: Response) => {
  const wizardGame = gameStorage.startNewGameWizard();
  broadcastGameState(wizardGame);
  res.json(wizardGame);
});

app.post('/api/game/wizard/step', (req: Request, res: Response) => {
  const { step, leaderIds, uploadedQuestions, settings } = req.body;
  const game = gameStorage.getCurrentGame();

  if (!game.wizard) {
    game.wizard = {
      step: 1,
      selectedLeaderIds: [],
      uploadedQuestions: [],
      questionValidationWarnings: [],
      isTeamsGenerated: false,
    };
  }

  if (step !== undefined) game.wizard.step = step;
  if (leaderIds) game.wizard.selectedLeaderIds = leaderIds;
  if (uploadedQuestions) game.wizard.uploadedQuestions = uploadedQuestions;
  if (settings) game.settings = { ...game.settings, ...settings };

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json(game);
});

app.post('/api/game/wizard/generate-teams', (req: Request, res: Response) => {
  const { leaderIds } = req.body;
  const game = gameStorage.getCurrentGame();
  const students = gameStorage.getStudents();

  if (!leaderIds || leaderIds.length !== 4) {
    res.status(400).json({ error: 'Exactly 4 distinct leader IDs must be selected' });
    return;
  }

  const generatedTeams = createTeamsFromStudents(students, leaderIds);
  game.teams = generatedTeams;
  if (!game.wizard) {
    game.wizard = {
      step: 2,
      selectedLeaderIds: leaderIds,
      uploadedQuestions: [],
      questionValidationWarnings: [],
      isTeamsGenerated: true,
    };
  } else {
    game.wizard.selectedLeaderIds = leaderIds;
    game.wizard.isTeamsGenerated = true;
    game.wizard.step = 2;
  }

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json({ success: true, teams: generatedTeams, game });
});

app.post('/api/game/wizard/finish', (req: Request, res: Response) => {
  const { totalRounds, settings, approvedQuestions } = req.body;
  const game = gameStorage.getCurrentGame();

  const validApproved = (approvedQuestions || []).filter(isQuestionReadyForGame);

  if (validApproved.length === 0) {
    res.status(400).json({
      error: 'At least one approved, verified question with a valid answer is required to start.',
    });
    return;
  }

  const candidateRounds = totalRounds ?? settings?.totalRounds ?? game.settings.totalRounds ?? 50;
  const roundsCheck = validateTotalRounds(candidateRounds);
  if (!roundsCheck.valid) {
    res.status(400).json({ error: roundsCheck.error || 'Total rounds must be between 1 and 70.' });
    return;
  }

  gameStorage.setQuestionBank(validApproved);

  if (settings) {
    game.settings = { ...game.settings, ...settings };
  }
  const roundsCount = roundsCheck.rounds;
  game.totalRounds = roundsCount;
  game.settings.totalRounds = roundsCount;

  const { schedule, warnings } = generateAutomaticRoundSchedule(roundsCount, validApproved, {
    teamIds: Object.keys(game.teams).length === 4 ? Object.keys(game.teams) : undefined,
    bonusChancePercent: game.settings.questionBonusChancePercent,
    minusChancePercent: game.settings.questionMinusChancePercent,
  });
  game.roundSchedule = schedule;

  const firstScheduled = schedule[0];
  if (firstScheduled) {
    game.currentRoundNumber = 1;
    game.currentRoundType = firstScheduled.roundType;
    const baseQ =
      validApproved.find((q: Question) => q.id === firstScheduled.questionId) || validApproved[0];
    game.currentQuestion = buildRoundQuestion(baseQ, firstScheduled.questionEffect, game.settings);
  }

  game.status = 'ready';
  if (game.wizard) {
    game.wizard.step = 6;
    game.wizard.uploadedQuestions = validApproved;
    game.wizard.questionValidationWarnings = warnings;
  }
  game.sessionJoinUrl = `/play?gameId=${game.gameId}`;

  gameStorage.setCurrentGame(game);
  gameStorage.saveCurrentGame();
  broadcastGameState(game);
  res.json(game);
});

// Competition Lifecycle
app.post('/api/game/start-competition', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const qBank = gameStorage.getQuestionBank();
  if (qBank.length === 0) {
    res.status(400).json({ error: 'Cannot start competition without an uploaded Question Bank.' });
    return;
  }

  const now = Date.now();
  game.status = 'in_progress';
  game.currentRoundNumber = 1;

  const scheduled = game.roundSchedule[0];
  if (scheduled) {
    game.currentRoundType = scheduled.roundType;
    const baseQ = qBank.find(q => q.id === scheduled.questionId) || qBank[0];
    game.currentQuestion = buildRoundQuestion(baseQ, scheduled.questionEffect, game.settings);
  }

  game.answers = {};
  game.roundStats = {
    completedRoundsCount: 0,
    totalQuestionsAnswered: 0,
    correctAnswersCount: 0,
    incorrectAnswersCount: 0,
  };
  game.cardsUsedThisRound = { team1: [], team2: [], team3: [], team4: [] };
  game.activeDoublePointsByTeam = {};
  game.activeReactions = [];
  game.swapHistory = [];
  game.processedSwapRequestIds = [];
  game.pendingGiftDrafts = {};
  game.activeRivalry = null;
  game.rivalryHistory = [];
  game.comebackBonus = createInitialComebackState();
  game.ceremony = null;
  resetNotificationState(game);

  emitSoundEvent(game, 'match_start', { now });

  if (game.currentRoundType === 'private_round') {
    setupPrivateRoundState(game, scheduled, qBank, true, now);
    emitSoundEvent(game, 'private_round_intro', { now });
  } else {
    emitSoundEvent(game, 'round_start', { now });
    if (game.settings.cardWindowScope === 'all_rounds') {
      game.roundPhase = 'card_window';
      game.cardWindowEndsAt = now + (game.settings.cardWindowSeconds || 20) * 1000;
      game.questionTimerEndsAt = undefined;
    } else {
      game.roundPhase = 'question_active';
      game.cardWindowEndsAt = undefined;
      const timerSec =
        game.currentRoundType === 'group_speed'
          ? game.settings.groupSpeedTimerSeconds
          : game.settings.individualTimerSeconds;
      game.questionTimerEndsAt = now + timerSec * 1000;
      emitSoundEvent(game, 'question_reveal', { now });
    }
    maybeTriggerRivalryForRound(game, now);
  }

  notifyRoundStartEvents(game, now);
  if (game.roundPhase === 'question_active') {
    notifyQuestionActiveEvents(game, now);
  }

  game.auditLogs.unshift({
    id: `log-${now}`,
    timestamp: now,
    roundNumber: 1,
    category: 'round',
    messageAr: `انطلقت المسابقة! الجولة 1: ${game.currentRoundType}`,
    messageEn: `Competition started! Round 1: ${game.currentRoundType}`,
  });

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json(game);
});

// Teacher manually triggers evaluation / answer reveal (especially for untimed Private Rounds or early finish)
app.post('/api/game/round/evaluate', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const now = Date.now();

  if (game.roundPhase === 'card_window') {
    game.roundPhase = 'question_active';
    game.cardWindowEndsAt = undefined;
    let activePrivateTeamId: string | undefined;
    if (game.currentRoundType !== 'private_round') {
      const timerSec =
        game.currentRoundType === 'group_speed'
          ? game.settings.groupSpeedTimerSeconds
          : game.settings.individualTimerSeconds;
      game.questionTimerEndsAt = now + timerSec * 1000;
    } else {
      game.questionTimerEndsAt = undefined;
      const order = game.privateRoundGroup.teamOrder || Object.keys(game.teams);
      const turnIdx = game.privateRoundGroup.activeTurnIndex ?? 0;
      activePrivateTeamId = order[turnIdx];
      if (activePrivateTeamId && game.privateRoundGroup.questionsByTeam?.[activePrivateTeamId]) {
        game.currentQuestion = game.privateRoundGroup.questionsByTeam[activePrivateTeamId];
      }
    }
    emitSoundEvent(game, 'question_reveal', { now });
    notifyQuestionActiveEvents(game, now, activePrivateTeamId);
    gameStorage.setCurrentGame(game);
    broadcastGameState(game);
    res.json(game);
    return;
  }

  const prevLeaderSig = getLeaderSignature(game.teams);
  game.roundPhase = 'evaluating';
  game.questionTimerEndsAt = undefined;

  if (game.currentRoundType === 'private_round') {
    const order = game.privateRoundGroup.teamOrder || Object.keys(game.teams);
    const turnIdx = game.privateRoundGroup.activeTurnIndex ?? 0;
    const activeTeamId = order[turnIdx];
    if (activeTeamId) {
      applyUnansweredFallback(game, activeTeamId, 0, now);
      if (!game.privateRoundGroup.turnSubmissions) {
        game.privateRoundGroup.turnSubmissions = {};
      }
      const activeAns = game.answers[activeTeamId];
      if (activeAns) {
        game.privateRoundGroup.turnSubmissions[activeTeamId] = activeAns;
        const activeTeam = game.teams[activeTeamId];
        notifyConfirmedScoringOutcome(game, activeTeamId, {
          now,
          contextKey: `priv-eval-${game.currentRoundNumber}-${activeTeamId}`,
          isCorrect: activeAns.isCorrect,
          pointsAwarded: activeAns.pointsAwarded,
          basePoints: activeAns.basePoints,
          doubledBaseBonus: activeAns.doubledBaseBonus,
          doublePointsApplied: activeAns.doublePointsApplied,
          streakBonus: activeAns.streakBonus,
          prevStreak: activeAns.prevStreakSnapshot ?? 0,
          newStreak: activeTeam?.streak ?? 0,
          effectApplied: activeAns.effectApplied,
          effectDelta: activeAns.effectDelta,
          cardsUnlocked: activeAns.cardsUnlockedSnapshot ?? 0,
        });
        if (activeTeam && activeAns.isCorrect && activeAns.pointsAwarded > 0) {
          checkAndNotifyScoreMilestones(
            game,
            activeTeamId,
            Math.max(0, activeTeam.score - activeAns.pointsAwarded),
            activeTeam.score,
            now
          );
        }
        evaluateAndNotifyRankChanges(game, now, `priv-eval-${game.currentRoundNumber}-${activeTeamId}`);
      }
    }
    if (turnIdx >= order.length - 1) {
      notifyAllTeams(game, tId => ({
        eventId: `round-end-${game.currentRoundNumber}-${tId}`,
        dedupeKey: `round_end:${game.gameId}:${game.currentRoundNumber}:${tId}`,
        category: 'private_rounds',
        priority: 'low',
        tone: 'info',
        emoji: '🏁',
        titleEn: `Private Round ${game.currentRoundNumber} Completed!`,
        titleAr: `انتهت الجولة الخاصة ${game.currentRoundNumber}!`,
        messageEn: 'All sequential turns have concluded.',
        messageAr: 'اكتملت أدوار جميع الفرق في هذه الجولة.',
        now,
      }));
    }
  } else {
    for (const teamId of Object.keys(game.teams)) {
      applyUnansweredFallback(game, teamId, 0, now);
    }
    emitEvaluatedGroupRoundNotifications(game, now, `manual-eval-${game.currentRoundNumber}`);
  }

  detectAndEmitLeaderChange(game, prevLeaderSig, now);
  game.auditLogs.unshift({
    id: `log-${now}`,
    timestamp: now,
    roundNumber: game.currentRoundNumber,
    category: 'round',
    messageAr: `تم تقييم وكشف إجابات الجولة ${game.currentRoundNumber}`,
    messageEn: `Round ${game.currentRoundNumber} answers evaluated and revealed.`,
  });

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json(game);
});

function advancePrivateRoundTurn(game: GameState, now: number): boolean {
  if (game.currentRoundType !== 'private_round') return false;
  const order = game.privateRoundGroup.teamOrder || Object.keys(game.teams);
  const currentIdx = game.privateRoundGroup.activeTurnIndex ?? 0;
  if (currentIdx >= order.length - 1) return false;

  // Ensure current turn has a submission entry if skipped/forced
  const currentTeamId = order[currentIdx];
  if (currentTeamId && !game.answers[currentTeamId]) {
    const skippedAns = applyUnansweredFallback(game, currentTeamId, 0, now);
    if (!game.privateRoundGroup.turnSubmissions) {
      game.privateRoundGroup.turnSubmissions = {};
    }
    game.privateRoundGroup.turnSubmissions[currentTeamId] = skippedAns;
    if (skippedAns) {
      notifyConfirmedScoringOutcome(game, currentTeamId, {
        now,
        contextKey: `priv-skip-${game.currentRoundNumber}-${currentTeamId}`,
        isCorrect: skippedAns.isCorrect,
        pointsAwarded: skippedAns.pointsAwarded,
        effectApplied: skippedAns.effectApplied,
        effectDelta: skippedAns.effectDelta,
        prevStreak: skippedAns.prevStreakSnapshot ?? 0,
        newStreak: game.teams[currentTeamId]?.streak ?? 0,
        cardsUnlocked: 0,
      });
      evaluateAndNotifyRankChanges(game, now, `priv-skip-${game.currentRoundNumber}-${currentTeamId}`);
    }
  }

  const nextIdx = currentIdx + 1;
  game.privateRoundGroup.activeTurnIndex = nextIdx;
  const nextTeamId = order[nextIdx];
  const nextQuestion = game.privateRoundGroup.questionsByTeam?.[nextTeamId];
  if (nextQuestion) {
    game.currentQuestion = nextQuestion;
  }

  game.roundPhase = 'question_active';
  game.cardWindowEndsAt = undefined;
  game.questionTimerEndsAt = undefined;

  const nextTeamName = game.teams[nextTeamId]?.name || nextTeamId;
  const nextStudentName = game.privateRoundGroup.selectedPlayerPerTeam?.[nextTeamId]?.name || 'Participant';

  notifyQuestionActiveEvents(game, now, nextTeamId);

  game.auditLogs.unshift({
    id: `log-${now}`,
    timestamp: now,
    roundNumber: game.currentRoundNumber,
    category: 'round',
    messageAr: `الدور ${nextIdx + 1} من ${order.length} في الجولة الخاصة: ${nextTeamName} (${nextStudentName})`,
    messageEn: `Private Round Turn ${nextIdx + 1}/${order.length}: ${nextTeamName} (${nextStudentName}) is now answering.`,
  });

  return true;
}

app.post('/api/game/round/next-turn', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const now = Date.now();
  if (!advancePrivateRoundTurn(game, now)) {
    res.status(400).json({ error: 'All sequential participant turns in this Private Round are complete.' });
    return;
  }
  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json(game);
});

app.post('/api/game/round/continue', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const now = Date.now();

  if (game.status === 'completed') {
    res.json(game);
    return;
  }

  // Never override an active unresolved Comeback Bonus or pending Reaction Window
  if (!game.comebackBonus) game.comebackBonus = createInitialComebackState();
  const activeCb = game.comebackBonus.activeEvent;
  if (activeCb && activeCb.status !== 'resolved') {
    res.status(400).json({
      error: `Resolve or skip the active Comeback Bonus for ${activeCb.eligibleTeamName} before continuing to the next round.`,
    });
    return;
  }

  const hasPendingReaction = (game.activeReactions || []).some(
    r => r.status === 'pending' || r.status === 'waiting_for_response'
  );
  if (hasPendingReaction) {
    res.status(400).json({ error: 'Cannot advance while an active Card Reaction Window is still open.' });
    return;
  }

  // Handle sequential Comeback Bonus queue (for tied last-place teams) cleanly between rounds
  if (activeCb?.status === 'resolved') {
    game.comebackBonus.activeEvent = null;
    if (game.comebackBonus.queuedTeamIds.length > 0) {
      const nextQueuedTeamId = game.comebackBonus.queuedTeamIds.shift()!;
      if (!game.comebackBonus.usedTeamIds.includes(nextQueuedTeamId)) {
        const diff = activeCb.scoreDifferenceAtActivation;
        if (activateComebackEventForTeam(game, nextQueuedTeamId, diff, activeCb.reason, now)) {
          gameStorage.setCurrentGame(game);
          broadcastGameState(game);
          res.json(game);
          return;
        }
      }
    }
  } else {
    // Inside a Private Round, advance sequentially through turns 1 -> 2 -> 3 -> 4 before ending round
    if (advancePrivateRoundTurn(game, now)) {
      emitSoundEvent(game, 'question_reveal', { now });
      gameStorage.setCurrentGame(game);
      broadcastGameState(game);
      res.json(game);
      return;
    }

    if (!game.roundStats) {
      game.roundStats = {
        completedRoundsCount: 0,
        totalQuestionsAnswered: 0,
        correctAnswersCount: 0,
        incorrectAnswersCount: 0,
      };
    }
    game.roundStats.completedRoundsCount = Math.max(
      game.roundStats.completedRoundsCount,
      game.currentRoundNumber
    );
  }

  const nextRoundNumber = game.currentRoundNumber + 1;

  if (nextRoundNumber > game.totalRounds) {
    finalizeCompletedMatch(game, now);
    gameStorage.setCurrentGame(game);
    gameStorage.saveCurrentGame();
    broadcastGameState(game);
    res.json(game);
    return;
  }

  const scheduledNext = game.roundSchedule[nextRoundNumber - 1];
  const nextIsPrivate = scheduledNext?.roundType === 'private_round';

  // Between rounds (outside Private Rounds and active questions): check Comeback Bonus eligibility
  if (!activeCb && !nextIsPrivate && game.roundPhase !== 'question_active') {
    const cbCheck = evaluateComebackEligibility(game.teams, game.comebackBonus.usedTeamIds);
    if (cbCheck.eligible && cbCheck.eligibleTeamIds.length > 0) {
      const [firstTeamId, ...restQueue] = cbCheck.eligibleTeamIds;
      game.comebackBonus.queuedTeamIds = restQueue;
      if (activateComebackEventForTeam(game, firstTeamId, cbCheck.scoreDifference, cbCheck.reason, now)) {
        game.roundPhase = 'round_ended';
        gameStorage.setCurrentGame(game);
        broadcastGameState(game);
        res.json(game);
        return;
      }
    }
  }

  game.currentRoundNumber = nextRoundNumber;
  const qBank = gameStorage.getQuestionBank();

  if (scheduledNext) {
    game.currentRoundType = scheduledNext.roundType;
    const baseQ = qBank.find(q => q.id === scheduledNext.questionId) || qBank[0];
    game.currentQuestion = buildRoundQuestion(baseQ, scheduledNext.questionEffect, game.settings);
  }

  game.answers = {};
  game.cardsUsedThisRound = { team1: [], team2: [], team3: [], team4: [] };
  game.activeDoublePointsByTeam = {};
  game.activeReactions = [];
  game.pendingGiftDrafts = {};
  game.activeRivalry = null;
  for (const team of Object.values(game.teams)) {
    team.wasInspectedBy = undefined;
  }

  if (game.currentRoundType === 'private_round') {
    setupPrivateRoundState(game, scheduledNext, qBank, false, now);
    emitSoundEvent(game, 'private_round_intro', { now });
  } else {
    if (game.privateRoundGroup.isInPrivateGroup) {
      game.privateRoundGroup.isInPrivateGroup = false;
      game.privateRoundGroup.activeTurnIndex = 0;
      game.privateRoundGroup.questionsByTeam = {};
      game.privateRoundGroup.turnSubmissions = {};
    }
    emitSoundEvent(game, 'round_start', { now });
    if (game.settings.cardWindowScope === 'all_rounds') {
      game.roundPhase = 'card_window';
      game.cardWindowEndsAt = now + (game.settings.cardWindowSeconds || 20) * 1000;
      game.questionTimerEndsAt = undefined;
    } else {
      game.roundPhase = 'question_active';
      game.cardWindowEndsAt = undefined;
      const timerSec =
        game.currentRoundType === 'group_speed'
          ? game.settings.groupSpeedTimerSeconds
          : game.settings.individualTimerSeconds;
      game.questionTimerEndsAt = now + timerSec * 1000;
      emitSoundEvent(game, 'question_reveal', { now });
    }
    maybeTriggerRivalryForRound(game, now);
  }

  notifyRoundStartEvents(game, now);
  if (game.roundPhase === 'question_active') {
    notifyQuestionActiveEvents(game, now);
  }

  game.status = 'in_progress';
  game.auditLogs.unshift({
    id: `log-${now}`,
    timestamp: now,
    roundNumber: nextRoundNumber,
    category: 'round',
    messageAr: `الانتقال التلقائي إلى الجولة ${nextRoundNumber} (${game.currentRoundType})`,
    messageEn: `Advanced to Round ${nextRoundNumber} (${game.currentRoundType})`,
  });

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json(game);
});

// Team Rivalry dismissal (visual only)
app.post('/api/game/rivalry/dismiss', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  if (game.activeRivalry) {
    game.activeRivalry.dismissed = true;
    gameStorage.setCurrentGame(game);
    broadcastGameState(game);
  }
  res.json({ success: true });
});

// Comeback Bonus Control Endpoints
app.post('/api/game/comeback/start', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const active = game.comebackBonus?.activeEvent;
  if (!active || active.status !== 'announced') {
    res.status(400).json({ error: 'No announced Comeback Bonus waiting to launch.' });
    return;
  }
  const now = Date.now();
  active.status = 'question_active';
  emitSoundEvent(game, 'question_reveal', { now, teamId: active.eligibleTeamId });
  pushTeamNotification(game, active.eligibleTeamId, {
    eventId: `cb-active-${active.id}`,
    dedupeKey: `cb_active:${game.gameId}:${active.id}:${active.eligibleTeamId}`,
    category: 'comeback',
    priority: 'high',
    tone: 'info',
    emoji: '⚡',
    titleEn: 'Your Comeback Question Is Live!',
    titleAr: 'سؤال العودة معروض الآن!',
    messageEn: `Answer correctly for +${active.rewardValue} pts (zero penalty if wrong).`,
    messageAr: `أجب بشكل صحيح لتحصل على +${active.rewardValue} نقطة.`,
    now,
  });
  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json(game);
});

app.post('/api/game/comeback/answer', (req: Request, res: Response) => {
  const { teamId, answer } = req.body;
  const game = gameStorage.getCurrentGame();
  const now = Date.now();

  const access = verifyTeamControllerAccess(req, game, teamId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const team = access.team;
  const cbState = game.comebackBonus;
  const active = cbState?.activeEvent;

  if (!cbState || !active) {
    res.status(400).json({ error: 'No active Comeback Bonus event.' });
    return;
  }
  if (active.eligibleTeamId !== teamId) {
    res.status(403).json({ error: `Only ${active.eligibleTeamName} is eligible to answer this Comeback Question.` });
    return;
  }
  if (active.status !== 'question_active') {
    res.status(400).json({ error: 'Comeback Question has already been answered or is not active yet.' });
    return;
  }

  const prevLeaderSig = getLeaderSignature(game.teams);
  const evalResult = evaluateQuestionAnswer(active.assignedQuestion, String(answer ?? ''));
  const isCorrect = evalResult.isCorrect;

  active.answerSubmitted = String(answer ?? '');
  active.answerResult = isCorrect ? 'correct' : 'incorrect';
  active.resolvedAt = now;
  active.status = 'resolved';

  if (!cbState.usedTeamIds.includes(teamId)) {
    cbState.usedTeamIds.push(teamId);
  }

  if (isCorrect) {
    const reward = active.rewardValue;
    const prevScore = team.score;
    team.score += reward;
    active.rewardTransactionStatus = 'awarded';

    const unlocked = calculateCardUnlocks(prevScore, team.score, game.settings.pointsPer200ForCard);
    if (unlocked > 0) {
      team.pointsAccumulatedForCards += unlocked;
    }

    game.scoreTransactions.unshift({
      id: `tx-cb-${now}`,
      timestamp: now,
      roundNumber: game.currentRoundNumber,
      teamId: team.id,
      teamName: team.name,
      pointsChange: reward,
      previousScore: prevScore,
      newScore: team.score,
      reasonAr: `مكافأة فرصة العودة (Comeback Bonus: +${reward} نقطة)`,
      reasonEn: `Comeback Bonus rewarded (+${reward} pts)`,
      performedBy: 'comeback_bonus',
      breakdown: { comebackPoints: reward },
    });
    emitSoundEvent(game, 'correct_answer', { now, teamId });
    detectAndEmitLeaderChange(game, prevLeaderSig, now);

    pushTeamNotification(game, teamId, {
      eventId: `cb-win-${active.id}`,
      dedupeKey: `cb_res:${active.id}:${teamId}:win`,
      category: 'comeback',
      priority: 'high',
      tone: 'positive',
      emoji: '⚡',
      titleEn: `Comeback Bonus Earned! (+${reward} pts)`,
      titleAr: `نجحت في سؤال العودة! (+${reward} نقطة)`,
      messageEn: `Amazing recovery! New score: ${team.score} pts.`,
      messageAr: `تعويض رائع! رصيدك الآن ${team.score} نقطة.`,
      now,
      metadata: { reward },
    });
    if (unlocked > 0) {
      pushTeamNotification(game, teamId, {
        eventId: `cb-unlock-${active.id}`,
        dedupeKey: `cb_unlock:${active.id}:${teamId}`,
        category: 'cards',
        priority: 'medium',
        tone: 'positive',
        emoji: '✨',
        titleEn: `Card Draw Unlocked! (${unlocked})`,
        titleAr: `تم فتح فرصة سحب كارت! (${unlocked})`,
        messageEn: 'Open your Cards drawer to draw your mystery card!',
        messageAr: 'افتح قائمة الكروت لسحب الكارت الغامض الخاص بك!',
        now,
      });
    }
    checkAndNotifyScoreMilestones(game, teamId, prevScore, team.score, now);
    evaluateAndNotifyRankChanges(game, now, `cb-${active.id}`);
  } else {
    active.rewardTransactionStatus = 'none';
    emitSoundEvent(game, 'incorrect_answer', { now, teamId });
    pushTeamNotification(game, teamId, {
      eventId: `cb-miss-${active.id}`,
      dedupeKey: `cb_res:${active.id}:${teamId}:miss`,
      category: 'comeback',
      priority: 'low',
      tone: 'info',
      emoji: '⚡',
      titleEn: 'Comeback Bonus Missed (No Penalty)',
      titleAr: 'لم توفق في سؤال العودة (بدون خصم)',
      messageEn: '0 points awarded and no points lost. Keep pushing in the next round!',
      messageAr: 'لم يتم احتساب نقاط أو خصم أي رصيد. بالتوفيق في الجولة القادمة!',
      now,
    });
  }

  const record: ComebackBonusRecord = {
    id: active.id,
    roundNumber: active.roundNumber,
    eligibleTeamId: team.id,
    eligibleTeamName: team.name,
    reason: active.reason,
    scoreDifferenceAtActivation: active.scoreDifferenceAtActivation,
    assignedQuestionId: active.assignedQuestion.id,
    assignedQuestionText: active.assignedQuestion.questionText,
    rewardValue: active.rewardValue,
    answerSubmitted: active.answerSubmitted,
    answerResult: active.answerResult,
    rewardTransactionStatus: active.rewardTransactionStatus === 'awarded' ? 'awarded' : 'none',
    resolvedAt: now,
  };
  cbState.history.unshift(record);

  game.auditLogs.unshift({
    id: `log-cb-res-${now}`,
    timestamp: now,
    roundNumber: game.currentRoundNumber,
    category: 'score',
    messageAr: isCorrect
      ? `نجح ${team.name} في سؤال العودة وحصل على +${active.rewardValue} نقطة!`
      : `لم يوفق ${team.name} في سؤال العودة (0 نقاط، دون عقوبة).`,
    messageEn: isCorrect
      ? `${team.name} answered Comeback Question correctly and earned +${active.rewardValue} pts!`
      : `${team.name} missed the Comeback Question (0 pts awarded, no penalty).`,
  });

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json({ success: true, isCorrect, rewardAwarded: isCorrect ? active.rewardValue : 0, activeEvent: active });
});

app.post('/api/game/comeback/skip', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const cbState = game.comebackBonus;
  const active = cbState?.activeEvent;
  if (!cbState || !active || active.status === 'resolved') {
    res.status(400).json({ error: 'No unresolved Comeback Bonus to skip.' });
    return;
  }
  const now = Date.now();
  active.status = 'resolved';
  active.answerResult = 'skipped';
  active.rewardTransactionStatus = 'none';
  active.resolvedAt = now;
  if (!cbState.usedTeamIds.includes(active.eligibleTeamId)) {
    cbState.usedTeamIds.push(active.eligibleTeamId);
  }
  cbState.history.unshift({
    id: active.id,
    roundNumber: active.roundNumber,
    eligibleTeamId: active.eligibleTeamId,
    eligibleTeamName: active.eligibleTeamName,
    reason: active.reason,
    scoreDifferenceAtActivation: active.scoreDifferenceAtActivation,
    assignedQuestionId: active.assignedQuestion.id,
    assignedQuestionText: active.assignedQuestion.questionText,
    rewardValue: active.rewardValue,
    answerResult: 'skipped',
    rewardTransactionStatus: 'none',
    resolvedAt: now,
  });
  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json(game);
});

// Final Ceremony Persistence Endpoints (never modify scores or completion state)
app.post('/api/game/ceremony/skip', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  if (game.ceremony) {
    game.ceremony.ceremonyCompleted = true;
    game.ceremony.skippedAt = Date.now();
    gameStorage.setCurrentGame(game);
    gameStorage.saveCurrentGame();
    broadcastGameState(game);
  }
  res.json({ success: true, ceremony: game.ceremony });
});

app.post('/api/game/ceremony/complete', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const now = Date.now();
  if (game.ceremony) {
    game.ceremony.ceremonyCompleted = true;
    game.ceremony.completedAt = now;
    emitSoundEvent(game, 'champion_reveal', { now });
    gameStorage.setCurrentGame(game);
    gameStorage.saveCurrentGame();
    broadcastGameState(game);
  }
  res.json({ success: true, ceremony: game.ceremony });
});

app.post('/api/game/quit', (_req: Request, res: Response) => {
  const state = gameStorage.returnToStartMenu();
  broadcastGameState(state);
  res.json(state);
});

app.post('/api/game/save', (_req: Request, res: Response) => {
  const saved = gameStorage.saveCurrentGame();
  res.json({ success: true, game: saved });
});

app.post('/api/game/load', (req: Request, res: Response) => {
  const { gameId } = req.body;
  const loaded = gameStorage.loadGame(gameId);
  if (!loaded) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }
  broadcastGameState(loaded);
  res.json(loaded);
});

app.get('/api/game/history', (_req: Request, res: Response) => {
  res.json(gameStorage.getSavedGames());
});

app.post('/api/game/pause', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const now = Date.now();
  game.status = game.status === 'paused' ? 'in_progress' : 'paused';
  const isPaused = game.status === 'paused';
  notifyAllTeams(game, tId => ({
    eventId: `pause-${now}-${tId}`,
    dedupeKey: `pause:${game.gameId}:${now}:${tId}`,
    category: 'match_status',
    priority: 'medium',
    tone: isPaused ? 'warning' : 'info',
    emoji: isPaused ? '⏸️' : '▶️',
    titleEn: isPaused ? 'Match Paused by Host' : 'Match Resumed!',
    titleAr: isPaused ? 'تم إيقاف المسابقة مؤقتاً' : 'استُؤنفت المسابقة!',
    messageEn: isPaused
      ? 'Please wait for the host to resume gameplay.'
      : 'Gameplay is active again — get ready!',
    messageAr: isPaused
      ? 'يرجى الانتظار حتى يستأنف المعلم المسابقة.'
      : 'استأنف اللعب الآن!',
    now,
  }));
  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json({ status: game.status });
});

app.post('/api/game/end', (_req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  const now = Date.now();
  finalizeCompletedMatch(game, now);
  gameStorage.setCurrentGame(game);
  gameStorage.saveCurrentGame();
  broadcastGameState(game);
  res.json(game);
});

// Submit answer from team mobile portal
app.post('/api/game/answer', (req: Request, res: Response) => {
  const { teamId, answer, studentId, studentName } = req.body;
  const game = gameStorage.getCurrentGame();
  const now = Date.now();

  const access = verifyTeamControllerAccess(req, game, teamId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const team = access.team;

  if (game.status === 'paused') {
    res.status(400).json({ error: 'Competition is currently paused' });
    return;
  }

  if (game.roundPhase !== 'question_active') {
    res.status(400).json({ error: 'Answers not accepted in current round phase' });
    return;
  }

  const isPrivateRound = game.currentRoundType === 'private_round';
  if (isPrivateRound) {
    const order = game.privateRoundGroup.teamOrder || Object.keys(game.teams);
    const turnIdx = game.privateRoundGroup.activeTurnIndex ?? 0;
    const activeTeamId = order[turnIdx];
    if (teamId !== activeTeamId) {
      res.status(403).json({
        error: `It is currently ${game.teams[activeTeamId]?.name || activeTeamId}'s turn in this Private Round.`,
      });
      return;
    }
  }

  if (game.answers[teamId]) {
    res.status(400).json({ error: 'Team has already submitted an answer for this round' });
    return;
  }

  const question = game.currentQuestion;
  if (!question) {
    res.status(400).json({ error: 'No active question found' });
    return;
  }

  const evalResult = evaluateQuestionAnswer(question, String(answer ?? ''));
  const isCorrect = evalResult.isCorrect;

  let speedRank: number | undefined = undefined;
  if (game.currentRoundType === 'group_speed' && isCorrect) {
    const priorCorrectAnswers = Object.values(game.answers).filter(a => a.isCorrect).length;
    speedRank = priorCorrectAnswers + 1;
  }

  const prevLeaderSig = getLeaderSignature(game.teams);
  const doublePointsRecord = game.activeDoublePointsByTeam?.[teamId];
  const doublePointsApplied = !!doublePointsRecord;

  const scoreResult = calculateAnswerScore(
    question,
    isCorrect,
    speedRank,
    team.streak,
    game.settings,
    game.currentRoundType,
    { doublePointsApplied }
  );

  // Double Points is consumed once evaluated for this round
  if (game.activeDoublePointsByTeam?.[teamId]) {
    delete game.activeDoublePointsByTeam[teamId];
  }

  const prevScore = team.score;
  const scoreAfterBase = prevScore + scoreResult.pointsAwarded;

  const effectOutcome = computeQuestionEffectOutcome({
    effectType: question.questionEffect,
    bonusPoints: question.questionEffectPoints ?? game.settings.questionBonusPoints ?? 50,
    minusPoints: question.questionEffectPoints ?? game.settings.questionMinusPoints ?? 50,
    isCorrect,
    currentScore: scoreAfterBase,
  });

  const prevStreakSnapshot = team.streak || 0;
  team.score = effectOutcome.newScore;
  team.streak = scoreResult.newStreak;
  if (team.streak > team.highestStreak) {
    team.highestStreak = team.streak;
  }

  if (!game.roundStats) {
    game.roundStats = {
      completedRoundsCount: 0,
      totalQuestionsAnswered: 0,
      correctAnswersCount: 0,
      incorrectAnswersCount: 0,
    };
  }
  game.roundStats.totalQuestionsAnswered += 1;
  if (isCorrect) {
    game.roundStats.correctAnswersCount += 1;
  } else {
    game.roundStats.incorrectAnswersCount += 1;
  }

  const cardsUnlocked = calculateCardUnlocks(prevScore, team.score, game.settings.pointsPer200ForCard);
  if (cardsUnlocked > 0) {
    team.pointsAccumulatedForCards += cardsUnlocked;
    game.auditLogs.unshift({
      id: `log-${now}`,
      timestamp: now,
      roundNumber: game.currentRoundNumber,
      category: 'card',
      messageAr: `حقق ${team.name} إنجاز 200 نقطة وأصبح مؤهلاً لسحب ${cardsUnlocked} كارت جديد!`,
      messageEn: `${team.name} unlocked ${cardsUnlocked} new card draw(s) from points milestone!`,
    });
  }

  const totalRoundPoints = isCorrect
    ? scoreResult.pointsAwarded + Math.max(0, effectOutcome.scoreDelta)
    : 0;

  const submissionRecord = {
    teamId,
    submittedByStudentId: studentId,
    submittedByName: studentName || team.leaderName,
    answer,
    submittedAtServerTime: now,
    responseTimeMs: 0,
    isCorrect,
    pointsAwarded: totalRoundPoints,
    basePoints: scoreResult.basePoints,
    doubledBaseBonus: scoreResult.doubledBaseBonus,
    doublePointsApplied: isCorrect && scoreResult.doublePointsApplied,
    speedBonus: scoreResult.speedBonus,
    streakBonus: scoreResult.streakBonus,
    speedRank,
    effectApplied: effectOutcome.effectType,
    effectDelta: effectOutcome.scoreDelta,
    correctAnswerSnapshot: question.correctAnswer,
    prevStreakSnapshot,
    cardsUnlockedSnapshot: cardsUnlocked,
  };

  game.answers[teamId] = submissionRecord;
  if (isPrivateRound) {
    if (!game.privateRoundGroup.turnSubmissions) {
      game.privateRoundGroup.turnSubmissions = {};
    }
    game.privateRoundGroup.turnSubmissions[teamId] = submissionRecord;
  }

  if (scoreResult.pointsAwarded > 0 || effectOutcome.scoreDelta !== 0) {
    const netChange = team.score - prevScore;
    const dpTag =
      isCorrect && scoreResult.doublePointsApplied
        ? ` + Double Points (x2 Base): +${scoreResult.doubledBaseBonus}`
        : '';
    const effectTag =
      effectOutcome.scoreDelta > 0
        ? ` + Bonus Question: +${effectOutcome.scoreDelta}`
        : effectOutcome.scoreDelta < 0
        ? `Minus Question Penalty: ${effectOutcome.scoreDelta}`
        : '';
    game.scoreTransactions.unshift({
      id: `tx-${now}-${teamId}`,
      timestamp: now,
      roundNumber: game.currentRoundNumber,
      teamId: team.id,
      teamName: team.name,
      pointsChange: netChange,
      previousScore: prevScore,
      newScore: team.score,
      reasonAr: isCorrect
        ? `إجابة صحيحة (أساسي: ${scoreResult.basePoints}${scoreResult.doubledBaseBonus > 0 ? ` + مضاعفة x2: ${scoreResult.doubledBaseBonus}` : ''} + سرعة: ${scoreResult.speedBonus} + ستريك: ${scoreResult.streakBonus}${effectOutcome.scoreDelta > 0 ? ` + بونص: ${effectOutcome.scoreDelta}` : ''})`
        : `خصم سؤال (Minus Question Effect: ${effectOutcome.scoreDelta})`,
      reasonEn: isCorrect
        ? `Correct answer (Base: ${scoreResult.basePoints}${dpTag} + Speed: ${scoreResult.speedBonus} + Streak: ${scoreResult.streakBonus}${effectTag})`
        : `Incorrect answer (${effectTag})`,
      performedBy: 'server',
      breakdown: {
        basePoints: scoreResult.basePoints,
        doubledBaseBonus: scoreResult.doubledBaseBonus,
        doublePointsApplied: scoreResult.doublePointsApplied,
        speedBonus: scoreResult.speedBonus,
        streakBonus: scoreResult.streakBonus,
        effectDelta: effectOutcome.scoreDelta,
      },
    });
  }

  emitSoundEvent(game, isCorrect ? 'correct_answer' : 'incorrect_answer', { now, teamId });
  detectAndEmitLeaderChange(game, prevLeaderSig, now);

  if (isPrivateRound) {
    // Immediate feedback per sequential participant turn
    game.roundPhase = 'evaluating';
    game.questionTimerEndsAt = undefined;

    notifyConfirmedScoringOutcome(game, teamId, {
      now,
      contextKey: `priv-ans-${game.currentRoundNumber}-${teamId}`,
      isCorrect,
      pointsAwarded: totalRoundPoints,
      basePoints: scoreResult.basePoints,
      doubledBaseBonus: scoreResult.doubledBaseBonus,
      doublePointsApplied: isCorrect && scoreResult.doublePointsApplied,
      streakBonus: scoreResult.streakBonus,
      prevStreak: prevStreakSnapshot,
      newStreak: team.streak,
      effectApplied: effectOutcome.effectType,
      effectDelta: effectOutcome.scoreDelta,
      cardsUnlocked,
    });
    checkAndNotifyScoreMilestones(game, teamId, prevScore, team.score, now);
    evaluateAndNotifyRankChanges(game, now, `priv-ans-${game.currentRoundNumber}-${teamId}`);

    const order = game.privateRoundGroup.teamOrder || Object.keys(game.teams);
    const turnIdx = game.privateRoundGroup.activeTurnIndex ?? 0;
    if (turnIdx >= order.length - 1) {
      notifyAllTeams(game, tId => ({
        eventId: `round-end-${game.currentRoundNumber}-${tId}`,
        dedupeKey: `round_end:${game.gameId}:${game.currentRoundNumber}:${tId}`,
        category: 'private_rounds',
        priority: 'low',
        tone: 'info',
        emoji: '🏁',
        titleEn: `Private Round ${game.currentRoundNumber} Completed!`,
        titleAr: `انتهت الجولة الخاصة ${game.currentRoundNumber}!`,
        messageEn: 'All sequential turns have concluded.',
        messageAr: 'اكتملت أدوار جميع الفرق في هذه الجولة.',
        now,
      }));
    }
  } else {
    const submittedCount = Object.keys(game.answers).length;
    if (submittedCount >= Object.keys(game.teams).length) {
      game.roundPhase = 'evaluating';
      game.questionTimerEndsAt = undefined;
      emitEvaluatedGroupRoundNotifications(game, now, `all-ans-${game.currentRoundNumber}`);
    } else {
      // Anti-spoiler confirmation ONLY: zero points, correctness, or ranking leaked before evaluation
      pushTeamNotification(game, teamId, {
        eventId: `submit-receipt-${game.currentRoundNumber}-${teamId}`,
        dedupeKey: `submit_receipt:${game.gameId}:${game.currentRoundNumber}:${teamId}`,
        category: 'rounds',
        priority: 'low',
        tone: 'info',
        emoji: '📩',
        titleEn: 'Answer Submitted Successfully!',
        titleAr: 'تم استلام إجابتك بنجاح!',
        messageEn: 'Your answer is locked in. Results reveal once all teams submit or time ends.',
        messageAr: 'تم تسجيل إجابتك. سيتم كشف النتائج بعد إجابة باقي الفرق أو انتهاء الوقت.',
        now,
      });
    }
  }

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);

  const revealed = shouldRevealAnswerResult(game.roundPhase);
  res.json({
    success: true,
    revealed,
    submission: revealed
      ? game.answers[teamId]
      : {
          teamId,
          answer,
          submittedAtServerTime: now,
        },
  });
});

// Claim card draw unlocked by 200-pt milestone
app.post('/api/game/card/claim', (req: Request, res: Response) => {
  const { teamId } = req.body;
  const game = gameStorage.getCurrentGame();
  const now = Date.now();
  const access = verifyTeamControllerAccess(req, game, teamId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const team = access.team;

  if (team.pointsAccumulatedForCards <= 0) {
    res.status(400).json({ error: 'No card draws available' });
    return;
  }

  const drawRes = drawCardFromGlobalPool(
    team,
    game.globalCardPoolRemaining,
    game.currentRoundNumber
  );
  if (!drawRes.card) {
    res.status(400).json({ error: 'No eligible cards remaining in global inventory' });
    return;
  }

  team.pointsAccumulatedForCards -= 1;
  team.cardsClaimedCount += 1;
  team.secretCards.push(drawRes.card);
  game.globalCardPoolRemaining = drawRes.updatedPool;

  emitSoundEvent(game, 'card_reveal', { now, teamId, label: drawRes.card.cardType });
  game.auditLogs.unshift({
    id: `log-${now}`,
    timestamp: now,
    roundNumber: game.currentRoundNumber,
    category: 'card',
    messageAr: `سحب ${team.name} كارت جديد من المخزون المركزي (متاح بدءاً من الجولة ${drawRes.card.availableFromRound})`,
    messageEn: `${team.name} drew a new card from the global pool (available starting Round ${drawRes.card.availableFromRound})`,
  });

  // Strict privacy: never expose drawn cardType or effect inside notifications
  pushTeamNotification(game, teamId, {
    eventId: `card-claim-${now}-${teamId}`,
    dedupeKey: `card_claim:${game.gameId}:${drawRes.card.id}:${teamId}`,
    category: 'cards',
    priority: 'medium',
    tone: 'positive',
    emoji: '🎁',
    titleEn: 'New Card Received!',
    titleAr: 'تم استلام كارت جديد!',
    messageEn: 'A new card was added to your inventory. Check your cards drawer!',
    messageAr: 'تمت إضافة كارت جديد إلى حقيبتك. تفقد قائمة الكروت الآن!',
    now,
  });

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json({ success: true, card: drawRes.card });
});

// Step 1 of Gift Player: Draw a random eligible opponent player before choosing outgoing teammate
app.post('/api/game/card/gift/draw', (req: Request, res: Response) => {
  const { teamId, cardId, targetTeamId } = req.body;
  const game = gameStorage.getCurrentGame();
  const access = verifyTeamControllerAccess(req, game, teamId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const team = access.team;
  const targetTeam = game.teams[targetTeamId];

  if (!targetTeam || teamId === targetTeamId) {
    res.status(400).json({ error: 'Valid initiating and target teams required.' });
    return;
  }

  const card = team.secretCards.find(c => c.id === cardId && c.cardType === 'gift_player');
  if (!card) {
    res.status(400).json({ error: 'Gift Player card not found in your inventory.' });
    return;
  }

  const validation = validateCardPlay({ game, team, card, targetTeamId });
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  // Reuse existing draft if already rolled for same card & targetTeamId
  if (!game.pendingGiftDrafts) game.pendingGiftDrafts = {};
  const existing = game.pendingGiftDrafts[teamId];
  if (existing && existing.cardId === cardId && existing.targetTeamId === targetTeamId) {
    res.json({ success: true, draft: existing });
    return;
  }

  const eligibleOpponents = targetTeam.members.filter(m => !m.isLeader && !m.isLocked);
  const chosen = eligibleOpponents[Math.floor(Math.random() * eligibleOpponents.length)];

  const draft = {
    id: `gift-${Date.now()}`,
    cardId,
    initiatingTeamId: teamId,
    targetTeamId,
    targetTeamName: targetTeam.name,
    draftedStudentId: chosen.studentId,
    draftedStudentName: chosen.name,
    createdAt: Date.now(),
  };

  game.pendingGiftDrafts[teamId] = draft;
  gameStorage.setCurrentGame(game);
  res.json({ success: true, draft });
});

// Play a Card (validates completely BEFORE consuming!)
app.post('/api/game/card/play', (req: Request, res: Response) => {
  const { teamId, cardId, targetTeamId, targetStudentId, exchangeStudentId, requestId } = req.body;
  const game = gameStorage.getCurrentGame();
  const now = Date.now();

  const access = verifyTeamControllerAccess(req, game, teamId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const team = access.team;

  const effectiveRequestId = String(requestId || `${cardId}-${teamId}-${game.currentRoundNumber}`);
  if (game.processedSwapRequestIds?.includes(effectiveRequestId)) {
    res.status(409).json({ error: 'This Player Swap request has already been processed.' });
    return;
  }

  const cardIdx = team.secretCards.findIndex(c => c.id === cardId);
  if (cardIdx === -1) {
    res.status(400).json({ error: 'Card not found in team inventory' });
    return;
  }

  const card = team.secretCards[cardIdx];
  const validation = validateCardPlay({
    game,
    team,
    card,
    targetTeamId,
    targetStudentId,
    exchangeStudentId,
  });

  if (!validation.valid) {
    res.status(400).json({ error: validation.error || 'Card cannot be played' });
    return;
  }

  // Validation passed -> consume card & record usage
  const prevLeaderSig = getLeaderSignature(game.teams);
  team.secretCards.splice(cardIdx, 1);
  const usedThisRound = game.cardsUsedThisRound[teamId] || [];
  usedThisRound.push(card.cardType);
  game.cardsUsedThisRound[teamId] = usedThisRound;

  emitSoundEvent(game, 'card_reveal', { now, teamId, label: card.cardType });
  let effectPayload: Record<string, any> = { type: card.cardType, title: formatCardTitle(card) };

  switch (card.cardType) {
    case 'double_points': {
      if (!game.activeDoublePointsByTeam) game.activeDoublePointsByTeam = {};
      game.activeDoublePointsByTeam[teamId] = {
        cardId: card.id,
        cardTitle: formatCardTitle(card),
        roundNumber: game.currentRoundNumber,
        activatedAt: now,
      };
      game.auditLogs.unshift({
        id: `log-dp-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'card',
        messageAr: `فعّل فريق ${team.name} بطاقة مضاعفة النقاط (Double Points x2) للجولة ${game.currentRoundNumber}!`,
        messageEn: `${team.name} activated Double Points (x2 Base Points) for Round ${game.currentRoundNumber}!`,
      });
      pushTeamNotification(game, teamId, {
        eventId: `dp-play-${card.id}`,
        dedupeKey: `dp_play:${game.gameId}:${game.currentRoundNumber}:${teamId}:${card.id}`,
        category: 'double_points',
        priority: 'medium',
        tone: 'positive',
        emoji: '⚡',
        titleEn: 'Double Points Activated!',
        titleAr: 'تم تفعيل مضاعفة النقاط!',
        messageEn: `Base question points are doubled (2x) for Round ${game.currentRoundNumber}!`,
        messageAr: `ستتم مضاعفة نقاط السؤال الأساسية (x2) في الجولة ${game.currentRoundNumber}!`,
        now,
      });
      effectPayload = {
        ...effectPayload,
        roundNumber: game.currentRoundNumber,
        activatedAt: now,
      };
      break;
    }

    case 'bonus_card': {
      const bonusPts = Math.floor(Math.random() * 201) + 50; // +50 to +250
      const prevScore = team.score;
      team.score += bonusPts;

      const unlocked = calculateCardUnlocks(prevScore, team.score, game.settings.pointsPer200ForCard);
      if (unlocked > 0) {
        team.pointsAccumulatedForCards += unlocked;
      }

      game.scoreTransactions.unshift({
        id: `tx-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        teamId: team.id,
        teamName: team.name,
        pointsChange: bonusPts,
        previousScore: prevScore,
        newScore: team.score,
        reasonAr: `استخدام Bonus Card (+${bonusPts} نقطة)`,
        reasonEn: `Bonus Card played (+${bonusPts} pts)`,
        performedBy: 'card:bonus_card',
      });
      detectAndEmitLeaderChange(game, prevLeaderSig, now);

      pushTeamNotification(game, teamId, {
        eventId: `bonus-play-${card.id}`,
        dedupeKey: `bonus_play:${game.gameId}:${card.id}:${teamId}`,
        category: 'cards',
        priority: 'medium',
        tone: 'positive',
        emoji: '🎁',
        titleEn: `Bonus Card Used! (+${bonusPts} pts)`,
        titleAr: `مكافأة الكارت! (+${bonusPts} نقطة)`,
        messageEn: `Added +${bonusPts} pts to your score (total: ${team.score} pts).`,
        messageAr: `أُضيف +${bonusPts} نقطة لرصيدك (الإجمالي: ${team.score} نقطة).`,
        now,
        metadata: { bonusPts },
      });
      if (unlocked > 0) {
        pushTeamNotification(game, teamId, {
          eventId: `bonus-unlock-${card.id}`,
          dedupeKey: `bonus_unlock:${game.gameId}:${card.id}:${teamId}`,
          category: 'cards',
          priority: 'medium',
          tone: 'positive',
          emoji: '✨',
          titleEn: `Card Draw Unlocked! (${unlocked})`,
          titleAr: `تم فتح فرصة سحب كارت! (${unlocked})`,
          messageEn: 'Open your Cards drawer to draw your mystery card!',
          messageAr: 'افتح قائمة الكروت لسحب الكارت الغامض الخاص بك!',
          now,
        });
      }
      checkAndNotifyScoreMilestones(game, teamId, prevScore, team.score, now);
      evaluateAndNotifyRankChanges(game, now, `bonus-${card.id}`);

      effectPayload = {
        ...effectPayload,
        bonusPoints: bonusPts,
        newScore: team.score,
        unlockedCardDraws: unlocked,
      };
      break;
    }

    case 'player_lock': {
      const targetMember = team.members.find(m => m.studentId === targetStudentId)!;
      targetMember.isLocked = true;
      team.playerLockUsesCount = (team.playerLockUsesCount || 0) + 1;

      game.auditLogs.unshift({
        id: `log-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'card',
        messageAr: `قام ${team.name} بتثبيت اللاعب ${targetMember.name} برمز الحماية`,
        messageEn: `${team.name} locked player ${targetMember.name} with protection shield`,
      });

      pushTeamNotification(game, teamId, {
        eventId: `lock-play-${card.id}`,
        dedupeKey: `lock_play:${game.gameId}:${card.id}:${teamId}`,
        category: 'cards',
        priority: 'medium',
        tone: 'positive',
        emoji: '🔒',
        titleEn: `${targetMember.name} Protected!`,
        titleAr: `تمت حماية ${targetMember.name}!`,
        messageEn: `${targetMember.name} is now locked with a protection shield against swaps.`,
        messageAr: `أصبح ${targetMember.name} محمياً ولا يمكن سحبه في التبديل.`,
        now,
      });

      effectPayload = {
        ...effectPayload,
        lockedStudentId: targetMember.studentId,
        lockedStudentName: targetMember.name,
      };
      break;
    }

    case 'player_swap': {
      const targetTeam = game.teams[targetTeamId];
      const targetMember = targetTeam.members.find(m => m.studentId === targetStudentId)!;
      const exchangeMember = team.members.find(m => m.studentId === exchangeStudentId)!;

      const reaction: ActiveReaction = {
        id: `rx-${now}`,
        requestId: effectiveRequestId,
        cardId: card.id,
        initiatingTeamId: teamId,
        initiatingTeamName: team.name,
        initiatingCardType: 'player_swap',
        targetTeamId,
        targetTeamName: targetTeam.name,
        targetStudentId: targetMember.studentId,
        targetStudentName: targetMember.name,
        exchangeStudentId: exchangeMember.studentId,
        exchangeStudentName: exchangeMember.name,
        startedAt: now,
        expiresAt: now + (game.settings.reactionWindowSeconds || 15) * 1000,
        status: 'waiting_for_response',
      };
      game.activeReactions.push(reaction);

      game.auditLogs.unshift({
        id: `log-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'card',
        messageAr: `أطلق ${team.name} تبادل 1 مقابل 1 (${targetMember.name} من ${targetTeam.name} ↔ ${exchangeMember.name} من ${team.name})! فُتحت مهلة الرد.`,
        messageEn: `${team.name} initiated mandatory 1-for-1 Swap (${targetMember.name} from ${targetTeam.name} ↔ ${exchangeMember.name} from ${team.name})! Reaction window active.`,
      });

      pushTeamNotification(game, teamId, {
        eventId: `swap-req-init-${reaction.id}`,
        dedupeKey: `swap_req:${reaction.id}:init`,
        category: 'player_exchange',
        priority: 'medium',
        tone: 'info',
        emoji: '🔄',
        titleEn: 'Player Swap Request Sent!',
        titleAr: 'تم إرسال طلب تبديل اللاعبين!',
        messageEn: `Proposed 1-for-1 exchange: ${targetMember.name} (${targetTeam.name}) ↔ ${exchangeMember.name}.`,
        messageAr: `طلب تبادل 1 مقابل 1: ${targetMember.name} (${targetTeam.name}) ↔ ${exchangeMember.name}.`,
        now,
      });

      pushTeamNotification(game, targetTeamId, {
        eventId: `swap-req-tgt-${reaction.id}`,
        dedupeKey: `swap_req:${reaction.id}:tgt`,
        category: 'player_exchange',
        priority: 'high',
        tone: 'warning',
        emoji: '⚠️',
        titleEn: 'Incoming Player Swap Request!',
        titleAr: 'طلب تبديل لاعبين قادم!',
        messageEn: `${team.name} wants to swap ${exchangeMember.name} for ${targetMember.name}. Defend now if you have a counter card!`,
        messageAr: `يريد ${team.name} مبادلة ${exchangeMember.name} مقابل ${targetMember.name}. دافع الآن إذا كان لديك كارت مضاد!`,
        now,
      });

      effectPayload = {
        ...effectPayload,
        reaction,
      };
      break;
    }

    case 'minus_card': {
      const targetTeam = game.teams[targetTeamId];
      const reaction: ActiveReaction = {
        id: `rx-${now}`,
        initiatingTeamId: teamId,
        initiatingTeamName: team.name,
        initiatingCardType: 'minus_card',
        targetTeamId,
        targetTeamName: targetTeam.name,
        value: 100,
        startedAt: now,
        expiresAt: now + (game.settings.reactionWindowSeconds || 15) * 1000,
        status: 'waiting_for_response',
      };
      game.activeReactions.push(reaction);

      game.auditLogs.unshift({
        id: `log-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'card',
        messageAr: `أطلق ${team.name} بطاقة Minus Card (-100) ضد ${targetTeam.name}! فُتحت مهلة الرد.`,
        messageEn: `${team.name} launched Minus Card (-100 pts) against ${targetTeam.name}! Reaction window active.`,
      });

      pushTeamNotification(game, teamId, {
        eventId: `minus-req-init-${reaction.id}`,
        dedupeKey: `minus_req:${reaction.id}:init`,
        category: 'cards',
        priority: 'medium',
        tone: 'info',
        emoji: '📉',
        titleEn: 'Minus Card Launched!',
        titleAr: 'تم إطلاق بطاقة الخصم!',
        messageEn: `Targeted ${targetTeam.name} (-100 pts). Reaction window is open.`,
        messageAr: `تم استهداف ${targetTeam.name} (-100 نقطة). مهلة الرد مفتوحة الآن.`,
        now,
      });

      pushTeamNotification(game, targetTeamId, {
        eventId: `minus-req-tgt-${reaction.id}`,
        dedupeKey: `minus_req:${reaction.id}:tgt`,
        category: 'cards',
        priority: 'high',
        tone: 'negative',
        emoji: '⚠️',
        titleEn: 'Incoming Minus Card (-100 pts)!',
        titleAr: 'هجوم بطاقة خصم (-100 نقطة)!',
        messageEn: `${team.name} launched a Minus Card against you. Defend with Reverse Judgment if available!`,
        messageAr: `أطلق ${team.name} بطاقة خصم ضدك. استخدم Reverse Judgment إن توفر!`,
        now,
      });

      effectPayload = {
        ...effectPayload,
        reaction,
      };
      break;
    }

    case 'card_steal': {
      const targetTeam = game.teams[targetTeamId];
      const reaction: ActiveReaction = {
        id: `rx-${now}`,
        initiatingTeamId: teamId,
        initiatingTeamName: team.name,
        initiatingCardType: 'card_steal',
        targetTeamId,
        targetTeamName: targetTeam.name,
        startedAt: now,
        expiresAt: now + (game.settings.reactionWindowSeconds || 15) * 1000,
        status: 'waiting_for_response',
      };
      game.activeReactions.push(reaction);

      game.auditLogs.unshift({
        id: `log-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'card',
        messageAr: `أطلق ${team.name} بطاقة Card Steal ضد ${targetTeam.name}! فُتحت مهلة الرد.`,
        messageEn: `${team.name} initiated Card Steal against ${targetTeam.name}! Reaction window active.`,
      });

      pushTeamNotification(game, teamId, {
        eventId: `steal-req-init-${reaction.id}`,
        dedupeKey: `steal_req:${reaction.id}:init`,
        category: 'cards',
        priority: 'medium',
        tone: 'info',
        emoji: '🕵️',
        titleEn: 'Card Steal Launched!',
        titleAr: 'تم إطلاق محاولة سرقة الكارت!',
        messageEn: `Attempted to steal a card from ${targetTeam.name}. Reaction window active.`,
        messageAr: `محاولة سحب كارت من ${targetTeam.name}. مهلة الرد مفتوحة الآن.`,
        now,
      });

      pushTeamNotification(game, targetTeamId, {
        eventId: `steal-req-tgt-${reaction.id}`,
        dedupeKey: `steal_req:${reaction.id}:tgt`,
        category: 'cards',
        priority: 'high',
        tone: 'negative',
        emoji: '⚠️',
        titleEn: 'Incoming Card Steal Attempt!',
        titleAr: 'محاولة سرقة كارت قادمة!',
        messageEn: `${team.name} is trying to steal one of your secret cards! React before time expires.`,
        messageAr: `يحاول ${team.name} سرقة أحد كروتك! دافع قبل انتهاء المهلة.`,
        now,
      });

      effectPayload = {
        ...effectPayload,
        reaction,
      };
      break;
    }

    case 'card_inspection': {
      const targetTeam = game.teams[targetTeamId];
      targetTeam.wasInspectedBy = 'under_surveillance';

      let revealedCards = [...targetTeam.secretCards];
      if (game.settings.cardInspectionMode === 'reveal_one_random' && revealedCards.length > 0) {
        const randIdx = Math.floor(Math.random() * revealedCards.length);
        revealedCards = [revealedCards[randIdx]];
      }

      const inspection = {
        id: `insp-${now}`,
        inspectingTeamId: teamId,
        targetTeamId,
        targetTeamName: targetTeam.name,
        cards: revealedCards,
        mode: game.settings.cardInspectionMode,
        inspectedAt: now,
      };

      if (!game.lastInspectionByTeam) game.lastInspectionByTeam = {};
      game.lastInspectionByTeam[teamId] = inspection;

      game.auditLogs.unshift({
        id: `log-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'card',
        messageAr: `تم فحص مخزون كروت ${targetTeam.name} عبر Card Inspection (إشعار مراقبة مجهول الهوية)`,
        messageEn: `Card Inspection executed against ${targetTeam.name} (anonymous surveillance alert shown)`,
      });

      pushTeamNotification(game, teamId, {
        eventId: `insp-init-${inspection.id}`,
        dedupeKey: `insp_init:${inspection.id}:${teamId}`,
        category: 'cards',
        priority: 'medium',
        tone: 'info',
        emoji: '🔍',
        titleEn: `Inspected ${targetTeam.name}'s Cards`,
        titleAr: `تم فحص كروت ${targetTeam.name}`,
        messageEn:
          revealedCards.length > 0
            ? `Revealed ${revealedCards.length} card(s) in your inspection result.`
            : `${targetTeam.name} currently holds no secret cards.`,
        messageAr:
          revealedCards.length > 0
            ? `تم كشف ${revealedCards.length} كارت في نتيجة الفحص.`
            : `لا يملك ${targetTeam.name} كروت سرية حالياً.`,
        now,
      });

      // Strictly anonymous alert to inspected team (never exposes inspectingTeamId)
      pushTeamNotification(game, targetTeamId, {
        eventId: `insp-tgt-${inspection.id}`,
        dedupeKey: `insp_tgt:${inspection.id}:${targetTeamId}`,
        category: 'cards',
        priority: 'medium',
        tone: 'warning',
        emoji: '👁️',
        titleEn: "Your Team's Cards Were Inspected!",
        titleAr: 'تم فحص كروت فريقك!',
        messageEn: 'Another team used Card Inspection to scan your inventory.',
        messageAr: 'قام فريق منافس بفحص حقيبة كروتك السرية.',
        now,
      });

      effectPayload = {
        ...effectPayload,
        inspection,
      };
      break;
    }

    case 'gift_player': {
      const targetTeam = game.teams[targetTeamId];
      const existingDraft = game.pendingGiftDrafts?.[teamId];
      let draftedMemberIdx = -1;

      if (existingDraft && existingDraft.targetTeamId === targetTeamId) {
        draftedMemberIdx = targetTeam.members.findIndex(
          m => m.studentId === existingDraft.draftedStudentId && !m.isLeader && !m.isLocked
        );
      }
      if (draftedMemberIdx === -1) {
        const eligibleOpponents = targetTeam.members.filter(m => !m.isLeader && !m.isLocked);
        const chosen = eligibleOpponents[Math.floor(Math.random() * eligibleOpponents.length)];
        draftedMemberIdx = targetTeam.members.findIndex(m => m.studentId === chosen.studentId);
      }

      let ownIdx = -1;
      if (exchangeStudentId) {
        ownIdx = team.members.findIndex(
          m => m.studentId === exchangeStudentId && !m.isLeader && !m.isLocked
        );
      }
      if (ownIdx === -1) {
        const eligibleOwn = team.members.filter(m => !m.isLeader && !m.isLocked);
        const chosenOwn = eligibleOwn[Math.floor(Math.random() * eligibleOwn.length)];
        ownIdx = team.members.findIndex(m => m.studentId === chosenOwn.studentId);
      }

      const [drafted] = targetTeam.members.splice(draftedMemberIdx, 1);
      const [traded] = team.members.splice(ownIdx, 1);
      team.members.push(drafted);
      targetTeam.members.push(traded);

      if (game.pendingGiftDrafts?.[teamId]) {
        delete game.pendingGiftDrafts[teamId];
      }

      game.auditLogs.unshift({
        id: `log-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'card',
        messageAr: `تم تبادل هدية بين ${team.name} و ${targetTeam.name}: انضم ${drafted.name} مقابل ${traded.name}`,
        messageEn: `Gift Player exchange: ${drafted.name} joined ${team.name} in exchange for ${traded.name} (${targetTeam.name})`,
      });

      pushTeamNotification(game, teamId, {
        eventId: `gift-init-${card.id}`,
        dedupeKey: `gift_ex:${card.id}:init`,
        category: 'player_exchange',
        priority: 'high',
        tone: 'positive',
        emoji: '🎁',
        titleEn: 'Gift Player Exchange Completed!',
        titleAr: 'اكتمل تبادل Gift Player!',
        messageEn: `${drafted.name} joined your team and ${traded.name} moved to ${targetTeam.name}.`,
        messageAr: `انضم ${drafted.name} لفريقك وانتقل ${traded.name} إلى ${targetTeam.name}.`,
        now,
      });
      pushTeamNotification(game, teamId, {
        eventId: `gift-join-${card.id}`,
        dedupeKey: `gift_join:${card.id}:init`,
        category: 'team_activity',
        priority: 'medium',
        tone: 'positive',
        emoji: '👤',
        titleEn: 'New Player Joined Your Team!',
        titleAr: 'انضم لاعب جديد إلى فريقك!',
        messageEn: `${drafted.name} is now part of your roster.`,
        messageAr: `أصبح ${drafted.name} الآن ضمن صفوف فريقك.`,
        now,
      });

      pushTeamNotification(game, targetTeamId, {
        eventId: `gift-tgt-${card.id}`,
        dedupeKey: `gift_ex:${card.id}:tgt`,
        category: 'player_exchange',
        priority: 'high',
        tone: 'info',
        emoji: '🎁',
        titleEn: 'Player Exchange With Rival Team!',
        titleAr: 'تبادل لاعبين عبر Gift Player!',
        messageEn: `${traded.name} joined your team while ${drafted.name} moved to ${team.name}.`,
        messageAr: `انضم ${traded.name} لفريقك وانتقل ${drafted.name} إلى ${team.name}.`,
        now,
      });
      pushTeamNotification(game, targetTeamId, {
        eventId: `gift-leave-${card.id}`,
        dedupeKey: `gift_leave:${card.id}:tgt`,
        category: 'team_activity',
        priority: 'medium',
        tone: 'warning',
        emoji: '👋',
        titleEn: 'Player Left Your Team',
        titleAr: 'غادر لاعب صفوف فريقك',
        messageEn: `${drafted.name} transferred to ${team.name} via Gift Player.`,
        messageAr: `انتقل ${drafted.name} إلى ${team.name} عبر بطاقة Gift Player.`,
        now,
      });

      effectPayload = {
        ...effectPayload,
        draftedStudentName: drafted.name,
        tradedStudentName: traded.name,
        targetTeamName: targetTeam.name,
      };
      break;
    }

    case 'better_luck': {
      team.pointsAccumulatedForCards += 1;
      game.auditLogs.unshift({
        id: `log-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        category: 'card',
        messageAr: `استخدم ${team.name} كارت حظاً أوفر وحفظ فرصة سحب بديلة!`,
        messageEn: `${team.name} activated Better Luck Next Time and preserved a fresh card draw opportunity!`,
      });
      pushTeamNotification(game, teamId, {
        eventId: `bluck-${card.id}`,
        dedupeKey: `bluck:${card.id}:${teamId}`,
        category: 'cards',
        priority: 'low',
        tone: 'positive',
        emoji: '🍀',
        titleEn: 'Fresh Card Draw Preserved!',
        titleAr: 'تم حفظ فرصة سحب جديدة!',
        messageEn: 'Better Luck Next Time granted you 1 bonus card draw opportunity.',
        messageAr: 'منحتك البطاقة فرصة سحب كارت إضافية.',
        now,
      });
      effectPayload = {
        ...effectPayload,
        preservedDraw: true,
      };
      break;
    }

    default:
      break;
  }

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json({ success: true, effect: effectPayload });
});

// Defensive reaction during active Reaction Window
app.post('/api/game/card/react', (req: Request, res: Response) => {
  const { reactionId, teamId, defenseCardType } = req.body;
  const game = gameStorage.getCurrentGame();
  const now = Date.now();

  const access = verifyTeamControllerAccess(req, game, teamId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  const team = access.team;

  const reaction = game.activeReactions.find(r => r.id === reactionId);

  if (!reaction || (reaction.status !== 'pending' && reaction.status !== 'waiting_for_response')) {
    res.status(400).json({ error: 'Reaction window is no longer active' });
    return;
  }

  if (now > reaction.expiresAt) {
    res.status(400).json({ error: 'Reaction window has expired' });
    return;
  }

  if (reaction.targetTeamId !== teamId) {
    res.status(403).json({ error: 'Only the targeted team can react to this attack' });
    return;
  }

  if (defenseCardType !== 'anti_swap' && defenseCardType !== 'reverse_judgment') {
    res.status(400).json({ error: 'Invalid defense card type.' });
    return;
  }

  // Validate compatibility of defense card with incoming attack
  if (defenseCardType === 'anti_swap' && reaction.initiatingCardType !== 'player_swap') {
    res.status(400).json({ error: 'Anti-Swap can only block Player Swap attacks.' });
    return;
  }

  const usedThisRound = game.cardsUsedThisRound[teamId] || [];
  if (game.settings.defensiveCardLimitMode === 'counts_against_round_limit' && usedThisRound.length >= 1) {
    res.status(400).json({ error: 'Your team has already used its allowed card for this round.' });
    return;
  }

  const typedDefense = defenseCardType as 'anti_swap' | 'reverse_judgment';
  const cardIdx = team.secretCards.findIndex(c =>
    req.body.cardId ? c.id === req.body.cardId && c.cardType === typedDefense : c.cardType === typedDefense
  );
  if (cardIdx === -1) {
    res.status(400).json({ error: 'You do not own this defense card' });
    return;
  }

  const defenseCard = team.secretCards[cardIdx];
  if (!isCardEligibleForRound(defenseCard, game.currentRoundNumber)) {
    res.status(400).json({
      error: `${CARD_DEFINITIONS[typedDefense].titleEn} was earned in Round ${defenseCard.earnedInRound ?? game.currentRoundNumber} and cannot be used until Round ${defenseCard.availableFromRound}.`,
    });
    return;
  }

  const prevLeaderSig = getLeaderSignature(game.teams);
  team.secretCards.splice(cardIdx, 1);
  usedThisRound.push(defenseCardType);
  game.cardsUsedThisRound[teamId] = usedThisRound;

  reaction.status = 'defended';
  reaction.defenseCardUsed = defenseCardType;

  const attackerTeam = game.teams[reaction.initiatingTeamId];

  if (defenseCardType === 'anti_swap') {
    if (reaction.requestId && !game.processedSwapRequestIds?.includes(reaction.requestId)) {
      if (!game.processedSwapRequestIds) game.processedSwapRequestIds = [];
      game.processedSwapRequestIds.push(reaction.requestId);
    }
    if (!game.swapHistory) game.swapHistory = [];
    game.swapHistory.unshift({
      id: `swap-def-${now}`,
      requestId: reaction.requestId || reaction.id,
      reactionId: reaction.id,
      roundNumber: game.currentRoundNumber,
      initiatingTeamId: reaction.initiatingTeamId,
      initiatingTeamName: reaction.initiatingTeamName || reaction.initiatingTeamId,
      targetTeamId: reaction.targetTeamId,
      targetTeamName: reaction.targetTeamName || reaction.targetTeamId,
      incomingPlayerId: reaction.targetStudentId || '',
      incomingPlayerName: reaction.targetStudentName || '',
      outgoingPlayerId: reaction.exchangeStudentId || '',
      outgoingPlayerName: reaction.exchangeStudentName || '',
      status: 'defended',
      timestamp: now,
      note: 'Blocked by Anti-Swap',
    });
    reaction.resultMessageEn = `${team.name} blocked the 1-for-1 Swap (${reaction.targetStudentName} ↔ ${reaction.exchangeStudentName}) using Anti-Swap!`;
    reaction.resultMessageAr = `نجح ${team.name} في إحباط محاولة التبادل (${reaction.targetStudentName} ↔ ${reaction.exchangeStudentName}) باستخدام Anti-Swap!`;
    game.auditLogs.unshift({
      id: `log-${now}`,
      timestamp: now,
      roundNumber: game.currentRoundNumber,
      category: 'card',
      messageAr: reaction.resultMessageAr,
      messageEn: reaction.resultMessageEn,
    });
    pushTeamNotification(game, teamId, {
      eventId: `def-antiswap-${reaction.id}`,
      dedupeKey: `def_antiswap:${reaction.id}:${teamId}`,
      category: 'player_exchange',
      priority: 'high',
      tone: 'positive',
      emoji: '🛡️',
      titleEn: 'Anti-Swap Defense Successful!',
      titleAr: 'نجحت الحماية عبر Anti-Swap!',
      messageEn: reaction.resultMessageEn,
      messageAr: reaction.resultMessageAr,
      now,
    });
    if (attackerTeam) {
      pushTeamNotification(game, attackerTeam.id, {
        eventId: `att-blocked-${reaction.id}`,
        dedupeKey: `att_blocked:${reaction.id}:${attackerTeam.id}`,
        category: 'player_exchange',
        priority: 'medium',
        tone: 'warning',
        emoji: '🛡️',
        titleEn: 'Player Swap Blocked!',
        titleAr: 'تم صد طلب تبديل اللاعبين!',
        messageEn: `${team.name} used Anti-Swap to block the exchange.`,
        messageAr: `استخدم ${team.name} بطاقة Anti-Swap لإحباط التبادل.`,
        now,
      });
    }
  } else if (defenseCardType === 'reverse_judgment') {
    if (reaction.initiatingCardType === 'minus_card' && attackerTeam) {
      const penalty = reaction.value || 100;
      const oldScore = attackerTeam.score;
      attackerTeam.score = Math.max(0, attackerTeam.score - penalty);
      reaction.resultMessageEn = `${team.name} reflected Minus Card back onto ${attackerTeam.name} (-${penalty} pts)!`;
      reaction.resultMessageAr = `عكس ${team.name} الخصم (-${penalty}) على ${attackerTeam.name} باستخدام Reverse Judgment!`;

      game.scoreTransactions.unshift({
        id: `tx-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        teamId: attackerTeam.id,
        teamName: attackerTeam.name,
        pointsChange: -penalty,
        previousScore: oldScore,
        newScore: attackerTeam.score,
        reasonAr: reaction.resultMessageAr,
        reasonEn: reaction.resultMessageEn,
        performedBy: 'card:reverse_judgment',
      });
      detectAndEmitLeaderChange(game, prevLeaderSig, now);
      evaluateAndNotifyRankChanges(game, now, `rev-minus-${reaction.id}`);
    } else if (reaction.initiatingCardType === 'card_steal' && attackerTeam) {
      if (attackerTeam.secretCards.length > 0) {
        const idx = Math.floor(Math.random() * attackerTeam.secretCards.length);
        const [reflectedCard] = attackerTeam.secretCards.splice(idx, 1);
        team.secretCards.push(reflectedCard);
        reaction.resultMessageEn = `${team.name} reflected Card Steal and seized a card from ${attackerTeam.name}!`;
        reaction.resultMessageAr = `عكس ${team.name} السرقة واستولى على كارت من ${attackerTeam.name}!`;
      } else {
        reaction.resultMessageEn = `${team.name} blocked Card Steal with Reverse Judgment!`;
        reaction.resultMessageAr = `صدّ ${team.name} محاولة السرقة باستخدام Reverse Judgment!`;
      }
    } else if (reaction.initiatingCardType === 'player_swap' && attackerTeam) {
      if (reaction.requestId && !game.processedSwapRequestIds?.includes(reaction.requestId)) {
        if (!game.processedSwapRequestIds) game.processedSwapRequestIds = [];
        game.processedSwapRequestIds.push(reaction.requestId);
      }
      if (!game.swapHistory) game.swapHistory = [];
      game.swapHistory.unshift({
        id: `swap-rev-${now}`,
        requestId: reaction.requestId || reaction.id,
        reactionId: reaction.id,
        roundNumber: game.currentRoundNumber,
        initiatingTeamId: reaction.initiatingTeamId,
        initiatingTeamName: reaction.initiatingTeamName || reaction.initiatingTeamId,
        targetTeamId: reaction.targetTeamId,
        targetTeamName: reaction.targetTeamName || reaction.targetTeamId,
        incomingPlayerId: reaction.targetStudentId || '',
        incomingPlayerName: reaction.targetStudentName || '',
        outgoingPlayerId: reaction.exchangeStudentId || '',
        outgoingPlayerName: reaction.exchangeStudentName || '',
        status: 'defended',
        timestamp: now,
        note: 'Blocked & Reflected by Reverse Judgment',
      });
      const penalty = 50;
      const oldScore = attackerTeam.score;
      attackerTeam.score = Math.max(0, attackerTeam.score - penalty);
      reaction.resultMessageEn = `${team.name} reversed Player Swap — exchange blocked (rosters unchanged) and ${attackerTeam.name} penalized -${penalty} pts!`;
      reaction.resultMessageAr = `عكس ${team.name} التبادل — تم إلغاء التبديل دون تغيير الصفوف وخصم ${penalty} نقطة من ${attackerTeam.name}!`;
      game.scoreTransactions.unshift({
        id: `tx-${now}`,
        timestamp: now,
        roundNumber: game.currentRoundNumber,
        teamId: attackerTeam.id,
        teamName: attackerTeam.name,
        pointsChange: -penalty,
        previousScore: oldScore,
        newScore: attackerTeam.score,
        reasonAr: reaction.resultMessageAr,
        reasonEn: reaction.resultMessageEn,
        performedBy: 'card:reverse_judgment',
      });
      detectAndEmitLeaderChange(game, prevLeaderSig, now);
      evaluateAndNotifyRankChanges(game, now, `rev-swap-${reaction.id}`);
    }

    pushTeamNotification(game, teamId, {
      eventId: `def-rev-${reaction.id}`,
      dedupeKey: `def_rev:${reaction.id}:${teamId}`,
      category: 'cards',
      priority: 'high',
      tone: 'positive',
      emoji: '🪞',
      titleEn: 'Reverse Judgment Reflected the Attack!',
      titleAr: 'عكس Reverse Judgment الهجوم بنجاح!',
      messageEn: reaction.resultMessageEn || 'Attack reflected back onto the initiating team.',
      messageAr: reaction.resultMessageAr || 'تم عكس الهجوم على الفريق المهاجم.',
      now,
    });
    if (attackerTeam) {
      pushTeamNotification(game, attackerTeam.id, {
        eventId: `att-rev-${reaction.id}`,
        dedupeKey: `att_rev:${reaction.id}:${attackerTeam.id}`,
        category: 'cards',
        priority: 'high',
        tone: 'negative',
        emoji: '🪞',
        titleEn: 'Your Attack Was Reflected!',
        titleAr: 'تم عكس هجومك ببطاقة Reverse Judgment!',
        messageEn: reaction.resultMessageEn || `${team.name} reflected your card back at you!`,
        messageAr: reaction.resultMessageAr || `عكس ${team.name} بطاقتك عليك!`,
        now,
      });
    }

    game.auditLogs.unshift({
      id: `log-${now}`,
      timestamp: now,
      roundNumber: game.currentRoundNumber,
      category: 'card',
      messageAr: reaction.resultMessageAr || `عكس ${team.name} الهجوم باستخدام Reverse Judgment`,
      messageEn: reaction.resultMessageEn || `${team.name} reflected the attack using Reverse Judgment`,
    });
  }

  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json({ success: true, reaction });
});

// Team Notifications Center REST Endpoints (Strictly Authenticated & Team-Scoped)
app.get('/api/game/notifications', (req: Request, res: Response) => {
  const teamId = String(req.query.teamId || '');
  const game = gameStorage.getCurrentGame();
  const access = verifyTeamControllerAccess(req, game, teamId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const category = req.query.category as NotificationCategory | 'all' | undefined;
  const unreadOnly = req.query.unreadOnly === 'true';
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;

  const result = gameStorage.getTeamNotifications(teamId, {
    category,
    unreadOnly,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  });
  res.json({ success: true, teamId, ...result });
});

app.post('/api/game/notifications/read', (req: Request, res: Response) => {
  const { teamId, notificationId } = req.body;
  const game = gameStorage.getCurrentGame();
  const access = verifyTeamControllerAccess(req, game, String(teamId || ''));
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }
  if (!notificationId) {
    res.status(400).json({ error: 'notificationId is required' });
    return;
  }

  const updated = gameStorage.markTeamNotificationRead(teamId, String(notificationId));
  if (updated) {
    broadcastGameState(gameStorage.getCurrentGame());
  }
  res.json({ success: true, updated });
});

app.post('/api/game/notifications/read-all', (req: Request, res: Response) => {
  const { teamId } = req.body;
  const game = gameStorage.getCurrentGame();
  const access = verifyTeamControllerAccess(req, game, String(teamId || ''));
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const markedCount = gameStorage.markAllTeamNotificationsRead(teamId);
  if (markedCount > 0) {
    broadcastGameState(gameStorage.getCurrentGame());
  }
  res.json({ success: true, markedCount });
});

app.post('/api/game/teams/rename', (req: Request, res: Response) => {
  const { teamId, name } = req.body;
  const game = gameStorage.getCurrentGame();
  if (game.teams[teamId] && name) {
    game.teams[teamId].name = name.trim();
    gameStorage.setCurrentGame(game);
    broadcastGameState(game);
    res.json({ success: true, team: game.teams[teamId] });
    return;
  }
  res.status(400).json({ error: 'Invalid team or name' });
});

app.put('/api/game/settings', (req: Request, res: Response) => {
  const game = gameStorage.getCurrentGame();
  if (req.body.totalRounds !== undefined) {
    const check = validateTotalRounds(req.body.totalRounds);
    if (!check.valid) {
      res.status(400).json({ error: check.error || 'Total rounds must be between 1 and 70.' });
      return;
    }
    game.totalRounds = check.rounds;
  }
  game.settings = { ...game.settings, ...req.body };
  gameStorage.setCurrentGame(game);
  broadcastGameState(game);
  res.json(game.settings);
});

// Question Bank CRUD
app.get('/api/questions', (_req: Request, res: Response) => {
  res.json(gameStorage.getQuestionBank());
});

app.post('/api/questions', (req: Request, res: Response) => {
  const q: Question = {
    ...req.body,
    id: req.body.id || `q-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    approved: req.body.approved ?? true,
  };
  const added = gameStorage.addQuestion(q);
  res.json(added);
});

app.put('/api/questions/:id', (req: Request, res: Response) => {
  const updated = gameStorage.updateQuestion(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }
  res.json(updated);
});

app.delete('/api/questions/:id', (req: Request, res: Response) => {
  const success = gameStorage.deleteQuestion(req.params.id);
  res.json({ success });
});

// Students roster (read-only for teacher wizard Step 1)
app.get('/api/students', (_req: Request, res: Response) => {
  res.json(gameStorage.getStudents());
});

// Real PDF, DOCX, & Plain Text Question Bank Import Endpoints (Strict Verbatim Preservation)
app.post('/api/questions/import-file', async (req: Request, res: Response) => {
  try {
    const { fileName, base64Data, rawText } = req.body;
    const lowerName = (fileName || '').toLowerCase();

    if (lowerName.endsWith('.pdf')) {
      if (!base64Data) {
        res.status(400).json({ error: 'Missing PDF binary payload' });
        return;
      }
      const buffer = Buffer.from(base64Data, 'base64');
      const result = await extractQuestionsFromPdfBuffer(buffer, fileName);
      res.json({ ...result, count: result.questions.length });
      return;
    }

    if (lowerName.endsWith('.docx')) {
      if (!base64Data) {
        res.status(400).json({ error: 'Missing DOCX binary payload' });
        return;
      }
      const buffer = Buffer.from(base64Data, 'base64');
      const result = await extractQuestionsFromDocxBuffer(buffer, fileName);
      res.json({ ...result, count: result.questions.length });
      return;
    }

    if (lowerName.endsWith('.doc')) {
      res.status(400).json({
        error: 'Legacy binary .doc format is not supported directly. Please save as .docx or .pdf and upload again.',
      });
      return;
    }

    const textContent =
      rawText ||
      (base64Data ? Buffer.from(base64Data, 'base64').toString('utf-8') : '');
    if (!textContent.trim()) {
      res.status(400).json({ error: 'Document appears empty or unreadable.' });
      return;
    }

    const result = await extractQuestionsFromPlainText(textContent, fileName);
    res.json({ ...result, count: result.questions.length });
  } catch (err: any) {
    console.error('[Question Import Error]:', err);
    res.status(500).json({ error: err.message || 'Failed to extract questions from document.' });
  }
});

app.post('/api/ai/parse-questions', async (req: Request, res: Response) => {
  try {
    const { rawText } = req.body;
    if (!rawText || !rawText.trim()) {
      res.status(400).json({ error: 'No text provided' });
      return;
    }
    const result = await extractQuestionsFromPlainText(rawText, 'pasted-text.txt');
    res.json({ ...result, count: result.questions.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to parse questions.' });
  }
});

// Single-question AI Reprocessing & Quality Re-check
app.post('/api/questions/reprocess', async (req: Request, res: Response) => {
  try {
    const { question } = req.body;
    if (!question || !question.questionText) {
      res.status(400).json({ error: 'Valid question object required for reprocessing.' });
      return;
    }
    const updated = await reprocessQuestionWithAI(question);
    // Sync if question exists in persistent bank
    const existingBank = gameStorage.getQuestionBank();
    if (existingBank.some(q => q.id === updated.id)) {
      gameStorage.updateQuestion(updated.id, updated);
    }
    res.json({ success: true, question: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to reprocess question.' });
  }
});

// Development server with Vite integration
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CodeArena Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
