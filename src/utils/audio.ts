import { SoundEventRecord, SoundEventType } from '../types/game';

export type SoundCategory = 'gameplay' | 'cards' | 'events' | 'ceremony';

export interface SoundSettings {
  masterVolume: number; // 0..1
  sfxVolume: number; // 0..1
  isMuted: boolean;
  categories: Record<SoundCategory, boolean>;
}

const STORAGE_KEY = 'codearena_sound_settings_v2';

const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  masterVolume: 0.85,
  sfxVolume: 0.9,
  isMuted: false,
  categories: {
    gameplay: true,
    cards: true,
    events: true,
    ceremony: true,
  },
};

export const SOUND_EVENT_META: Record<
  SoundEventType,
  { category: SoundCategory; priority: number; labelEn: string; labelAr: string }
> = {
  match_start: { category: 'gameplay', priority: 3, labelEn: 'Match Start', labelAr: 'بدء المسابقة' },
  round_start: { category: 'gameplay', priority: 1, labelEn: 'Round Start', labelAr: 'بداية الجولة' },
  question_reveal: { category: 'gameplay', priority: 2, labelEn: 'Question Reveal', labelAr: 'كشف السؤال' },
  correct_answer: { category: 'gameplay', priority: 2, labelEn: 'Correct Answer', labelAr: 'إجابة صحيحة' },
  incorrect_answer: { category: 'gameplay', priority: 2, labelEn: 'Incorrect Answer', labelAr: 'إجابة خاطئة' },
  card_reveal: { category: 'cards', priority: 2, labelEn: 'Card Draw / Reveal', labelAr: 'سحب / تفعيل كارت' },
  player_swap: { category: 'cards', priority: 3, labelEn: 'Player Swap', labelAr: 'تبديل اللاعبين' },
  private_round_intro: { category: 'events', priority: 3, labelEn: 'Private Round Intro', labelAr: 'بداية الجولة الخاصة' },
  team_rivalry_intro: { category: 'events', priority: 3, labelEn: 'Team Rivalry Intro', labelAr: 'مواجهة الفريقين' },
  comeback_bonus: { category: 'events', priority: 4, labelEn: 'Comeback Bonus', labelAr: 'فرصة العودة' },
  leader_change: { category: 'events', priority: 3, labelEn: 'Leader Change', labelAr: 'تغير المتصدر' },
  final_ceremony: { category: 'ceremony', priority: 4, labelEn: 'Final Ceremony', labelAr: 'الحفل الختامي' },
  champion_reveal: { category: 'ceremony', priority: 5, labelEn: 'Champion Reveal', labelAr: 'إعلان البطل' },
};

function isMobilePortalEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.pathname.startsWith('/play') ||
    window.location.search.includes('portal=team') ||
    window.location.search.includes('gameId=')
  );
}

/**
 * Teacher-only Audio Engine built on Web Audio API synthesis with optional custom file fallback,
 * persisted user volume/category preferences, autoplay-safe unlock, event-ID deduping, and overlap protection.
 */
class SoundEffectsManager {
  private ctx: AudioContext | null = null;
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS, categories: { ...DEFAULT_SOUND_SETTINGS.categories } };
  private playedEventIds: Set<string> = new Set();
  private seededInitialEvents: boolean = false;
  private lastPlayedAt: number = 0;
  private lastPlayedPriority: number = 0;
  private listeners: Set<() => void> = new Set();

  // Optional custom audio file mapping if local assets are provided under /public/sounds/
  private customUrls: Partial<Record<SoundEventType, string>> = {};

  constructor() {
    this.loadSettings();
  }

  private loadSettings() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.settings = {
          masterVolume: typeof parsed.masterVolume === 'number' ? Math.max(0, Math.min(1, parsed.masterVolume)) : 0.85,
          sfxVolume: typeof parsed.sfxVolume === 'number' ? Math.max(0, Math.min(1, parsed.sfxVolume)) : 0.9,
          isMuted: !!parsed.isMuted,
          categories: {
            gameplay: parsed.categories?.gameplay ?? true,
            cards: parsed.categories?.cards ?? true,
            events: parsed.categories?.events ?? true,
            ceremony: parsed.categories?.ceremony ?? true,
          },
        };
      }
    } catch {
      // Keep default settings
    }
  }

  private persistSettings() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore storage quota issues
    }
    this.listeners.forEach(fn => fn());
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public getSettings(): SoundSettings {
    return { ...this.settings, categories: { ...this.settings.categories } };
  }

  public updateSettings(partial: Partial<SoundSettings>) {
    this.settings = {
      ...this.settings,
      ...partial,
      categories: {
        ...this.settings.categories,
        ...(partial.categories || {}),
      },
    };
    this.persistSettings();
  }

  public setCategoryEnabled(category: SoundCategory, enabled: boolean) {
    this.settings.categories[category] = enabled;
    this.persistSettings();
  }

  public toggleMute(): boolean {
    this.settings.isMuted = !this.settings.isMuted;
    this.persistSettings();
    return this.settings.isMuted;
  }

  public getMuted(): boolean {
    return this.settings.isMuted;
  }

  public unlockAudio() {
    if (typeof window === 'undefined' || isMobilePortalEnvironment()) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private getEffectiveGain(category: SoundCategory): number {
    if (isMobilePortalEnvironment()) return 0;
    if (this.settings.isMuted) return 0;
    if (!this.settings.categories[category]) return 0;
    return Math.max(0, Math.min(1, this.settings.masterVolume * this.settings.sfxVolume));
  }

  private getContext(category: SoundCategory): { ctx: AudioContext; vol: number } | null {
    const vol = this.getEffectiveGain(category);
    if (vol <= 0.001 || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (!this.ctx) return null;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return { ctx: this.ctx, vol };
  }

  public seedInitialEvents(events: SoundEventRecord[] | undefined) {
    if (this.seededInitialEvents) return;
    this.seededInitialEvents = true;
    for (const ev of events || []) {
      this.playedEventIds.add(ev.id);
    }
  }

  public resetEventDedupe() {
    this.playedEventIds.clear();
    this.seededInitialEvents = false;
  }

  public processSoundEvents(events: SoundEventRecord[] | undefined) {
    if (isMobilePortalEnvironment() || !events || events.length === 0) return;

    // On initial mount / refresh, mark existing historical events as seen without replaying them
    if (!this.seededInitialEvents) {
      this.seedInitialEvents(events);
      return;
    }

    const unseen = events.filter(ev => !this.playedEventIds.has(ev.id));
    if (unseen.length === 0) return;

    // Keep highest-priority event first if multiple arrived in the same SSE frame
    const sorted = [...unseen].sort(
      (a, b) => (SOUND_EVENT_META[b.type]?.priority || 1) - (SOUND_EVENT_META[a.type]?.priority || 1)
    );

    unseen.forEach(ev => {
      this.playedEventIds.add(ev.id);
    });
    if (this.playedEventIds.size > 250) {
      const trimmed = Array.from(this.playedEventIds).slice(-150);
      this.playedEventIds = new Set(trimmed);
    }

    // Play highest-priority cue immediately and stagger up to one secondary cue cleanly
    const primary = sorted[0];
    this.playSoundEvent(primary.type);
    if (sorted.length > 1) {
      const secondary = sorted[1];
      setTimeout(() => this.playSoundEvent(secondary.type), 260);
    }
  }

  private playToneSequence(
    category: SoundCategory,
    notes: Array<{
      freq: number;
      endFreq?: number;
      offset: number;
      duration: number;
      type?: OscillatorType;
      gainScale?: number;
    }>
  ) {
    const res = this.getContext(category);
    if (!res) return;
    const { ctx, vol } = res;
    const now = ctx.currentTime;

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type || 'triangle';
      const startT = now + note.offset;
      const peakGain = Math.max(0.005, vol * (note.gainScale ?? 0.22));
      osc.frequency.setValueAtTime(note.freq, startT);
      if (note.endFreq !== undefined) {
        osc.frequency.linearRampToValueAtTime(note.endFreq, startT + note.duration);
      }
      gain.gain.setValueAtTime(0.0001, startT);
      gain.gain.linearRampToValueAtTime(peakGain, startT + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startT + note.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startT);
      osc.stop(startT + note.duration + 0.02);
    }
  }

  public playSoundEvent(type: SoundEventType) {
    if (isMobilePortalEnvironment()) return;
    const meta = SOUND_EVENT_META[type];
    if (!meta) return;

    const vol = this.getEffectiveGain(meta.category);
    if (vol <= 0.001) return;

    // Overlap / anti-cacophony guard
    const nowMs = Date.now();
    if (nowMs - this.lastPlayedAt < 110 && meta.priority <= this.lastPlayedPriority) {
      return;
    }
    this.lastPlayedAt = nowMs;
    this.lastPlayedPriority = meta.priority;

    // Optional external asset override with automatic synthesis fallback
    const customUrl = this.customUrls[type];
    if (customUrl && typeof Audio !== 'undefined') {
      try {
        const audio = new Audio(customUrl);
        audio.volume = vol;
        audio.play().catch(() => this.synthesizeByType(type, meta.category));
        return;
      } catch {
        // Fallback to Web Audio synthesis below
      }
    }

    this.synthesizeByType(type, meta.category);
  }

  private synthesizeByType(type: SoundEventType, category: SoundCategory) {
    switch (type) {
      case 'match_start':
        this.playToneSequence(category, [
          { freq: 392, offset: 0, duration: 0.14, type: 'triangle', gainScale: 0.22 },
          { freq: 523.25, offset: 0.11, duration: 0.14, type: 'triangle', gainScale: 0.24 },
          { freq: 659.25, offset: 0.22, duration: 0.16, type: 'triangle', gainScale: 0.26 },
          { freq: 783.99, offset: 0.34, duration: 0.36, type: 'sine', gainScale: 0.28 },
        ]);
        break;
      case 'round_start':
        this.playToneSequence(category, [
          { freq: 523.25, offset: 0, duration: 0.11, type: 'sine', gainScale: 0.18 },
          { freq: 659.25, offset: 0.09, duration: 0.18, type: 'sine', gainScale: 0.2 },
        ]);
        break;
      case 'question_reveal':
        this.playToneSequence(category, [
          { freq: 440, endFreq: 660, offset: 0, duration: 0.15, type: 'sine', gainScale: 0.18 },
          { freq: 880, offset: 0.13, duration: 0.18, type: 'triangle', gainScale: 0.16 },
        ]);
        break;
      case 'correct_answer':
        this.playToneSequence(category, [
          { freq: 523.25, offset: 0, duration: 0.12, type: 'triangle', gainScale: 0.2 },
          { freq: 659.25, offset: 0.08, duration: 0.12, type: 'triangle', gainScale: 0.22 },
          { freq: 783.99, offset: 0.16, duration: 0.14, type: 'triangle', gainScale: 0.22 },
          { freq: 1046.5, offset: 0.24, duration: 0.26, type: 'sine', gainScale: 0.24 },
        ]);
        break;
      case 'incorrect_answer':
        this.playToneSequence(category, [
          { freq: 210, endFreq: 135, offset: 0, duration: 0.22, type: 'sawtooth', gainScale: 0.14 },
          { freq: 145, endFreq: 95, offset: 0.18, duration: 0.26, type: 'sawtooth', gainScale: 0.14 },
        ]);
        break;
      case 'card_reveal':
        this.playToneSequence(category, [
          { freq: 587.33, offset: 0, duration: 0.1, type: 'sine', gainScale: 0.18 },
          { freq: 880, offset: 0.08, duration: 0.12, type: 'sine', gainScale: 0.2 },
          { freq: 1174.66, offset: 0.16, duration: 0.22, type: 'triangle', gainScale: 0.2 },
        ]);
        break;
      case 'player_swap':
        this.playToneSequence(category, [
          { freq: 660, endFreq: 420, offset: 0, duration: 0.16, type: 'triangle', gainScale: 0.22 },
          { freq: 420, endFreq: 740, offset: 0.16, duration: 0.22, type: 'triangle', gainScale: 0.24 },
          { freq: 987.77, offset: 0.36, duration: 0.18, type: 'sine', gainScale: 0.2 },
        ]);
        break;
      case 'private_round_intro':
        this.playToneSequence(category, [
          { freq: 329.63, offset: 0, duration: 0.16, type: 'sine', gainScale: 0.2 },
          { freq: 440, offset: 0.14, duration: 0.16, type: 'sine', gainScale: 0.22 },
          { freq: 659.25, offset: 0.28, duration: 0.3, type: 'triangle', gainScale: 0.22 },
        ]);
        break;
      case 'team_rivalry_intro':
        this.playToneSequence(category, [
          { freq: 220, offset: 0, duration: 0.18, type: 'sawtooth', gainScale: 0.15 },
          { freq: 330, offset: 0.14, duration: 0.18, type: 'sawtooth', gainScale: 0.15 },
          { freq: 440, endFreq: 554.37, offset: 0.28, duration: 0.28, type: 'triangle', gainScale: 0.22 },
        ]);
        break;
      case 'comeback_bonus':
        this.playToneSequence(category, [
          { freq: 440, offset: 0, duration: 0.12, type: 'triangle', gainScale: 0.2 },
          { freq: 554.37, offset: 0.1, duration: 0.12, type: 'triangle', gainScale: 0.22 },
          { freq: 659.25, offset: 0.2, duration: 0.14, type: 'triangle', gainScale: 0.24 },
          { freq: 880, offset: 0.32, duration: 0.32, type: 'sine', gainScale: 0.26 },
        ]);
        break;
      case 'leader_change':
        this.playToneSequence(category, [
          { freq: 587.33, offset: 0, duration: 0.11, type: 'sine', gainScale: 0.2 },
          { freq: 783.99, offset: 0.1, duration: 0.14, type: 'sine', gainScale: 0.22 },
          { freq: 1046.5, offset: 0.21, duration: 0.24, type: 'triangle', gainScale: 0.24 },
        ]);
        break;
      case 'final_ceremony':
        this.playToneSequence(category, [
          { freq: 261.63, offset: 0, duration: 0.22, type: 'triangle', gainScale: 0.22 },
          { freq: 329.63, offset: 0.18, duration: 0.22, type: 'triangle', gainScale: 0.22 },
          { freq: 392, offset: 0.36, duration: 0.22, type: 'triangle', gainScale: 0.24 },
          { freq: 523.25, offset: 0.54, duration: 0.45, type: 'sine', gainScale: 0.26 },
        ]);
        break;
      case 'champion_reveal':
        this.playToneSequence(category, [
          { freq: 523.25, offset: 0, duration: 0.14, type: 'triangle', gainScale: 0.25 },
          { freq: 659.25, offset: 0.13, duration: 0.14, type: 'triangle', gainScale: 0.25 },
          { freq: 783.99, offset: 0.26, duration: 0.14, type: 'triangle', gainScale: 0.25 },
          { freq: 1046.5, offset: 0.39, duration: 0.5, type: 'sine', gainScale: 0.3 },
          { freq: 783.99, offset: 0.39, duration: 0.5, type: 'triangle', gainScale: 0.18 },
        ]);
        break;
    }
  }

  public playTick() {
    this.playToneSequence('gameplay', [{ freq: 800, offset: 0, duration: 0.05, type: 'sine', gainScale: 0.08 }]);
  }
}

export const soundEffects = new SoundEffectsManager();
