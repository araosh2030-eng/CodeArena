import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  GameState,
  NotificationCategory,
  Question,
  Student,
  TeamNotification,
  TeamSession
} from '../types/game';
import {
  DEFAULT_SETTINGS,
  REGISTERED_STUDENTS
} from '../game/defaultData';
import {
  createInitialComebackState,
  createTeamsFromStudents,
  getInitialGlobalCardPool,
  shouldRevealAnswerResult,
  validateTeamRosters
} from '../game/rules';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.resolve(DATA_DIR, 'game_store.json');
const TOKEN_SECRET = process.env.SESSION_SECRET || 'codearena-session-hmac-secret-2026';

export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string;
  displayName?: string;
  role: 'user' | 'teacher';
  createdAt: number;
}

export interface PublicUserAccount {
  id: string;
  email: string;
  displayName?: string;
  role: 'user' | 'teacher';
  createdAt: number;
}

export interface StoreData {
  currentGame: GameState;
  savedGames: GameState[];
  students: Student[];
  questionBank: Question[];
  users: UserAccount[];
}

function hashPassword(password: string, existingSalt?: string): string {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (storedHash.includes(':')) {
    const [salt, keyHex] = storedHash.split(':');
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
  }
  // Legacy plain equality fallback for previously stored dev accounts
  return password === storedHash;
}

export function createAuthToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAuthToken(token: string): string | null {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
    if (sig !== expected) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return decoded.uid || null;
  } catch {
    return null;
  }
}

export function toPublicUser(user: UserAccount): PublicUserAccount {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function initializeDefaultGameState(): GameState {
  const teams = createTeamsFromStudents(REGISTERED_STUDENTS);
  const now = Date.now();

  return {
    gameId: `game-${now}`,
    name: 'مسابقة التكنولوجيا التطبيقية 2026',
    createdAt: now,
    updatedAt: now,
    status: 'start_menu',
    currentRoundNumber: 1,
    totalRounds: 50,
    currentRoundType: 'group_speed',
    sessionCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
    roundSchedule: [],
    teams,
    roundPhase: 'idle',
    answers: {},
    roundStats: {
      completedRoundsCount: 0,
      totalQuestionsAnswered: 0,
      correctAnswersCount: 0,
      incorrectAnswersCount: 0,
    },
    privateRoundGroup: {
      isInPrivateGroup: false,
      batchNumber: 0,
      roundIndexInBatch: 0,
      selectedPlayerPerTeam: {},
      participatedStudentsInBatch: {
        team1: [],
        team2: [],
        team3: [],
        team4: [],
      },
    },
    globalCardPoolRemaining: getInitialGlobalCardPool(),
    cardsUsedThisRound: {
      team1: [],
      team2: [],
      team3: [],
      team4: [],
    },
    activeDoublePointsByTeam: {},
    activeReactions: [],
    swapHistory: [],
    processedSwapRequestIds: [],
    pendingGiftDrafts: {},
    lastInspectionByTeam: {},
    activeRivalry: null,
    rivalryHistory: [],
    comebackBonus: createInitialComebackState(),
    soundEvents: [],
    ceremony: null,
    notificationsByTeam: { team1: [], team2: [], team3: [], team4: [] },
    lastConfirmedRankings: {},
    milestoneNotifiedByTeam: {},
    scoreTransactions: [],
    auditLogs: [
      {
        id: `log-${now}`,
        timestamp: now,
        roundNumber: 1,
        category: 'game',
        messageAr: 'مرحباً بك في منصة CodeArena',
        messageEn: 'Welcome to CodeArena Competition Platform',
      },
    ],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function hydrateMissingGameFields(game: GameState): GameState {
  game.settings = { ...DEFAULT_SETTINGS, ...(game.settings || {}) };
  if (!game.globalCardPoolRemaining) {
    game.globalCardPoolRemaining = getInitialGlobalCardPool();
  } else if (game.globalCardPoolRemaining.double_points === undefined) {
    game.globalCardPoolRemaining.double_points = 1;
  }
  if (!game.activeDoublePointsByTeam) game.activeDoublePointsByTeam = {};
  if (!game.swapHistory) game.swapHistory = [];
  if (!game.processedSwapRequestIds) game.processedSwapRequestIds = [];
  if (!game.rivalryHistory) game.rivalryHistory = [];
  if (!game.comebackBonus) game.comebackBonus = createInitialComebackState();
  if (!game.soundEvents) game.soundEvents = [];
  if (!game.notificationsByTeam) game.notificationsByTeam = {};
  for (const tid of Object.keys(game.teams || {})) {
    if (!Array.isArray(game.notificationsByTeam[tid])) {
      game.notificationsByTeam[tid] = [];
    }
  }
  if (!game.lastConfirmedRankings) game.lastConfirmedRankings = {};
  if (!game.milestoneNotifiedByTeam) game.milestoneNotifiedByTeam = {};
  if (!game.roundStats) {
    game.roundStats = {
      completedRoundsCount: Math.max(0, (game.currentRoundNumber || 1) - 1),
      totalQuestionsAnswered: 0,
      correctAnswersCount: 0,
      incorrectAnswersCount: 0,
    };
  }
  return game;
}

class GameStorage {
  private data: StoreData;

  constructor() {
    this.data = this.loadFromDisk();
  }

  private loadFromDisk(): StoreData {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.currentGame && parsed.savedGames) {
          // Ensure decoupled users array migration safety
          const migratedUsers: UserAccount[] = Array.isArray(parsed.users)
            ? parsed.users.map((u: any) => ({
                id: u.id,
                email: u.email,
                passwordHash: u.passwordHash,
                displayName: u.displayName || undefined,
                role: u.role === 'teacher' ? 'teacher' : 'user',
                createdAt: u.createdAt || Date.now(),
              }))
            : [];

          const hydratedCurrent = hydrateMissingGameFields(parsed.currentGame);
          const hydratedSaved = Array.isArray(parsed.savedGames)
            ? parsed.savedGames.map((sg: GameState) => hydrateMissingGameFields(sg))
            : [];

          return {
            currentGame: hydratedCurrent,
            savedGames: hydratedSaved,
            students: [...REGISTERED_STUDENTS],
            questionBank: Array.isArray(parsed.questionBank) ? parsed.questionBank : [],
            users: migratedUsers,
          };
        }
      }
    } catch (err) {
      console.warn('Could not read existing game store, generating fresh state:', err);
    }

    return {
      currentGame: initializeDefaultGameState(),
      savedGames: [],
      students: [...REGISTERED_STUDENTS],
      questionBank: [],
      users: [],
    };
  }

  public saveToDisk(throwOnError = false): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write game store to disk:', err);
      if (throwOnError) {
        throw err;
      }
    }
  }

  public getCurrentGame(): GameState {
    return this.data.currentGame;
  }

  public setCurrentGame(game: GameState): void {
    this.data.currentGame = {
      ...game,
      updatedAt: Date.now(),
    };
    this.saveToDisk();
  }

  /**
   * Executes a multi-entity state mutation inside an atomic in-memory clone + rollback barrier.
   * Any thrown error or roster integrity failure restores pre-transaction game state untouched.
   */
  public runAtomicGameMutation<T>(mutator: (draft: GameState) => T): T {
    const previousSnapshot: GameState = JSON.parse(JSON.stringify(this.data.currentGame));
    const draft: GameState = JSON.parse(JSON.stringify(this.data.currentGame));
    try {
      const result = mutator(draft);
      if (draft.teams && Object.keys(draft.teams).length === 4) {
        const rosterCheck = validateTeamRosters(draft.teams);
        if (!rosterCheck.isValid) {
          throw new Error(rosterCheck.error || 'Atomic roster integrity check failed.');
        }
      }
      draft.updatedAt = Date.now();
      this.data.currentGame = draft;
      this.saveToDisk(true);
      return result;
    } catch (err) {
      this.data.currentGame = previousSnapshot;
      throw err;
    }
  }

  /**
   * Produces a team-scoped sanitized GameState for mobile portals:
   * - Never leaks other teams' secret card inventories
   * - Never leaks correctAnswer or answer correctness before roundPhase allows evaluation
   * - Scopes pendingGiftDrafts & lastInspectionByTeam strictly to the owning team
   */
  public getSanitizedStateForTeam(game: GameState, teamId?: string): GameState {
    const canReveal = shouldRevealAnswerResult(game.roundPhase);
    const isHiddenPhase = game.roundPhase === 'card_window' || game.roundPhase === 'idle';
    const isPrivateRound = game.currentRoundType === 'private_round';
    const sanitizedTeams: Record<string, any> = {};

    for (const [id, team] of Object.entries(game.teams || {})) {
      const isOwn = !!teamId && id === teamId;
      const turnAlreadyRevealed = isPrivateRound && !!game.privateRoundGroup?.turnSubmissions?.[id];
      const pendingAns = !canReveal && !turnAlreadyRevealed ? game.answers?.[id] : undefined;
      const deferredPts = Math.max(0, pendingAns?.pointsAwarded || 0);
      sanitizedTeams[id] = {
        ...team,
        score: Math.max(0, team.score - deferredPts),
        secretCards: isOwn ? team.secretCards : [],
        secretCardsCount: team.secretCards.length,
      };
    }

    const sanitizedAnswers: Record<string, any> = {};
    for (const [tId, ans] of Object.entries(game.answers || {})) {
      const turnAlreadyRevealed = isPrivateRound && !!game.privateRoundGroup?.turnSubmissions?.[tId];
      if (canReveal || turnAlreadyRevealed) {
        sanitizedAnswers[tId] = ans;
      } else {
        sanitizedAnswers[tId] = {
          ...ans,
          isCorrect: false,
          pointsAwarded: 0,
          speedRank: undefined,
          effectApplied: undefined,
          effectDelta: undefined,
          correctAnswerSnapshot: undefined,
          prevStreakSnapshot: undefined,
          cardsUnlockedSnapshot: undefined,
        };
      }
    }

    const sanitizedQuestion =
      !isHiddenPhase && game.currentQuestion
        ? canReveal
          ? game.currentQuestion
          : {
              ...game.currentQuestion,
              correctAnswer: '',
              acceptedAnswers: undefined,
              sourceAnswer: undefined,
              aiSuggestedAnswer: undefined,
              answerExplanation: undefined,
              explanationEn: undefined,
            }
        : undefined;

    const sanitizedPrivateGroup = game.privateRoundGroup
      ? {
          ...game.privateRoundGroup,
          questionsByTeam: undefined,
        }
      : game.privateRoundGroup;

    const scopedDrafts =
      teamId && game.pendingGiftDrafts?.[teamId]
        ? { [teamId]: game.pendingGiftDrafts[teamId] }
        : {};

    const scopedInspections =
      teamId && game.lastInspectionByTeam?.[teamId]
        ? { [teamId]: game.lastInspectionByTeam[teamId] }
        : {};

    const sanitizedComeback = game.comebackBonus
      ? {
          ...game.comebackBonus,
          activeEvent: game.comebackBonus.activeEvent
            ? {
                ...game.comebackBonus.activeEvent,
                assignedQuestion:
                  game.comebackBonus.activeEvent.status === 'resolved'
                    ? game.comebackBonus.activeEvent.assignedQuestion
                    : {
                        ...game.comebackBonus.activeEvent.assignedQuestion,
                        correctAnswer: '',
                        acceptedAnswers: undefined,
                        sourceAnswer: undefined,
                        aiSuggestedAnswer: undefined,
                        answerExplanation: undefined,
                        explanationEn: undefined,
                      },
              }
            : null,
        }
      : undefined;

    const scopedNotifications =
      teamId && game.notificationsByTeam?.[teamId]
        ? { [teamId]: game.notificationsByTeam[teamId] }
        : teamId
        ? { [teamId]: [] }
        : {};

    return {
      ...game,
      wizard: undefined,
      teams: sanitizedTeams,
      answers: sanitizedAnswers,
      currentQuestion: sanitizedQuestion,
      privateRoundGroup: sanitizedPrivateGroup,
      pendingGiftDrafts: scopedDrafts,
      lastInspectionByTeam: scopedInspections,
      comebackBonus: sanitizedComeback,
      notificationsByTeam: scopedNotifications,
      lastConfirmedRankings: undefined,
      milestoneNotifiedByTeam: undefined,
    };
  }

  public startNewGameWizard(): GameState {
    const now = Date.now();
    const sessionCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const newGame: GameState = {
      gameId: `game-${now}`,
      name: `مسابقة البرمجة - ${new Date().toLocaleDateString('ar-EG')}`,
      createdAt: now,
      updatedAt: now,
      status: 'wizard',
      currentRoundNumber: 1,
      totalRounds: 50,
      currentRoundType: 'group_speed',
      sessionCode,
      roundSchedule: [],
      wizard: {
        step: 1,
        selectedLeaderIds: [],
        uploadedQuestions: [],
        questionValidationWarnings: [],
        isTeamsGenerated: false,
      },
      teams: {},
      roundPhase: 'idle',
      answers: {},
      roundStats: {
        completedRoundsCount: 0,
        totalQuestionsAnswered: 0,
        correctAnswersCount: 0,
        incorrectAnswersCount: 0,
      },
      privateRoundGroup: {
        isInPrivateGroup: false,
        batchNumber: 0,
        roundIndexInBatch: 0,
        selectedPlayerPerTeam: {},
        participatedStudentsInBatch: {
          team1: [],
          team2: [],
          team3: [],
          team4: [],
        },
      },
      globalCardPoolRemaining: getInitialGlobalCardPool(),
      cardsUsedThisRound: {
        team1: [],
        team2: [],
        team3: [],
        team4: [],
      },
      activeDoublePointsByTeam: {},
      activeReactions: [],
      swapHistory: [],
      processedSwapRequestIds: [],
      pendingGiftDrafts: {},
      lastInspectionByTeam: {},
      activeRivalry: null,
      rivalryHistory: [],
      comebackBonus: createInitialComebackState(),
      soundEvents: [],
      ceremony: null,
      notificationsByTeam: {},
      lastConfirmedRankings: {},
      milestoneNotifiedByTeam: {},
      scoreTransactions: [],
      auditLogs: [
        {
          id: `log-${now}`,
          timestamp: now,
          roundNumber: 1,
          category: 'game',
          messageAr: 'بدء خطوات معالج إنشاء مباراة جديدة (New Game Wizard)',
          messageEn: 'Started New Game Wizard setup flow',
        },
      ],
      settings: { ...DEFAULT_SETTINGS },
    };

    this.data.currentGame = newGame;
    this.saveToDisk();
    return newGame;
  }

  public saveCurrentGame(): GameState {
    const game = this.data.currentGame;
    const existingIndex = this.data.savedGames.findIndex(g => g.gameId === game.gameId);
    if (existingIndex >= 0) {
      this.data.savedGames[existingIndex] = { ...game };
    } else {
      this.data.savedGames.unshift({ ...game });
    }
    this.saveToDisk();
    return game;
  }

  public loadGame(gameId: string): GameState | null {
    const target = this.data.savedGames.find(g => g.gameId === gameId);
    if (!target) return null;

    this.saveCurrentGame();

    this.data.currentGame = {
      ...target,
      updatedAt: Date.now(),
      status: target.status === 'in_progress' ? 'paused' : target.status,
    };
    this.saveToDisk();
    return this.data.currentGame;
  }

  public returnToStartMenu(): GameState {
    this.data.currentGame.status = 'start_menu';
    this.saveToDisk();
    return this.data.currentGame;
  }

  public getSavedGames(): Array<{
    gameId: string;
    name: string;
    createdAt: number;
    currentRound: number;
    status: string;
  }> {
    return this.data.savedGames.map(g => ({
      gameId: g.gameId,
      name: g.name,
      createdAt: g.createdAt,
      currentRound: g.currentRoundNumber,
      status: g.status,
    }));
  }

  public getStudents(): Student[] {
    return this.data.students;
  }

  public getQuestionBank(): Question[] {
    return this.data.questionBank;
  }

  public setQuestionBank(questions: Question[]): void {
    this.data.questionBank = questions;
    this.saveToDisk();
  }

  public addQuestion(question: Question): Question {
    this.data.questionBank.unshift(question);
    this.saveToDisk();
    return question;
  }

  public updateQuestion(id: string, updates: Partial<Question>): Question | null {
    const index = this.data.questionBank.findIndex(q => q.id === id);
    if (index === -1) return null;
    this.data.questionBank[index] = { ...this.data.questionBank[index], ...updates };
    this.saveToDisk();
    return this.data.questionBank[index];
  }

  public deleteQuestion(id: string): boolean {
    const prevLen = this.data.questionBank.length;
    this.data.questionBank = this.data.questionBank.filter(q => q.id !== id);
    if (this.data.questionBank.length !== prevLen) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  /**
   * Independent User Account registration (Email + Password only).
   * Completely decoupled from the 22-student competition roster.
   */
  public registerUser(
    email: string,
    password: string,
    displayName?: string
  ): { success: boolean; error?: string; user?: PublicUserAccount; token?: string } {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { success: false, error: 'Please enter a valid email address.' };
    }
    if (!password || password.length < 4) {
      return { success: false, error: 'Password must be at least 4 characters.' };
    }

    const emailInUse = this.data.users.some(u => u.email.toLowerCase() === cleanEmail);
    if (emailInUse) {
      return { success: false, error: 'This email is already registered. Please sign in.' };
    }

    const newUser: UserAccount = {
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      email: cleanEmail,
      passwordHash: hashPassword(password),
      displayName: displayName?.trim() || undefined,
      role: 'user',
      createdAt: Date.now(),
    };

    this.data.users.push(newUser);
    this.saveToDisk();

    return {
      success: true,
      user: toPublicUser(newUser),
      token: createAuthToken(newUser.id),
    };
  }

  public loginUser(
    email: string,
    password: string
  ): { user: PublicUserAccount; token: string } | null {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = this.data.users.find(u => u.email.toLowerCase() === cleanEmail);
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return {
      user: toPublicUser(user),
      token: createAuthToken(user.id),
    };
  }

  public getUserById(userId: string): PublicUserAccount | null {
    const user = this.data.users.find(u => u.id === userId);
    return user ? toPublicUser(user) : null;
  }

  /**
   * Connects an authenticated user session to a team in the active game.
   * Enforces single active leader-controller session per team unless forceTakeover is true.
   * Never mutates team.members, team.leaderStudentId, or team.leaderName.
   */
  public joinTeamSession(params: {
    teamId: string;
    user: PublicUserAccount;
    operatorName?: string;
    forceTakeover?: boolean;
  }): {
    success: boolean;
    conflict?: boolean;
    existingOperator?: string;
    session?: TeamSession;
    error?: string;
  } {
    const { teamId, user, operatorName, forceTakeover } = params;
    const game = this.data.currentGame;
    const team = game.teams[teamId];

    if (!team) {
      return { success: false, error: 'Selected team does not exist in the current match.' };
    }

    const now = Date.now();
    const existing = team.activeSession;
    const SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

    if (
      existing &&
      existing.userId !== user.id &&
      now - existing.lastActiveAt < SESSION_TTL_MS &&
      !forceTakeover
    ) {
      return {
        success: false,
        conflict: true,
        existingOperator: existing.operatorName || existing.userEmail,
        error: `${team.name} already has an active controller session (${existing.operatorName || existing.userEmail}).`,
      };
    }

    // Clear any previous team session owned by this user on other teams so one user controls one team at a time
    for (const t of Object.values(game.teams)) {
      if (t.id !== teamId && t.activeSession?.userId === user.id) {
        t.activeSession = null;
      }
    }

    const session: TeamSession = {
      sessionId: `sess-${now}-${Math.random().toString(36).substring(2, 7)}`,
      userId: user.id,
      userEmail: user.email,
      operatorName: operatorName?.trim() || user.displayName || undefined,
      connectedAt: existing?.userId === user.id ? existing.connectedAt : now,
      lastActiveAt: now,
    };

    team.activeSession = session;
    this.setCurrentGame(game);

    return { success: true, session };
  }

  public leaveTeamSession(teamId: string, userId: string): boolean {
    const game = this.data.currentGame;
    const team = game.teams[teamId];
    if (!team || !team.activeSession) return false;
    if (team.activeSession.userId !== userId) return false;
    team.activeSession = null;
    this.setCurrentGame(game);
    return true;
  }

  public getTeamNotifications(
    teamId: string,
    opts?: {
      category?: NotificationCategory | 'all';
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
    }
  ): {
    notifications: TeamNotification[];
    unreadCount: number;
    totalCount: number;
  } {
    const game = this.data.currentGame;
    const allForTeam = [...(game.notificationsByTeam?.[teamId] || [])].sort(
      (a, b) => b.timestamp - a.timestamp
    );
    const unreadCount = allForTeam.filter(n => !n.read).length;

    let filtered = allForTeam;
    if (opts?.unreadOnly) {
      filtered = filtered.filter(n => !n.read);
    }
    if (opts?.category && opts.category !== 'all') {
      filtered = filtered.filter(n => n.category === opts.category);
    }

    const offset = Math.max(0, opts?.offset ?? 0);
    const limit = Math.max(1, Math.min(160, opts?.limit ?? 100));

    return {
      notifications: filtered.slice(offset, offset + limit),
      unreadCount,
      totalCount: filtered.length,
    };
  }

  public markTeamNotificationRead(teamId: string, notificationId: string): boolean {
    const game = this.data.currentGame;
    const list = game.notificationsByTeam?.[teamId];
    if (!list) return false;
    const target = list.find(n => n.id === notificationId);
    if (!target) return false;
    if (!target.read) {
      target.read = true;
      target.readAt = Date.now();
      this.setCurrentGame(game);
    }
    return true;
  }

  public markAllTeamNotificationsRead(teamId: string): number {
    const game = this.data.currentGame;
    const list = game.notificationsByTeam?.[teamId];
    if (!list) return 0;
    const now = Date.now();
    let count = 0;
    for (const item of list) {
      if (!item.read) {
        item.read = true;
        item.readAt = now;
        count++;
      }
    }
    if (count > 0) {
      this.setCurrentGame(game);
    }
    return count;
  }
}

export const gameStorage = new GameStorage();
