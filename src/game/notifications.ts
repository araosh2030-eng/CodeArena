import {
  ConfirmedTeamRankSnapshot,
  GameState,
  NotificationCategory,
  NotificationPriority,
  NotificationTone,
  TeamNotification,
  TeamRankingEntry,
} from '../types/game';
import { computeTeamRankings } from './rules';

export interface NotificationCreateInput {
  eventId: string;
  dedupeKey: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  tone: NotificationTone;
  emoji: string;
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  durationMs?: number;
  roundNumber?: number;
  now?: number;
  metadata?: Record<string, string | number | boolean>;
}

const DEFAULT_DURATION_BY_PRIORITY: Record<NotificationPriority, number> = {
  high: 5000,
  medium: 3500,
  low: 3000,
};

const MAX_NOTIFICATIONS_PER_TEAM = 160;
let notificationSeq = 0;

export function ensureNotificationState(game: GameState): void {
  if (!game.notificationsByTeam) {
    game.notificationsByTeam = {};
  }
  for (const teamId of Object.keys(game.teams || {})) {
    if (!Array.isArray(game.notificationsByTeam[teamId])) {
      game.notificationsByTeam[teamId] = [];
    }
  }
  if (!game.lastConfirmedRankings) {
    game.lastConfirmedRankings = {};
  }
  if (!game.milestoneNotifiedByTeam) {
    game.milestoneNotifiedByTeam = {};
  }
}

export function resetNotificationState(game: GameState): void {
  game.notificationsByTeam = {};
  for (const teamId of Object.keys(game.teams || {})) {
    game.notificationsByTeam[teamId] = [];
  }
  game.milestoneNotifiedByTeam = {};
  seedInitialConfirmedRankings(game);
}

export function seedInitialConfirmedRankings(game: GameState): void {
  ensureNotificationState(game);
  const rankings = computeTeamRankings(game.teams);
  const snap: Record<string, ConfirmedTeamRankSnapshot> = {};
  for (const entry of rankings) {
    snap[entry.teamId] = {
      rank: entry.rank,
      isTied: entry.isTiedRank,
      score: entry.score,
      diffFromLeader: entry.diffFromLeader,
    };
  }
  game.lastConfirmedRankings = snap;
}

/**
 * Centralized idempotent notification inserter.
 * Guarantees repeated delivery with the same dedupeKey never creates duplicate entries.
 */
export function pushTeamNotification(
  game: GameState,
  teamId: string,
  input: NotificationCreateInput
): TeamNotification | null {
  if (!teamId || !game.teams?.[teamId]) return null;
  ensureNotificationState(game);

  const list = game.notificationsByTeam![teamId];
  if (list.some(n => n.dedupeKey === input.dedupeKey)) {
    return null;
  }

  const now = input.now ?? Date.now();
  notificationSeq = (notificationSeq + 1) % 100000;
  const item: TeamNotification = {
    id: `notif-${now}-${notificationSeq}-${Math.random().toString(36).slice(2, 6)}`,
    eventId: input.eventId,
    dedupeKey: input.dedupeKey,
    gameId: game.gameId,
    teamId,
    roundNumber: input.roundNumber ?? game.currentRoundNumber ?? 1,
    category: input.category,
    priority: input.priority,
    tone: input.tone,
    emoji: input.emoji,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    messageEn: input.messageEn,
    messageAr: input.messageAr,
    durationMs: input.durationMs ?? DEFAULT_DURATION_BY_PRIORITY[input.priority],
    timestamp: now,
    read: false,
    metadata: input.metadata,
  };

  list.unshift(item);
  if (list.length > MAX_NOTIFICATIONS_PER_TEAM) {
    game.notificationsByTeam![teamId] = list.slice(0, MAX_NOTIFICATIONS_PER_TEAM);
  }
  return item;
}

export function notifyAllTeams(
  game: GameState,
  builder: (teamId: string) => NotificationCreateInput | null
): TeamNotification[] {
  const created: TeamNotification[] = [];
  for (const teamId of Object.keys(game.teams || {})) {
    const input = builder(teamId);
    if (input) {
      const item = pushTeamNotification(game, teamId, input);
      if (item) created.push(item);
    }
  }
  return created;
}

function ordinalEn(rank: number): string {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

function ordinalAr(rank: number): string {
  if (rank === 1) return 'الأول';
  if (rank === 2) return 'الثاني';
  if (rank === 3) return 'الثالث';
  if (rank === 4) return 'الرابع';
  return `المركز ${rank}`;
}

function isBottomGroup(entry: TeamRankingEntry, allEntries: TeamRankingEntry[]): boolean {
  if (allEntries.length === 0) return false;
  const minScore = Math.min(...allEntries.map(e => e.score));
  return entry.score === minScore && !allEntries.every(e => e.score === entry.score);
}

/**
 * Evaluates confirmed standings across all 4 teams and emits ranking transition notifications
 * for every team whose rank or tie state meaningfully changed since lastConfirmedRankings.
 */
export function evaluateAndNotifyRankChanges(
  game: GameState,
  now: number,
  contextId: string
): TeamNotification[] {
  ensureNotificationState(game);
  const rankings = computeTeamRankings(game.teams);
  if (rankings.length === 0) return [];

  const prevMap = game.lastConfirmedRankings || {};
  const hasAnyPointsOnBoard = rankings.some(r => r.score > 0);
  const allZeroBefore =
    Object.keys(prevMap).length > 0 && Object.values(prevMap).every(p => p.score === 0);
  const totalTeams = rankings.length;
  const emitted: TeamNotification[] = [];

  for (const curr of rankings) {
    const prev = prevMap[curr.teamId];
    if (!prev) continue;

    // Suppress misleading rank alerts when every team sits tied at 0 points
    if (!hasAnyPointsOnBoard && prev.score === 0 && curr.score === 0) {
      continue;
    }

    const fromRank = prev.rank;
    const toRank = curr.rank;
    const wasTied = prev.isTied;
    const nowTied = curr.isTiedRank;
    const rankDelta = fromRank - toRank; // positive = climbed, negative = dropped
    const currentlyLast = toRank === totalTeams || isBottomGroup(curr, rankings);
    const wasLast = fromRank === totalTeams;

    let notif: Omit<NotificationCreateInput, 'eventId' | 'dedupeKey'> | null = null;

    if (allZeroBefore && hasAnyPointsOnBoard) {
      // First scoring event off 0-0-0-0 baseline: announce established standings accurately
      if (toRank === 1) {
        notif = nowTied
          ? {
              category: 'ranking',
              priority: 'high',
              tone: 'positive',
              emoji: '🥇',
              titleEn: 'Tied for 1st Place!',
              titleAr: 'تعادل في المركز الأول!',
              messageEn: `You share 1st place on the scoreboard with ${curr.score} pts!`,
              messageAr: `تتصدر الترتيب بالتعادل برصيد ${curr.score} نقطة!`,
            }
          : {
              category: 'ranking',
              priority: 'high',
              tone: 'positive',
              emoji: '🥇',
              titleEn: "You're now in 1st place!",
              titleAr: 'أصبح فريقك في المركز الأول!',
              messageEn: `Your team has taken 1st place with ${curr.score} pts!`,
              messageAr: `انتزع فريقك الصدارة برصيد ${curr.score} نقطة!`,
            };
      } else if (currentlyLast) {
        notif = {
          category: 'ranking',
          priority: 'medium',
          tone: 'warning',
          emoji: '😢',
          titleEn: 'Your team is now in last place! Keep fighting!',
          titleAr: 'فريقك الآن في المركز الأخير! واصل القتال!',
          messageEn: `${Math.abs(curr.diffFromLeader)} pts behind the leader. Lots of rounds ahead!`,
          messageAr: `بفارق ${Math.abs(curr.diffFromLeader)} نقطة عن الصدارة. الجولات القادمة حاسمة!`,
        };
      } else if (toRank === 2) {
        notif = {
          category: 'ranking',
          priority: 'medium',
          tone: 'positive',
          emoji: '🥈',
          titleEn: nowTied ? 'Tied for 2nd place!' : "You're now in 2nd place!",
          titleAr: nowTied ? 'تعادل في المركز الثاني!' : 'فريقك الآن في المركز الثاني!',
          messageEn: `Close behind 1st place (${Math.abs(curr.diffFromLeader)} pts gap).`,
          messageAr: `قريب من الصدارة (بفارق ${Math.abs(curr.diffFromLeader)} نقطة).`,
        };
      } else if (toRank === 3) {
        notif = {
          category: 'ranking',
          priority: 'low',
          tone: 'info',
          emoji: '🥉',
          titleEn: nowTied ? 'Tied for 3rd place!' : 'Your team is now in 3rd place!',
          titleAr: nowTied ? 'تعادل في المركز الثالث!' : 'فريقك الآن في المركز الثالث!',
          messageEn: `Current score: ${curr.score} pts.`,
          messageAr: `رصيدك الحالي: ${curr.score} نقطة.`,
        };
      }
    } else if (fromRank !== toRank) {
      if (rankDelta > 0) {
        // Climbed in standings
        if (toRank === 1) {
          if (nowTied) {
            notif = {
              category: 'ranking',
              priority: 'high',
              tone: 'positive',
              emoji: '🥇',
              titleEn: 'Tied for 1st Place!',
              titleAr: 'تعادل في المركز الأول!',
              messageEn: `You've climbed to share 1st place with ${curr.score} pts!`,
              messageAr: `تقدم فريقك ليتشارك المركز الأول برصيد ${curr.score} نقطة!`,
            };
          } else {
            notif = {
              category: 'ranking',
              priority: 'high',
              tone: 'positive',
              emoji: '🥇',
              titleEn: "You're now in 1st place!",
              titleAr: 'أصبح فريقك في المركز الأول!',
              messageEn: `Your team has taken the lead with ${curr.score} pts!`,
              messageAr: `انتزع فريقك الصدارة برصيد ${curr.score} نقطة!`,
            };
          }
        } else if (rankDelta >= 2) {
          notif = {
            category: 'ranking',
            priority: 'high',
            tone: 'positive',
            emoji: '🚀',
            titleEn: 'Amazing! Climbed Multiple Positions!',
            titleAr: 'قفزة رائعة! تقدمت عدة مراكز!',
            messageEn: `Your team jumped from ${ordinalEn(fromRank)} to ${ordinalEn(toRank)} place${nowTied ? ' (tied)' : ''}!`,
            messageAr: `قفز فريقك من المركز ${ordinalAr(fromRank)} إلى ${ordinalAr(toRank)}${nowTied ? ' (بالتعادل)' : ''}!`,
          };
        } else if (wasLast && toRank < totalTeams) {
          notif = {
            category: 'ranking',
            priority: 'high',
            tone: 'positive',
            emoji: '📈',
            titleEn: `Great comeback! Moved up to ${ordinalEn(toRank)} place!`,
            titleAr: `عودة قوية! تقدمت إلى المركز ${ordinalAr(toRank)}!`,
            messageEn: `You've climbed out of last place (${curr.score} pts). Keep pushing!`,
            messageAr: `غادر فريقك المركز الأخير برصيد ${curr.score} نقطة. واصل التقدم!`,
          };
        } else if (toRank === 2) {
          notif = {
            category: 'ranking',
            priority: 'medium',
            tone: 'positive',
            emoji: '🥈',
            titleEn: nowTied ? 'Tied for 2nd place!' : "You're now in 2nd place!",
            titleAr: nowTied ? 'تعادل في المركز الثاني!' : 'فريقك الآن في المركز الثاني!',
            messageEn: `Moved up to 2nd place (${Math.abs(curr.diffFromLeader)} pts behind lead).`,
            messageAr: `تقدم فريقك للمركز الثاني (بفارق ${Math.abs(curr.diffFromLeader)} نقطة عن المتصدر).`,
          };
        } else if (toRank === 3) {
          notif = {
            category: 'ranking',
            priority: 'medium',
            tone: 'positive',
            emoji: '🥉',
            titleEn: nowTied ? 'Tied for 3rd place!' : 'Your team is now in 3rd place!',
            titleAr: nowTied ? 'تعادل في المركز الثالث!' : 'فريقك الآن في المركز الثالث!',
            messageEn: `Moved up to 3rd place (${curr.score} pts).`,
            messageAr: `تقدم فريقك إلى المركز الثالث برصيد ${curr.score} نقطة.`,
          };
        }
      } else {
        // Dropped in standings
        if (currentlyLast) {
          notif = {
            category: 'ranking',
            priority: 'high',
            tone: 'negative',
            emoji: fromRank <= 2 ? '😭' : '😢',
            titleEn:
              fromRank <= 2
                ? 'Your team has dropped to last place!'
                : 'Your team is now in last place! Keep fighting!',
            titleAr:
              fromRank <= 2
                ? 'تراجع فريقك إلى المركز الأخير!'
                : 'فريقك الآن في المركز الأخير! واصل القتال!',
            messageEn: `${Math.abs(curr.diffFromLeader)} pts behind the leader${nowTied ? ' (tied for last)' : ''}.`,
            messageAr: `بفارق ${Math.abs(curr.diffFromLeader)} نقطة عن الصدارة${nowTied ? ' (تعادل)' : ''}.`,
          };
        } else if (toRank === 2) {
          notif = {
            category: 'ranking',
            priority: 'high',
            tone: 'warning',
            emoji: '😔',
            titleEn: nowTied ? 'Dropped into a tie for 2nd place!' : "You've dropped to 2nd place!",
            titleAr: nowTied ? 'تراجع للمركز الثاني بالتعادل!' : 'تراجع فريقك إلى المركز الثاني!',
            messageEn: `Currently ${Math.abs(curr.diffFromLeader)} pts behind 1st place.`,
            messageAr: `بفارق ${Math.abs(curr.diffFromLeader)} نقطة خلف المركز الأول.`,
          };
        } else if (toRank === 3) {
          notif = {
            category: 'ranking',
            priority: 'high',
            tone: 'warning',
            emoji: '😟',
            titleEn:
              fromRank === 1
                ? "You've dropped from 1st to 3rd place!"
                : nowTied
                ? 'Your team is now tied for 3rd place!'
                : "You've dropped to 3rd place!",
            titleAr:
              fromRank === 1
                ? 'تراجع فريقك من الأول إلى المركز الثالث!'
                : 'فريقك الآن في المركز الثالث!',
            messageEn: `Current score: ${curr.score} pts.`,
            messageAr: `رصيدك الحالي: ${curr.score} نقطة.`,
          };
        }
      }
    } else if (wasTied !== nowTied) {
      // Rank number stayed equal, tie status changed meaningfully
      if (toRank === 1 && !nowTied && wasTied) {
        notif = {
          category: 'ranking',
          priority: 'high',
          tone: 'positive',
          emoji: '🥇',
          titleEn: 'Your Team Has Taken Sole Lead!',
          titleAr: 'انفرد فريقك بالصدارة!',
          messageEn: `Tie broken — you now hold 1st place alone with ${curr.score} pts!`,
          messageAr: `تم كسر التعادل وانفرد فريقك بالمركز الأول (${curr.score} نقطة)!`,
        };
      } else if (toRank === 1 && nowTied && !wasTied) {
        notif = {
          category: 'ranking',
          priority: 'medium',
          tone: 'warning',
          emoji: '⚖️',
          titleEn: 'Now Tied for 1st Place!',
          titleAr: 'تعادل على الصدارة!',
          messageEn: `A rival caught up — you share 1st place at ${curr.score} pts.`,
          messageAr: `لحق بك منافس وأصبحتما متعادلين في المركز الأول (${curr.score} نقطة).`,
        };
      } else if (nowTied && !wasTied) {
        notif = {
          category: 'ranking',
          priority: 'low',
          tone: 'info',
          emoji: '🤝',
          titleEn: `Tied for ${ordinalEn(toRank)} place!`,
          titleAr: `تعادل في المركز ${ordinalAr(toRank)}!`,
          messageEn: `Your team now shares ${ordinalEn(toRank)} place at ${curr.score} pts.`,
          messageAr: `يتشارك فريقك الآن المركز ${ordinalAr(toRank)} برصيد ${curr.score} نقطة.`,
        };
      }
    } else if (!curr.isLeader && prev.diffFromLeader < 0 && curr.diffFromLeader < 0) {
      // Meaningful score gap shift without rank change (>= 150 pt gap swing)
      const gapBefore = Math.abs(prev.diffFromLeader);
      const gapNow = Math.abs(curr.diffFromLeader);
      if (gapBefore - gapNow >= 150 && gapNow > 0) {
        notif = {
          category: 'team_activity',
          priority: 'low',
          tone: 'positive',
          emoji: '📉',
          titleEn: 'Your Team Is Closing the Gap!',
          titleAr: 'فريقك يقلص الفارق!',
          messageEn: `Gap to 1st place narrowed from ${gapBefore} to ${gapNow} pts.`,
          messageAr: `تقلص الفارق عن المتصدر من ${gapBefore} إلى ${gapNow} نقطة.`,
        };
      } else if (gapNow - gapBefore >= 200) {
        notif = {
          category: 'team_activity',
          priority: 'low',
          tone: 'warning',
          emoji: '😟',
          titleEn: 'The Lead Gap Widened',
          titleAr: 'اتسع الفارق عن الصدارة',
          messageEn: `Now trailing 1st place by ${gapNow} pts. Time to strike back!`,
          messageAr: `أصبح الفارق عن الصدارة ${gapNow} نقطة. حان وقت التعويض!`,
        };
      }
    }

    if (notif) {
      const created = pushTeamNotification(game, curr.teamId, {
        ...notif,
        eventId: `rank-${contextId}-${curr.teamId}`,
        dedupeKey: `rank:${game.currentRoundNumber}:${contextId}:${curr.teamId}:${fromRank}->${toRank}:${wasTied}->${nowTied}:${curr.score}`,
        now,
        metadata: {
          fromRank,
          toRank,
          isTied: nowTied,
          score: curr.score,
        },
      });
      if (created) emitted.push(created);
    }
  }

  // Always update lastConfirmedRankings snapshot after evaluation
  const nextSnap: Record<string, ConfirmedTeamRankSnapshot> = {};
  for (const curr of rankings) {
    nextSnap[curr.teamId] = {
      rank: curr.rank,
      isTied: curr.isTiedRank,
      score: curr.score,
      diffFromLeader: curr.diffFromLeader,
    };
  }
  game.lastConfirmedRankings = nextSnap;

  return emitted;
}

export function checkAndNotifyScoreMilestones(
  game: GameState,
  teamId: string,
  prevScore: number,
  newScore: number,
  now: number
): TeamNotification[] {
  if (newScore <= prevScore || newScore < 500) return [];
  ensureNotificationState(game);
  const notified = game.milestoneNotifiedByTeam![teamId] || [];
  const emitted: TeamNotification[] = [];

  const thresholds = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
  for (const milestone of thresholds) {
    if (prevScore < milestone && newScore >= milestone && !notified.includes(milestone)) {
      notified.push(milestone);
      const isMajor = milestone % 1000 === 0;
      const item = pushTeamNotification(game, teamId, {
        eventId: `milestone-${teamId}-${milestone}`,
        dedupeKey: `milestone:${game.gameId}:${teamId}:${milestone}`,
        category: 'milestones',
        priority: isMajor ? 'medium' : 'low',
        tone: 'positive',
        emoji: isMajor ? '🎉' : '🎯',
        titleEn: isMajor
          ? `Your Team Reached ${milestone} Points!`
          : `New Score Milestone: ${milestone} Points!`,
        titleAr: isMajor
          ? `وصل فريقك إلى ${milestone} نقطة!`
          : `إنجاز جديد: تجاوزت ${milestone} نقطة!`,
        messageEn: `Total score reached ${newScore} pts.`,
        messageAr: `بلغ إجمالي رصيد فريقك ${newScore} نقطة.`,
        now,
        metadata: { milestone, newScore },
      });
      if (item) emitted.push(item);
    }
  }
  game.milestoneNotifiedByTeam![teamId] = notified;
  return emitted;
}

export function notifyConfirmedScoringOutcome(
  game: GameState,
  teamId: string,
  params: {
    now: number;
    contextKey: string;
    isCorrect: boolean;
    pointsAwarded: number;
    basePoints?: number;
    doubledBaseBonus?: number;
    doublePointsApplied?: boolean;
    streakBonus?: number;
    prevStreak: number;
    newStreak: number;
    effectApplied?: string;
    effectDelta?: number;
    cardsUnlocked?: number;
  }
): void {
  const { now, contextKey } = params;

  // 1. Answer result + points delta
  if (params.isCorrect) {
    const dpTextEn = params.doublePointsApplied
      ? ` (includes +${params.doubledBaseBonus ?? 0} Double Points!)`
      : '';
    const dpTextAr = params.doublePointsApplied
      ? ` (يتضمن +${params.doubledBaseBonus ?? 0} مضاعفة النقاط!)`
      : '';

    pushTeamNotification(game, teamId, {
      eventId: `eval-${contextKey}-${teamId}`,
      dedupeKey: `eval:${game.currentRoundNumber}:${contextKey}:${teamId}:correct`,
      category: 'points',
      priority: 'medium',
      tone: 'positive',
      emoji: params.pointsAwarded >= 200 ? '🔥' : '🎉',
      titleEn: `+${params.pointsAwarded} Points!`,
      titleAr: `+${params.pointsAwarded} نقطة!`,
      messageEn: `Correct answer!${dpTextEn}`,
      messageAr: `إجابة صحيحة!${dpTextAr}`,
      now,
      metadata: { pointsDelta: params.pointsAwarded, isCorrect: true },
    });

    if (params.doublePointsApplied && (params.doubledBaseBonus ?? 0) > 0) {
      pushTeamNotification(game, teamId, {
        eventId: `dp-award-${contextKey}-${teamId}`,
        dedupeKey: `dp_award:${game.currentRoundNumber}:${contextKey}:${teamId}`,
        category: 'double_points',
        priority: 'medium',
        tone: 'positive',
        emoji: '⚡',
        titleEn: 'Double Points Awarded Successfully!',
        titleAr: 'تم احتساب مضاعفة النقاط بنجاح!',
        messageEn: `2x base bonus added +${params.doubledBaseBonus} extra pts.`,
        messageAr: `أضافت المضاعفة +${params.doubledBaseBonus} نقطة إضافية.`,
        now,
        metadata: { doubledBaseBonus: params.doubledBaseBonus ?? 0 },
      });
    }

    if ((params.streakBonus ?? 0) > 0) {
      pushTeamNotification(game, teamId, {
        eventId: `streak-${contextKey}-${teamId}`,
        dedupeKey: `streak:${game.currentRoundNumber}:${contextKey}:${teamId}`,
        category: 'points',
        priority: 'medium',
        tone: 'positive',
        emoji: '🔥',
        titleEn: `Streak Bonus Earned! (x${params.newStreak})`,
        titleAr: `مكافأة سلسلة الإجابات! (x${params.newStreak})`,
        messageEn: `Earned +${params.streakBonus} streak bonus points!`,
        messageAr: `حصلت على +${params.streakBonus} نقطة إضافية من السلسلة!`,
        now,
        metadata: { streak: params.newStreak, streakBonus: params.streakBonus ?? 0 },
      });
    }
  } else {
    const minusLoss = params.effectDelta && params.effectDelta < 0 ? params.effectDelta : 0;
    if (minusLoss < 0) {
      pushTeamNotification(game, teamId, {
        eventId: `eval-${contextKey}-${teamId}`,
        dedupeKey: `eval:${game.currentRoundNumber}:${contextKey}:${teamId}:minus`,
        category: 'points',
        priority: 'medium',
        tone: 'negative',
        emoji: '💔',
        titleEn: `${minusLoss} Points!`,
        titleAr: `${minusLoss} نقطة!`,
        messageEn: 'Incorrect answer triggered a Minus Question penalty.',
        messageAr: 'إجابة غير صحيحة على سؤال خصم النقاط.',
        now,
        metadata: { pointsDelta: minusLoss, isCorrect: false },
      });
    } else {
      pushTeamNotification(game, teamId, {
        eventId: `eval-${contextKey}-${teamId}`,
        dedupeKey: `eval:${game.currentRoundNumber}:${contextKey}:${teamId}:wrong`,
        category: 'rounds',
        priority: 'low',
        tone: 'negative',
        emoji: '❌',
        titleEn: 'Incorrect Answer — Keep Going!',
        titleAr: 'إجابة غير صحيحة — واصل المحاولة!',
        messageEn: 'Your answer has been evaluated (0 pts awarded).',
        messageAr: 'تم تقييم إجابتك (0 نقاط لهذه الجولة).',
        now,
        metadata: { pointsDelta: 0, isCorrect: false },
      });
    }

    if (params.prevStreak >= 2 && params.newStreak === 0) {
      pushTeamNotification(game, teamId, {
        eventId: `streak-end-${contextKey}-${teamId}`,
        dedupeKey: `streak_end:${game.currentRoundNumber}:${contextKey}:${teamId}`,
        category: 'points',
        priority: 'low',
        tone: 'warning',
        emoji: '💔',
        titleEn: "Your Team's Streak Has Ended!",
        titleAr: 'انتهت سلسلة إجابات فريقك!',
        messageEn: `A ${params.prevStreak}-answer streak came to an end. Rebuild on the next round!`,
        messageAr: `توقفت سلسلة من ${params.prevStreak} إجابات صحيحة متتالية.`,
        now,
      });
    }
  }

  // 2. Card Draw Unlocked notice (without revealing future random card)
  if ((params.cardsUnlocked ?? 0) > 0) {
    pushTeamNotification(game, teamId, {
      eventId: `unlock-${contextKey}-${teamId}`,
      dedupeKey: `card_unlock:${game.currentRoundNumber}:${contextKey}:${teamId}`,
      category: 'cards',
      priority: 'medium',
      tone: 'positive',
      emoji: '✨',
      titleEn: `Card Draw Unlocked! (${params.cardsUnlocked})`,
      titleAr: `تم فتح فرصة سحب كارت! (${params.cardsUnlocked})`,
      messageEn: 'Open your Cards drawer to draw your mystery card!',
      messageAr: 'افتح قائمة الكروت لسحب الكارت الغامض الخاص بك!',
      now,
    });
  }
}

export function notifyRoundStartEvents(game: GameState, now: number): void {
  const round = game.currentRoundNumber;
  const remaining = Math.max(0, (game.totalRounds || 0) - round);

  // 1. Newly unlocked cooldown cards ready this round
  for (const team of Object.values(game.teams || {})) {
    const newlyAvailable = (team.secretCards || []).filter(
      c => c.availableFromRound !== undefined && c.availableFromRound === round
    );
    if (newlyAvailable.length > 0) {
      pushTeamNotification(game, team.id, {
        eventId: `card-ready-${round}-${team.id}`,
        dedupeKey: `card_ready:${game.gameId}:${round}:${team.id}`,
        category: 'cards',
        priority: 'medium',
        tone: 'positive',
        emoji: '✨',
        titleEn:
          newlyAvailable.length > 1
            ? `${newlyAvailable.length} Cards Are Now Available!`
            : 'A Card Is Now Available to Use!',
        titleAr:
          newlyAvailable.length > 1
            ? `أصبح لديك ${newlyAvailable.length} كروت متاحة الآن!`
            : 'أصبح لديك كارت متاح للاستخدام الآن!',
        messageEn: `Cooldown ended for Round ${round}. Open your Cards inventory.`,
        messageAr: `انتهت فترة الانتظار في الجولة ${round}. تفقد حقيبة الكروت.`,
        now,
      });
    }
  }

  // 2. Round start announcement (tailored by RoundType)
  if (game.currentRoundType === 'private_round') {
    notifyAllTeams(game, teamId => ({
      eventId: `round-start-${round}-${teamId}`,
      dedupeKey: `round_start:${game.gameId}:${round}:${teamId}`,
      category: 'private_rounds',
      priority: 'medium',
      tone: 'info',
      emoji: '🔐',
      titleEn: `Private Round Starting! (Round ${round})`,
      titleAr: `بدأت الجولة الخاصة! (الجولة ${round})`,
      messageEn: 'One representative per team will answer sequentially without timers.',
      messageAr: 'سيجيب ممثل واحد عن كل فريق بالتناوب دون مؤقت.',
      now,
    }));

    // Notify each team which player represents them
    for (const [teamId, player] of Object.entries(
      game.privateRoundGroup?.selectedPlayerPerTeam || {}
    )) {
      if (!player) continue;
      pushTeamNotification(game, teamId, {
        eventId: `priv-player-${round}-${teamId}`,
        dedupeKey: `priv_player:${game.gameId}:${round}:${teamId}:${player.studentId}`,
        category: 'private_rounds',
        priority: 'high',
        tone: 'info',
        emoji: '🎯',
        titleEn: `${player.name} Selected for Private Round!`,
        titleAr: `تم اختيار ${player.name} لتمثيل الفريق!`,
        messageEn: 'Prepare for your team’s individual turn.',
        messageAr: 'استعدوا لدور فريقكم الفردي في هذه الجولة.',
        now,
      });
    }
  } else if (game.currentRoundType === 'collaborative_coding') {
    notifyAllTeams(game, teamId => ({
      eventId: `round-start-${round}-${teamId}`,
      dedupeKey: `round_start:${game.gameId}:${round}:${teamId}`,
      category: 'rounds',
      priority: 'medium',
      tone: 'info',
      emoji: '💻',
      titleEn: `Collaborative Coding Challenge! (Round ${round})`,
      titleAr: `بدأ تحدي البرمجة التعاوني! (الجولة ${round})`,
      messageEn: 'Work together as a team on this coding round!',
      messageAr: 'تعاونوا معاً كفريق واحد لحل هذا التحدي!',
      now,
    }));
  } else {
    notifyAllTeams(game, teamId => ({
      eventId: `round-start-${round}-${teamId}`,
      dedupeKey: `round_start:${game.gameId}:${round}:${teamId}`,
      category: 'rounds',
      priority: 'low',
      tone: 'info',
      emoji: '🎮',
      titleEn: `Round ${round} Has Started!`,
      titleAr: `بدأت الجولة ${round}!`,
      messageEn:
        game.roundPhase === 'card_window'
          ? 'Card selection window is now open before the question is revealed.'
          : 'Get ready to answer!',
      messageAr:
        game.roundPhase === 'card_window'
          ? 'نافذة استخدام الكروت مفتوحة الآن قبل عرض السؤال.'
          : 'استعدوا للإجابة!',
      now,
    }));
  }

  // 3. Final rounds milestone alert
  if ((game.totalRounds || 0) >= 5 && (remaining === 2 || remaining === 0)) {
    notifyAllTeams(game, teamId => ({
      eventId: `final-approaching-${round}-${teamId}`,
      dedupeKey: `final_approaching:${game.gameId}:${round}:${teamId}`,
      category: 'milestones',
      priority: remaining === 0 ? 'high' : 'low',
      tone: 'warning',
      emoji: '⏳',
      titleEn: remaining === 0 ? 'The Final Round Is Here!' : 'Only a Few Rounds Remain!',
      titleAr: remaining === 0 ? 'الجولة الأخيرة الآن!' : 'لم يتبق سوى جولات قليلة!',
      messageEn:
        remaining === 0
          ? 'Last chance to score and secure your spot!'
          : `Only ${remaining} round(s) remaining after Round ${round}.`,
      messageAr:
        remaining === 0
          ? 'الفرصة الأخيرة لحسم الترتيب والنقاط!'
          : `تتبقى ${remaining} جولات فقط بعد هذه الجولة.`,
      now,
    }));
  }
}

export function notifyQuestionActiveEvents(game: GameState, now: number, activeTurnTeamId?: string): void {
  const round = game.currentRoundNumber;
  if (game.currentRoundType === 'private_round' && activeTurnTeamId) {
    const selected = game.privateRoundGroup?.selectedPlayerPerTeam?.[activeTurnTeamId];
    pushTeamNotification(game, activeTurnTeamId, {
      eventId: `priv-turn-${round}-${activeTurnTeamId}`,
      dedupeKey: `priv_turn:${game.gameId}:${round}:${activeTurnTeamId}`,
      category: 'private_rounds',
      priority: 'high',
      tone: 'info',
      emoji: '❓',
      titleEn: "It's Your Team's Turn to Answer!",
      titleAr: 'حان دور فريقك للإجابة الآن!',
      messageEn: selected
        ? `${selected.name} is up now on the main screen.`
        : 'Your private question is live on the main screen.',
      messageAr: selected
        ? `دور ${selected.name} الآن على الشاشة الرئيسية.`
        : 'سؤالكم الخاص معروض الآن على الشاشة الرئيسية.',
      now,
    });
    return;
  }

  notifyAllTeams(game, teamId => ({
    eventId: `q-active-${round}-${teamId}`,
    dedupeKey: `q_active:${game.gameId}:${round}:${teamId}`,
    category: 'rounds',
    priority: 'low',
    tone: 'info',
    emoji: '❓',
    titleEn: 'A New Question Is Ready!',
    titleAr: 'السؤال الجديد جاهز الآن!',
    messageEn: `Round ${round} question is active — submit your answer before time runs out.`,
    messageAr: `السؤال متاح الآن في الجولة ${round} — أرسلوا إجابتكم قبل انتهاء الوقت.`,
    now,
  }));
}
