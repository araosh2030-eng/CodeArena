import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, REGISTERED_STUDENTS } from './defaultData';
import { createInitialComebackState, createTeamsFromStudents, getInitialGlobalCardPool } from './rules';
import {
  checkAndNotifyScoreMilestones,
  evaluateAndNotifyRankChanges,
  notifyConfirmedScoringOutcome,
  notifyQuestionActiveEvents,
  notifyRoundStartEvents,
  pushTeamNotification,
  resetNotificationState,
} from './notifications';
import { gameStorage } from '../server/storage';
import { GameState } from '../types/game';

function makeTestGame(): GameState {
  const leaders = REGISTERED_STUDENTS.slice(0, 4).map(s => s.id);
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS, leaders);
  return {
    gameId: 'test-game-notif-1',
    name: 'Test Notification Match',
    createdAt: 1000,
    updatedAt: 1000,
    status: 'in_progress',
    currentRoundNumber: 1,
    totalRounds: 10,
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
    activeDoublePointsByTeam: {},
    activeReactions: [],
    comebackBonus: createInitialComebackState(),
    scoreTransactions: [],
    auditLogs: [],
    settings: { ...DEFAULT_SETTINGS, totalRounds: 10 },
  };
}

test('pushTeamNotification enforces dedupeKey idempotency and ignores invalid teamId', () => {
  const game = makeTestGame();
  resetNotificationState(game);

  const first = pushTeamNotification(game, 'team1', {
    eventId: 'ev-1',
    dedupeKey: 'unique-key-1',
    category: 'points',
    priority: 'medium',
    tone: 'positive',
    emoji: '🎉',
    titleEn: '+100 Points!',
    titleAr: '+100 نقطة!',
    messageEn: 'Correct answer!',
    messageAr: 'إجابة صحيحة!',
    now: 2000,
  });

  const duplicate = pushTeamNotification(game, 'team1', {
    eventId: 'ev-1',
    dedupeKey: 'unique-key-1',
    category: 'points',
    priority: 'medium',
    tone: 'positive',
    emoji: '🎉',
    titleEn: '+100 Points!',
    titleAr: '+100 نقطة!',
    messageEn: 'Correct answer!',
    messageAr: 'إجابة صحيحة!',
    now: 2001,
  });

  const invalidTeam = pushTeamNotification(game, 'unknown_team', {
    eventId: 'ev-2',
    dedupeKey: 'unique-key-2',
    category: 'points',
    priority: 'medium',
    tone: 'positive',
    emoji: '🎉',
    titleEn: 'Ignored',
    titleAr: 'تجاهل',
    messageEn: 'Ignored',
    messageAr: 'تجاهل',
    now: 2002,
  });

  assert.ok(first);
  assert.equal(duplicate, null);
  assert.equal(invalidTeam, null);
  assert.equal(game.notificationsByTeam?.team1.length, 1);
  assert.equal(game.notificationsByTeam?.team2.length, 0);
});

test('evaluateAndNotifyRankChanges suppresses zero-point all-tied start and accurately tracks all 4 positions & ties', () => {
  const game = makeTestGame();
  resetNotificationState(game);

  // All teams start at 0 -> zero rank alerts should fire
  const zeroAlerts = evaluateAndNotifyRankChanges(game, 1000, 'r0');
  assert.equal(zeroAlerts.length, 0);

  // Round 1: team1=300 (1st), team2=200 (2nd), team3=100 (3rd), team4=0 (4th/last)
  game.teams.team1.score = 300;
  game.teams.team2.score = 200;
  game.teams.team3.score = 100;
  game.teams.team4.score = 0;

  const r1Alerts = evaluateAndNotifyRankChanges(game, 2000, 'r1');
  const t1Alert = r1Alerts.find(a => a.teamId === 'team1');
  const t2Alert = r1Alerts.find(a => a.teamId === 'team2');
  const t3Alert = r1Alerts.find(a => a.teamId === 'team3');
  const t4Alert = r1Alerts.find(a => a.teamId === 'team4');

  assert.ok(t1Alert && t1Alert.titleEn.includes('1st place'));
  assert.ok(t2Alert && t2Alert.titleEn.includes('2nd place'));
  assert.ok(t3Alert && t3Alert.titleEn.includes('3rd place'));
  assert.ok(t4Alert && t4Alert.titleEn.toLowerCase().includes('last place'));

  // Round 2: Unchanged ranks with minor score movement -> zero ranking alerts
  game.teams.team1.score = 350;
  game.teams.team2.score = 240;
  game.teams.team3.score = 130;
  game.teams.team4.score = 20;
  const r2Unchanged = evaluateAndNotifyRankChanges(game, 3000, 'r2');
  assert.equal(r2Unchanged.length, 0);

  // Round 3: team4 climbs from 4th (last) to 1st! team1 drops to 2nd, team2 drops to 3rd, team3 drops to last
  game.currentRoundNumber = 3;
  game.teams.team4.score = 500;
  const r3Alerts = evaluateAndNotifyRankChanges(game, 4000, 'r3');

  const t4Climb = r3Alerts.find(a => a.teamId === 'team4');
  const t1Drop = r3Alerts.find(a => a.teamId === 'team1');
  const t2Drop = r3Alerts.find(a => a.teamId === 'team2');
  const t3Drop = r3Alerts.find(a => a.teamId === 'team3');

  assert.ok(t4Climb && t4Climb.titleEn.includes('1st place'));
  assert.ok(t1Drop && t1Drop.titleEn.includes('2nd place'));
  assert.ok(t2Drop && t2Drop.titleEn.includes('3rd place'));
  assert.ok(t3Drop && t3Drop.titleEn.toLowerCase().includes('last place'));

  // Round 4: team1 ties team4 at 500 -> Tie alerts for 1st; then team1 breaks tie -> Sole lead
  game.currentRoundNumber = 4;
  game.teams.team1.score = 500;
  const tieAlerts = evaluateAndNotifyRankChanges(game, 5000, 'r4-tie');
  assert.ok(tieAlerts.some(a => a.teamId === 'team1' && a.titleEn.includes('Tied for 1st')));
  assert.ok(tieAlerts.some(a => a.teamId === 'team4' && a.titleEn.includes('Tied for 1st')));

  game.teams.team1.score = 600;
  const soleLeadAlerts = evaluateAndNotifyRankChanges(game, 6000, 'r4-sole');
  assert.ok(soleLeadAlerts.some(a => a.teamId === 'team1' && a.titleEn.includes('Sole Lead')));
  assert.ok(soleLeadAlerts.some(a => a.teamId === 'team4' && a.titleEn.includes('2nd place')));
});

test('score milestones fire once per threshold and scoring outcome covers double points, streak, minus penalty, and streak loss', () => {
  const game = makeTestGame();
  resetNotificationState(game);

  const m1 = checkAndNotifyScoreMilestones(game, 'team1', 420, 560, 1000);
  assert.equal(m1.length, 1);
  assert.ok(m1[0].titleEn.includes('500'));

  const mRepeat = checkAndNotifyScoreMilestones(game, 'team1', 420, 580, 1100);
  assert.equal(mRepeat.length, 0);

  const m1000 = checkAndNotifyScoreMilestones(game, 'team1', 900, 1050, 1200);
  assert.equal(m1000.length, 1);
  assert.ok(m1000[0].titleEn.includes('1000'));

  notifyConfirmedScoringOutcome(game, 'team1', {
    now: 2000,
    contextKey: 'ctx-1',
    isCorrect: true,
    pointsAwarded: 240,
    basePoints: 100,
    doubledBaseBonus: 100,
    doublePointsApplied: true,
    streakBonus: 40,
    prevStreak: 2,
    newStreak: 3,
    cardsUnlocked: 1,
  });

  const t1Notifs = game.notificationsByTeam?.team1 || [];
  assert.ok(t1Notifs.some(n => n.category === 'points' && n.titleEn.includes('+240')));
  assert.ok(t1Notifs.some(n => n.category === 'double_points'));
  assert.ok(t1Notifs.some(n => n.titleEn.includes('Streak Bonus')));
  assert.ok(t1Notifs.some(n => n.category === 'cards' && n.titleEn.includes('Card Draw Unlocked')));

  // Incorrect answer on minus question that ends streak >= 2
  notifyConfirmedScoringOutcome(game, 'team2', {
    now: 2100,
    contextKey: 'ctx-2',
    isCorrect: false,
    pointsAwarded: 0,
    prevStreak: 3,
    newStreak: 0,
    effectApplied: 'minus',
    effectDelta: -50,
    cardsUnlocked: 0,
  });

  const t2Notifs = game.notificationsByTeam?.team2 || [];
  assert.ok(t2Notifs.some(n => n.titleEn.includes('-50 Points')));
  assert.ok(t2Notifs.some(n => n.titleEn.includes('Streak Has Ended')));
});

test('notifyRoundStartEvents & notifyQuestionActiveEvents respect private round representative & turn isolation', () => {
  const game = makeTestGame();
  resetNotificationState(game);

  game.currentRoundNumber = 3;
  game.totalRounds = 5; // triggers remaining === 2 alert
  game.currentRoundType = 'private_round';
  game.roundPhase = 'card_window';
  game.teams.team1.secretCards.push({
    id: 'c-ready',
    cardType: 'bonus_card',
    earnedInRound: 2,
    availableFromRound: 3,
    acquiredAt: 1000,
  });

  const p1 = game.teams.team1.members[0];
  const p2 = game.teams.team2.members[0];
  game.privateRoundGroup.selectedPlayerPerTeam = {
    team1: { studentId: p1.studentId, name: p1.name },
    team2: { studentId: p2.studentId, name: p2.name },
  };

  notifyRoundStartEvents(game, 3000);

  const t1Msgs = game.notificationsByTeam?.team1 || [];
  const t2Msgs = game.notificationsByTeam?.team2 || [];

  assert.ok(t1Msgs.some(n => n.titleEn.includes('Card Is Now Available')));
  assert.ok(!t2Msgs.some(n => n.titleEn.includes('Card Is Now Available')));
  assert.ok(t1Msgs.some(n => n.category === 'private_rounds' && n.titleEn.includes(p1.name)));
  assert.ok(!t1Msgs.some(n => n.titleEn.includes(p2.name)));
  assert.ok(t1Msgs.some(n => n.category === 'milestones' && n.titleEn.includes('Few Rounds Remain')));

  notifyQuestionActiveEvents(game, 3500, 'team2');
  assert.ok(game.notificationsByTeam?.team2.some(n => n.titleEn.includes("Your Team's Turn")));
  assert.ok(!game.notificationsByTeam?.team1.some(n => n.titleEn.includes("Your Team's Turn")));
});

test('getSanitizedStateForTeam enforces strict per-team notification privacy and strips anti-spoiler fields', () => {
  const game = makeTestGame();
  resetNotificationState(game);

  pushTeamNotification(game, 'team1', {
    eventId: 't1-secret',
    dedupeKey: 't1-secret-k',
    category: 'cards',
    priority: 'medium',
    tone: 'positive',
    emoji: '🎁',
    titleEn: 'New Card Received!',
    titleAr: 'تم استلام كارت جديد!',
    messageEn: 'Check your inventory.',
    messageAr: 'تفقد حقيبتك.',
    now: 1000,
  });

  pushTeamNotification(game, 'team2', {
    eventId: 't2-secret',
    dedupeKey: 't2-secret-k',
    category: 'comeback',
    priority: 'high',
    tone: 'positive',
    emoji: '⚡',
    titleEn: 'Comeback Bonus for Team 2!',
    titleAr: 'فرصة عودة للفريق الثاني!',
    messageEn: 'Secret rival info',
    messageAr: 'معلومة خاصة بالمنافس',
    now: 1001,
  });

  game.roundPhase = 'question_active';
  game.answers.team1 = {
    teamId: 'team1',
    answer: '42',
    submittedAtServerTime: 1005,
    responseTimeMs: 0,
    isCorrect: true,
    pointsAwarded: 150,
    prevStreakSnapshot: 2,
    cardsUnlockedSnapshot: 1,
  };

  const scopedForTeam1 = gameStorage.getSanitizedStateForTeam(game, 'team1');
  assert.equal(Object.keys(scopedForTeam1.notificationsByTeam || {}).length, 1);
  assert.equal(scopedForTeam1.notificationsByTeam?.team1?.length, 1);
  assert.equal(scopedForTeam1.notificationsByTeam?.team2, undefined);
  assert.equal(scopedForTeam1.lastConfirmedRankings, undefined);
  assert.equal(scopedForTeam1.milestoneNotifiedByTeam, undefined);
  assert.equal(scopedForTeam1.answers.team1.isCorrect, false);
  assert.equal(scopedForTeam1.answers.team1.pointsAwarded, 0);
  assert.equal(scopedForTeam1.answers.team1.prevStreakSnapshot, undefined);
  assert.equal(scopedForTeam1.answers.team1.cardsUnlockedSnapshot, undefined);

  const scopedNoTeam = gameStorage.getSanitizedStateForTeam(game, undefined);
  assert.deepEqual(scopedNoTeam.notificationsByTeam, {});
});
