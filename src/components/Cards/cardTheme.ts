import { CardCategory, CardType } from '../../types/game';

export interface CardVisualTheme {
  category: CardCategory;
  categoryLabel: string;
  accentHex: string;
  borderClass: string;
  bgGradient: string;
  badgeClass: string;
  glowShadow: string;
  shortTag: string;
}

export const CARD_VISUAL_THEMES: Record<CardType, CardVisualTheme> = {
  player_swap: {
    category: 'attack',
    categoryLabel: 'ATTACK',
    accentHex: '#f59e0b',
    borderClass: 'border-amber-500/70',
    bgGradient: 'from-amber-950/90 via-slate-900 to-orange-950/90',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
    glowShadow: 'shadow-amber-500/25',
    shortTag: 'ROSTER TRANSFER',
  },
  player_lock: {
    category: 'defense',
    categoryLabel: 'DEFENSE',
    accentHex: '#3b82f6',
    borderClass: 'border-blue-500/70',
    bgGradient: 'from-blue-950/90 via-slate-900 to-indigo-950/90',
    badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/50',
    glowShadow: 'shadow-blue-500/25',
    shortTag: 'PLAYER SHIELD',
  },
  anti_swap: {
    category: 'defense',
    categoryLabel: 'DEFENSE',
    accentHex: '#10b981',
    borderClass: 'border-emerald-500/70',
    bgGradient: 'from-emerald-950/90 via-slate-900 to-teal-950/90',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
    glowShadow: 'shadow-emerald-500/25',
    shortTag: 'SWAP COUNTER',
  },
  bonus_card: {
    category: 'bonus',
    categoryLabel: 'BONUS',
    accentHex: '#eab308',
    borderClass: 'border-yellow-400/70',
    bgGradient: 'from-yellow-950/80 via-slate-900 to-amber-950/90',
    badgeClass: 'bg-yellow-400/20 text-yellow-300 border-yellow-400/50',
    glowShadow: 'shadow-yellow-400/25',
    shortTag: '+50 TO +250 PTS',
  },
  minus_card: {
    category: 'attack',
    categoryLabel: 'ATTACK',
    accentHex: '#f43f5e',
    borderClass: 'border-rose-500/70',
    bgGradient: 'from-rose-950/90 via-slate-900 to-red-950/90',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
    glowShadow: 'shadow-rose-500/25',
    shortTag: '-100 PTS STRIKE',
  },
  reverse_judgment: {
    category: 'defense',
    categoryLabel: 'DEFENSE',
    accentHex: '#a855f7',
    borderClass: 'border-purple-500/70',
    bgGradient: 'from-purple-950/90 via-slate-900 to-violet-950/90',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/50',
    glowShadow: 'shadow-purple-500/25',
    shortTag: 'MIRROR COUNTER',
  },
  card_steal: {
    category: 'attack',
    categoryLabel: 'ATTACK',
    accentHex: '#ec4899',
    borderClass: 'border-fuchsia-500/70',
    bgGradient: 'from-fuchsia-950/90 via-slate-900 to-pink-950/90',
    badgeClass: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/50',
    glowShadow: 'shadow-fuchsia-500/25',
    shortTag: 'VAULT HEIST',
  },
  gift_player: {
    category: 'special',
    categoryLabel: 'SPECIAL',
    accentHex: '#06b6d4',
    borderClass: 'border-cyan-500/70',
    bgGradient: 'from-cyan-950/90 via-slate-900 to-teal-950/90',
    badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50',
    glowShadow: 'shadow-cyan-500/25',
    shortTag: 'MYSTERY TRADE',
  },
  better_luck: {
    category: 'special',
    categoryLabel: 'SPECIAL',
    accentHex: '#94a3b8',
    borderClass: 'border-slate-500/70',
    bgGradient: 'from-slate-800/90 via-slate-900 to-zinc-900',
    badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-500/50',
    glowShadow: 'shadow-slate-500/20',
    shortTag: 'NEXT CHANCE',
  },
  card_inspection: {
    category: 'special',
    categoryLabel: 'SPECIAL',
    accentHex: '#38bdf8',
    borderClass: 'border-sky-400/70',
    bgGradient: 'from-sky-950/90 via-slate-900 to-indigo-950/90',
    badgeClass: 'bg-sky-400/20 text-sky-300 border-sky-400/50',
    glowShadow: 'shadow-sky-400/25',
    shortTag: 'CYBER SCAN',
  },
  double_points: {
    category: 'bonus',
    categoryLabel: 'BONUS',
    accentHex: '#10b981',
    borderClass: 'border-emerald-400/80',
    bgGradient: 'from-emerald-950/90 via-slate-900 to-cyan-950/90',
    badgeClass: 'bg-emerald-400/20 text-emerald-300 border-emerald-400/60',
    glowShadow: 'shadow-emerald-400/30',
    shortTag: '2X BASE POINTS',
  },
};
