export type Role = 'teacher' | 'team_portal';

export type Language = 'ar' | 'en';

export type GameStatus =
  | 'start_menu'
  | 'wizard'
  | 'waiting'
  | 'ready'
  | 'in_progress'
  | 'paused'
  | 'completed';

export type RoundType =
  | 'group_speed'
  | 'individual_teams'
  | 'hidden_cards'
  | 'collaborative_coding'
  | 'private_round';

export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'code_completion'
  | 'complete_code'
  | 'find_output'
  | 'debugging'
  | 'programming'
  | 'short_answer'
  | 'code_analysis';

export type VerificationStatus =
  | 'source_verified'
  | 'ai_verified'
  | 'needs_teacher_review'
  | 'not_provided'
  | 'conflicting';

export type AnswerSourceType =
  | 'inline'
  | 'answer_key_section'
  | 'worked_solution'
  | 'ai_verified'
  | 'safe_code_eval'
  | 'teacher_manual'
  | 'none';

export interface QualityIssue {
  code: string;
  severity: 'warning' | 'error';
  message: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface Student {
  id: string;
  name: string;
  nickname?: string;
}

export interface TeamSession {
  sessionId: string;
  userId: string;
  userEmail: string;
  operatorName?: string;
  connectedAt: number;
  lastActiveAt: number;
}

export interface TeamMember {
  studentId: string;
  name: string;
  nickname?: string;
  isLeader: boolean;
  isLocked: boolean; // Protected by Player Lock
  lockCountRemaining?: number;
  participatedInPrivateRound: boolean;
}

export interface Team {
  id: string; // 'team1', 'team2', 'team3', 'team4'
  name: string; // Default: 'Team 1', 'Team 2', 'Team 3', 'Team 4'
  color: string;
  leaderStudentId: string;
  leaderName: string;
  members: TeamMember[];
  score: number;
  streak: number;
  highestStreak: number;
  pointsAccumulatedForCards: number; // for each 200 pts
  cardsClaimedCount: number;
  secretCards: CardInstance[];
  secretCardsCount?: number; // populated in sanitized opponent views
  playerLockUsesCount?: number;
  activeSession?: TeamSession | null;
  wasInspectedBy?: string; // Anonymous alert flag if inspected
  isProtected?: boolean;
}

export type CardType =
  | 'player_swap'
  | 'player_lock'
  | 'anti_swap'
  | 'bonus_card'
  | 'minus_card'
  | 'reverse_judgment'
  | 'card_steal'
  | 'gift_player'
  | 'better_luck'
  | 'card_inspection'
  | 'double_points';

export type CardCategory = 'attack' | 'defense' | 'bonus' | 'special';

export interface CardDefinition {
  type: CardType;
  category: CardCategory;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: string;
  color: string;
  maxGlobalCopies: number; // 2 for player_swap, 1 for all others
  isDefensive: boolean;
  requiresTargetTeam: boolean;
  requiresTargetPlayer: boolean;
}

export interface CardInstance {
  id: string;
  cardType: CardType;
  copyNumber?: 1 | 2;
  acquiredAt: number;
  earnedInRound?: number;
  availableFromRound?: number;
}

export type QuestionEffectType = 'normal' | 'bonus' | 'minus';

export interface Question {
  id: string;
  questionNumber?: string;
  questionText: string; // Always verbatim in English
  codeSnippet?: string;
  type: QuestionType;
  difficulty: Difficulty;
  programmingLanguage?: string;
  topic?: string;
  options?: string[]; // for multiple choice / true_false
  correctAnswer: string; // 'NOT PROVIDED' if missing in source
  acceptedAnswers?: string[]; // alternative valid outputs / expressions
  answerStatus?: 'provided' | 'not_provided';
  answerSource?: AnswerSourceType;
  sourceAnswer?: string; // exact answer found in source document (never silently overwritten)
  aiSuggestedAnswer?: string; // independent AI / verified suggestion
  answerConfidence?: number; // 0-100
  answerExplanation?: string;
  verificationStatus?: VerificationStatus;
  qualityIssues?: QualityIssue[];
  flaggedForReview?: boolean;
  aiProcessedAt?: number;
  explanationEn?: string;
  tags?: string[];
  points: number;
  approved: boolean;
  questionEffect?: QuestionEffectType;
  questionEffectPoints?: number;
  sourcePage?: number;
  sourceExcerpt?: string;
  sourceFileName?: string;
}

export interface AnswerSubmission {
  teamId: string;
  submittedByStudentId?: string;
  submittedByName?: string;
  answer: string;
  submittedAtServerTime: number;
  responseTimeMs: number;
  isCorrect: boolean;
  pointsAwarded: number;
  basePoints?: number;
  doubledBaseBonus?: number;
  doublePointsApplied?: boolean;
  speedBonus?: number;
  streakBonus?: number;
  speedRank?: number;
  effectApplied?: QuestionEffectType;
  effectDelta?: number;
  correctAnswerSnapshot?: string;
  prevStreakSnapshot?: number;
  cardsUnlockedSnapshot?: number;
}

export type ReactionStatus =
  | 'pending'
  | 'waiting_for_response'
  | 'defended'
  | 'executed'
  | 'expired'
  | 'cancelled';

export interface ActiveReaction {
  id: string;
  requestId?: string;
  cardId?: string;
  initiatingTeamId: string;
  initiatingTeamName?: string;
  initiatingCardType: CardType;
  targetTeamId: string;
  targetTeamName?: string;
  targetStudentId?: string;
  targetStudentName?: string;
  exchangeStudentId?: string;
  exchangeStudentName?: string;
  value?: number;
  startedAt: number;
  expiresAt: number;
  executedAt?: number;
  status: ReactionStatus;
  defenseCardUsed?: CardType;
  resultMessageEn?: string;
  resultMessageAr?: string;
}

export interface PlayerSwapRecord {
  id: string;
  requestId: string;
  reactionId?: string;
  roundNumber: number;
  initiatingTeamId: string;
  initiatingTeamName: string;
  targetTeamId: string;
  targetTeamName: string;
  incomingPlayerId: string;
  incomingPlayerName: string;
  outgoingPlayerId: string;
  outgoingPlayerName: string;
  status: 'executed' | 'defended' | 'cancelled';
  timestamp: number;
  note?: string;
}

export interface TeamRankingEntry {
  teamId: string;
  teamName: string;
  color: string;
  leaderName: string;
  score: number;
  rank: number; // Standard competition rank (1, 2, 2, 4)
  diffFromLeader: number; // 0 for rank 1, negative trailing difference otherwise
  isLeader: boolean;
  isTiedRank: boolean;
  streak: number;
  membersCount: number;
}

export interface TeamRivalryEvent {
  id: string;
  roundNumber: number;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  teamAColor: string;
  teamBColor: string;
  triggeredAt: number;
  dismissed?: boolean;
}

export interface ComebackBonusEvent {
  id: string;
  roundNumber: number;
  eligibleTeamId: string;
  eligibleTeamName: string;
  eligibleTeamColor: string;
  reason: string;
  scoreDifferenceAtActivation: number;
  rewardValue: number;
  assignedQuestion: Question;
  status: 'announced' | 'question_active' | 'resolved';
  answerSubmitted?: string;
  answerResult?: 'correct' | 'incorrect' | 'skipped';
  rewardTransactionStatus: 'pending' | 'awarded' | 'none';
  activatedAt: number;
  resolvedAt?: number;
}

export interface ComebackBonusRecord {
  id: string;
  roundNumber: number;
  eligibleTeamId: string;
  eligibleTeamName: string;
  reason: string;
  scoreDifferenceAtActivation: number;
  assignedQuestionId: string;
  assignedQuestionText: string;
  rewardValue: number;
  answerSubmitted?: string;
  answerResult: 'correct' | 'incorrect' | 'skipped';
  rewardTransactionStatus: 'awarded' | 'none';
  resolvedAt: number;
}

export interface ComebackBonusState {
  usedTeamIds: string[];
  queuedTeamIds: string[];
  activeEvent?: ComebackBonusEvent | null;
  history: ComebackBonusRecord[];
}

export interface ActiveDoublePoints {
  cardId: string;
  cardTitle: string;
  roundNumber: number;
  activatedAt: number;
}

export type SoundEventType =
  | 'match_start'
  | 'round_start'
  | 'question_reveal'
  | 'correct_answer'
  | 'incorrect_answer'
  | 'card_reveal'
  | 'player_swap'
  | 'private_round_intro'
  | 'team_rivalry_intro'
  | 'comeback_bonus'
  | 'leader_change'
  | 'final_ceremony'
  | 'champion_reveal';

export interface SoundEventRecord {
  id: string;
  type: SoundEventType;
  roundNumber: number;
  timestamp: number;
  teamId?: string;
  label?: string;
}

export interface FinalMatchSummary {
  completedAt: number;
  totalRoundsCompleted: number;
  totalQuestionsAnswered: number;
  correctAnswersCount: number;
  incorrectAnswersCount: number;
  isTieForFirst: boolean;
  championTeamIds: string[];
  championTeamNames: string[];
  standings: TeamRankingEntry[];
}

export interface CeremonyState {
  ceremonyCompleted: boolean;
  skippedAt?: number;
  completedAt?: number;
  summary: FinalMatchSummary;
}

export interface GiftDraft {
  id: string;
  cardId: string;
  initiatingTeamId: string;
  targetTeamId: string;
  targetTeamName: string;
  draftedStudentId: string;
  draftedStudentName: string;
  createdAt: number;
}

export interface InspectionSnapshot {
  id: string;
  inspectingTeamId: string;
  targetTeamId: string;
  targetTeamName: string;
  cards: CardInstance[];
  mode: 'reveal_all' | 'reveal_one_random';
  inspectedAt: number;
}

export interface GameSettings {
  totalRounds: number; // default 50, max 70
  groupSpeedTimerSeconds: number; // default 45s
  individualTimerSeconds: number; // default 60s
  cardWindowSeconds: number; // 20s for private rounds
  reactionWindowSeconds: number; // default 15s
  streakBonusPercent: number; // default 10%
  pointsPer200ForCard: number; // 200
  questionBonusPoints: number; // default 50
  questionMinusPoints: number; // default 50
  questionBonusChancePercent: number; // default 15
  questionMinusChancePercent: number; // default 10
  comebackBonusPoints: number; // default 250, teacher configurable before match start
  defensiveCardLimitMode: 'free_defense' | 'counts_against_round_limit';
  playerLockMode: 'two_players' | 'two_uses_any';
  cardInspectionMode: 'reveal_all' | 'reveal_one_random';
  playerSwapMode: 'direct_transfer' | 'must_compensate';
  streakRepeatMode: 'every_answer_after_three' | 'once_on_milestone';
  cardWindowScope: 'private_rounds_only' | 'all_rounds';
  privateRoundScoring: 'fixed_by_difficulty' | 'flat_bonus';
}

export interface ScoreTransaction {
  id: string;
  timestamp: number;
  roundNumber: number;
  teamId: string;
  teamName: string;
  pointsChange: number;
  previousScore: number;
  newScore: number;
  reasonAr: string;
  reasonEn: string;
  performedBy: string;
  breakdown?: {
    basePoints?: number;
    doubledBaseBonus?: number;
    doublePointsApplied?: boolean;
    speedBonus?: number;
    streakBonus?: number;
    effectDelta?: number;
    comebackPoints?: number;
  };
}

export interface AuditLog {
  id: string;
  timestamp: number;
  roundNumber: number;
  category: 'game' | 'round' | 'answer' | 'score' | 'card' | 'admin';
  messageAr: string;
  messageEn: string;
  details?: Record<string, any>;
}

export interface ScheduledRound {
  roundNumber: number;
  roundType: RoundType;
  questionId: string;
  questionEffect?: QuestionEffectType;
  isPrivateGroupRound?: boolean;
  privateRoundIndex?: number;
  privateQuestionsByTeam?: Record<string, { questionId: string; effect: QuestionEffectType }>;
  privateTeamOrder?: string[];
  isCollaborative?: boolean;
}

export interface WizardData {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  selectedLeaderIds: string[];
  uploadedQuestions: Question[];
  questionValidationWarnings: string[];
  isTeamsGenerated: boolean;
}

export interface GameState {
  gameId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: GameStatus;
  currentRoundNumber: number;
  totalRounds: number;
  currentRoundType: RoundType;

  wizard?: WizardData;
  sessionCode?: string;
  sessionJoinUrl?: string;

  roundSchedule: ScheduledRound[];
  teams: Record<string, Team>;
  currentQuestion?: Question;

  roundPhase: 'idle' | 'card_window' | 'question_active' | 'evaluating' | 'round_ended';
  cardWindowEndsAt?: number;
  questionTimerEndsAt?: number;

  answers: Record<string, AnswerSubmission>;
  roundStats?: {
    completedRoundsCount: number;
    totalQuestionsAnswered: number;
    correctAnswersCount: number;
    incorrectAnswersCount: number;
  };

  privateRoundGroup: {
    isInPrivateGroup: boolean;
    batchNumber: number;
    roundIndexInBatch: number;
    selectedPlayerPerTeam: Record<string, { studentId: string; name: string }>;
    participatedStudentsInBatch: Record<string, string[]>;
    activeTurnIndex?: number;
    teamOrder?: string[];
    questionsByTeam?: Record<string, Question>;
    turnSubmissions?: Record<string, AnswerSubmission>;
    warnings?: string[];
  };

  globalCardPoolRemaining: Record<CardType, number>;
  cardsUsedThisRound: Record<string, CardType[]>;
  activeDoublePointsByTeam?: Record<string, ActiveDoublePoints>;
  activeReactions: ActiveReaction[];
  swapHistory?: PlayerSwapRecord[];
  processedSwapRequestIds?: string[];
  pendingGiftDrafts?: Record<string, GiftDraft>;
  lastInspectionByTeam?: Record<string, InspectionSnapshot>;

  activeRivalry?: TeamRivalryEvent | null;
  rivalryHistory?: TeamRivalryEvent[];
  comebackBonus?: ComebackBonusState;
  soundEvents?: SoundEventRecord[];
  ceremony?: CeremonyState | null;

  notificationsByTeam?: Record<string, TeamNotification[]>;
  lastConfirmedRankings?: Record<string, ConfirmedTeamRankSnapshot>;
  milestoneNotifiedByTeam?: Record<string, number[]>;

  scoreTransactions: ScoreTransaction[];
  auditLogs: AuditLog[];
  settings: GameSettings;
}

export type NotificationCategory =
  | 'points'
  | 'ranking'
  | 'cards'
  | 'player_exchange'
  | 'comeback'
  | 'double_points'
  | 'rivalry'
  | 'rounds'
  | 'private_rounds'
  | 'match_status'
  | 'team_activity'
  | 'milestones';

export type NotificationPriority = 'high' | 'medium' | 'low';

export type NotificationTone = 'positive' | 'negative' | 'warning' | 'info';

export interface TeamNotification {
  id: string;
  eventId: string;
  dedupeKey: string;
  gameId: string;
  teamId: string;
  roundNumber: number;
  category: NotificationCategory;
  priority: NotificationPriority;
  tone: NotificationTone;
  emoji: string;
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  durationMs: number;
  timestamp: number;
  read: boolean;
  readAt?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ConfirmedTeamRankSnapshot {
  rank: number;
  isTied: boolean;
  score: number;
  diffFromLeader: number;
}

export interface TeamNotificationPreferences {
  toastsEnabled: boolean;
  toastDurationMs: 2500 | 3500 | 5000;
  showLowPriority: boolean;
}

