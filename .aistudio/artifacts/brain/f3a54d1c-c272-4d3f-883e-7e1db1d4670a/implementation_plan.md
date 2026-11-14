# CodeArena — Team Notifications Center

A centralized, real-time, persistent notification engine and mobile HUD experience for the Team Mobile Portal that alerts each of the four teams to confirmed ranking shifts, scoring transactions, card events, player exchanges, comeback opportunities, rivalries, and round milestones without leaking hidden game data.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Your Phase 1 UX preferences have been locked into the design below. Review the architecture and reply **Proceed** to begin implementation, or suggest any adjustments.

- **Confirmed Presentation**: Bell icon in the mobile landscape HUD header opens a **top-right slide-over drawer** containing the Notification Center history, category filters, and header settings.
- **Confirmed Language**: Every notification stores **bilingual Arabic & English copy** (`titleAr`/`titleEn`, `messageAr`/`messageEn`) and dynamically matches the active interface language.
- **Confirmed Floating Queue**: Floating banners near the top of the mobile arena display **1 active banner at a time** while queuing remaining alerts cleanly by priority.
- **Confirmed Customization**: Preference toggles (floating toasts on/off, banner duration, low-priority visibility, subtle chime toggle) live cleanly inside the **Notification Center header** without affecting persistent history.

---

## 1. Overview & Core Concept

- **What It Does**: Adds **CodeArena — Team Notifications Center**, pairing a non-intrusive floating toast queue with a persistent, filterable Notification Center history drawer synced in real time over the existing Server-Sent Events (SSE) stream.
- **Target Audience**: Student team captains and team portal operators using CodeArena on landscape smartphones and tablets during live classroom competitions.
- **Key Value**: Teams immediately see every impactful development—rank climbs or drops across all 4 positions, points & streaks, hidden card unlocks without card-type spoilers, incoming attacks/defenses, 1-for-1 player swaps, Comeback eligibility, and Rivalry pairings—without needing to constantly watch the main projector or check sidebars.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Real-Time Floating Banner Flow**:
   - When a confirmed backend event targets the active team (and floating banners are enabled), the toast queue surfaces the highest-priority unseen notification at the top center of the mobile arena (`~3.5s` default duration, extended to `~5s` for high-priority events such as Rank #1, Player Swap, Comeback Unlocked, or Card Stolen).
   - If multiple events commit together (e.g., end-of-round evaluation producing `+200 Points`, `Streak Bonus`, and `Moved to 2nd Place`), the highest-priority toast appears first while remaining alerts queue sequentially without stacking multiple banners over answer choices.
   - Tapping the banner opens the Notification Center directly (and marks it read) or swipes/taps dismiss without interrupting active answer entry.
2. **Notification Center Slide-Over Drawer**:
   - Tapping the **Bell Icon** (with live unread badge count) in the top-right mobile HUD bar slides open a compact `340px–380px` right-side drawer tuned for landscape viewports (`h-full`, `z-40`, blurred backdrop).
   - Top bar includes title, unread counter, **Mark All as Read**, a compact **Settings** popover toggle, and close button (`>= 44px` touch targets).
   - Below the header, single-row horizontal segmented filter tabs (**All · Unread · Points · Cards · Ranking · Gameplay**) filter the chronological newest-first list.
   - Empty state displays `"You're all caught up! 🎉 — No new notifications for now."` (localized in AR/EN).
3. **Read-State & Reconnect Persistence**:
   - Notifications persist server-side per match and team; page refreshes or SSE reconnects recover full history and unread counts while seeding already-seen notification IDs so old events do not replay as duplicate floating banners.

### Visual Identity & Theme
- **Aesthetic Direction**: Sleek dark competitive HUD matching CodeArena's existing deep-slate (`bg-slate-950` / `bg-slate-900`) and cyan/amber/emerald telemetry styling.
- **Color Palette & Semantic Signifiers**:
  - Neutral structural canvas (`bg-slate-900/95 border-slate-800`).
  - Semantic category icon framing paired with clear text indicators (emerald for positive points/defenses/rank climbs, rose for penalties/rank drops/stolen cards, amber for Comeback/Streaks/Rivalries, cyan for general round/card info).
  - Unread rows distinguished by crisp elevated slate fill and subtle unread text indicator rather than loud pill sandwiches or thick `border-l-4` accent bars; timestamps and category labels render as quiet unboxed metadata (`Category · 14s ago`).
- **Motion & Viewport Discipline**:
  - Transform/opacity transitions (`<= 200ms`) respecting `prefers-reduced-motion`; floating banner positioned cleanly below the `56px` HUD header (`pointer-events-none` container with `pointer-events-auto` banner) so zero interactive answer controls are blocked.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Authoritative Notification Ledger inside Match Storage**
  - *Chosen Approach*: Persist `notificationsByTeam` inside the match record in the server storage layer, scoped per `teamId`, rather than deriving notifications purely on the client by diffing SSE states.
  - *Why*: Pure client-side diffing misses offline events, produces inconsistent histories across refreshes, leaks spoiler timing during regular group rounds, and struggles to prevent duplicate toasts on reconnect. Server-authoritative emission guarantees privacy isolation, exact transaction alignment, persistent read state, and cross-refresh idempotency.
  - *Alternatives Considered*: Browser-local `localStorage` log; rejected because it cannot preserve server authorization or survive device switching during team takeover.

- **Decision 2: Strict Phase-Gated & Deferred-Reveal Emission**
  - *Chosen Approach*: Defer group-round scoring, streak, card-unlock, and ranking-change notifications until `roundPhase` transitions to confirmed evaluation (`evaluating` / timer expiry), while emitting immediate submission receipts (`Answer Submitted!`) during `question_active`. Private rounds and resolved Comeback questions emit immediately upon turn evaluation.
  - *Why*: Matches existing anti-spoiler architecture (`getSanitizedStateForTeam`) so fast teams never deduce points, leader flips, or card unlocks before other teams answer or the teacher evaluates.

- **Decision 3: Confirmed Leaderboard Rank Transitions for All Four Positions**
  - *Chosen Approach*: Maintain each match's `lastConfirmedRankings` (`Record<string, number>`) on the server and invoke `evaluateAndNotifyRankChanges` only after confirmed score mutations (round evaluation, Comeback resolution, Bonus Card, Minus Card execution, Reverse Judgment penalty, Match end).
  - *Why*: Prevents phantom notifications during partial mid-round submissions, accurately detects ties across all 4 positions (`1st`, `2nd`, `3rd`, `last/4th`, tie states, climbs from last, multi-spot climbs, drops), and suppresses noise when rank does not change.

- **Decision 4: Stable Event Deduplication (`dedupeKey`) + Initial-Load Suppression**
  - *Chosen Approach*: Require deterministic `dedupeKey` values per semantic transition (`eventType:round:entityId:teamId`) on server insertion, plus client-side `seenToastIds` seeded on initial hydration/reconnect so only genuinely *new* notifications received while connected enqueue floating toasts.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### System Architecture Diagram
```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Authoritative Server Engine                         │
│                                                                            │
│  Match Mutations (Answers · Evaluate · Cards · Swaps · Comeback · Rivalry) │
│        │                                                                   │
│        ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Centralized Notification Engine                                      │  │
│  │  • Ranking Transition Detector (4-team standard ties vs last state)  │  │
│  │  • Category & Priority Classifier (high / medium / low + duration)   │  │
│  │  • Privacy Sanitizer (strips card types on draw, masks rivals)       │  │
│  │  • Idempotency Guard (dedupeKey check per match & team ledger)       │  │
│  └─────────────────────────────────┬────────────────────────────────────┘  │
│                                    │ Persists inside GameState             │
│                                    ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Team-Scoped Storage & Auth Barrier                                   │  │
│  │  • notificationsByTeam[teamId] + lastConfirmedRankings               │  │
│  │  • Sanitized SSE / GET slices ONLY own teamId notifications          │  │
│  │  • Endpoints verify Bearer JWT + team.activeSession.userId === uid   │  │
│  └─────────────────────────────────┬────────────────────────────────────┘  │
└────────────────────────────────────┼───────────────────────────────────────┘
                                     │ Real-Time SSE + REST Read Actions
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     Team Mobile Portal Client Layer                        │
│                                                                            │
│  ┌──────────────────────────┐        ┌──────────────────────────────────┐  │
│  │ Notification Hook/Store  │───────▶│ Floating Toast Banner (Queue 1)  │  │
│  │  • Merges SSE history    │        │  • Top overlay below HUD header  │  │
│  │  • Tracks seenToastIds   │        │  • Priority timing (3.5s / 5s)   │  │
│  │  • Manages prefs in      │        └──────────────────────────────────┘  │
│  │    localStorage          │                                              │
│  └────────────┬─────────────┘        ┌──────────────────────────────────┐  │
│               └─────────────────────▶│ Slide-Over Notification Center   │  │
│                                      │  • Bell badge (unread count)     │  │
│                                      │  • Category & unread filters     │  │
│                                      │  • Mark Read / Mark All Read     │  │
│                                      │  • Header settings popover       │  │
│                                      └──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Persistent State
- **`TeamNotification`**:
  - `id`: unique ID (`notif-${now}-${seq}`)
  - `eventId` / `dedupeKey`: deterministic idempotency key ensuring repeated API/timer calls never duplicate an already-emitted transition
  - `gameId`, `teamId`, `roundNumber`, `timestamp`, `read` (`boolean`), `readAt?`
  - `category`: `'points' | 'ranking' | 'cards' | 'player_exchange' | 'comeback' | 'double_points' | 'rivalry' | 'rounds' | 'private_rounds' | 'match_status' | 'team_activity' | 'milestones'`
  - `priority`: `'high' | 'medium' | 'low'` (`durationMs`: `5000` high, `3500` medium, `3000` low)
  - `emoji`, `tone` (`'positive' | 'negative' | 'warning' | 'info'`), `titleAr`, `titleEn`, `messageAr`, `messageEn`, `metadata?` (strictly non-spoiler values such as `pointsDelta`, `rankFrom`, `rankTo`, or committed swap names)
- **Match Storage Extensions & Migration**:
  - Extend `GameState` with `notificationsByTeam: Record<string, TeamNotification[]>` and `lastConfirmedRankings: Record<string, { rank: number; isTied: boolean; score: number }>`, plus `milestoneNotifiedByTeam: Record<string, number[]>`.
  - Update storage hydration so existing saved matches and ongoing disk snapshots cleanly initialize missing notification collections without data loss.
- **Per-Team Privacy & Security**:
  - Update team-scoped state sanitization so `/api/events?portal=team&teamId=X` and `/api/game?portal=team&teamId=X` attach ONLY `notificationsByTeam: { [X]: ... }` (never exposing other teams' arrays, and returning empty arrays on the Teacher Dashboard only for public/global views without leaking anything). Wait: Teacher Dashboard retains full state, while mobile `?portal=team` only ever receives its own authorized `teamId` notifications (and requires matching authenticated session on notification endpoints: `GET /api/game/notifications`, `POST /api/game/notifications/read`, `POST /api/game/notifications/read-all`).

### Event Coverage & State Mapping
1. **All 4 Team Rankings** (`evaluateAndNotifyRankChanges`): Compares previous confirmed rank (`1..4`) and tie state against `computeTeamRankings(teams)`. Handles solo 1st/2nd/3rd/4th, multi-way ties, climbs from last, multi-position jumps (`>= 2`), drops (`1st->2nd`, `1st->3rd`, `->last`), and score-gap shifts (`Closing the gap` / `Falling behind`) — strictly suppressing notifications when rank did not change.
2. **Points, Streaks & Milestones**: On confirmed answer/card/comeback evaluation, emits scored delta (`+X pts` / `-X pts`), streak milestones (`>= 3` bonus or streak ended when previously `>= 2`), Double Points payout confirmation, Comeback Reward confirmation, and configurable score milestones (derived from `pointsPer200ForCard` multiples plus `1000`-pt milestones) capped cleanly via `milestoneNotifiedByTeam`.
3. **Cards, Privacy & Reactions**:
   - Card unlocked -> draw available notice (`✨ Card Draw Unlocked!`); card drawn -> **strictly generic** `"🎁 New Card Received! Check your inventory."` (zero cardType/cardName exposure).
   - Card activated (`bonus_card`, `player_lock`, `better_luck`, `double_points`, `card_inspection`, `gift_player`), card cooldown ready (`availableFromRound === currentRoundNumber` at round start -> `"✨ A New Card Is Now Available!"`), opponent attack launched, anonymous surveillance notice (`"👀 Your Card Inventory Was Inspected!"`), steal attacker/victim notices, defense success (`"🛡️ Attack Successfully Blocked!"`), attacker blocked notice (`"🚫 Your Card Effect Was Blocked!"`), and reaction expired/cancelled.
   - **Player Swap**: Notifies both `initiatingTeamId` and `targetTeamId` AFTER atomic commit with real exchanged player names; sends defended/cancelled notices on failure without false success alerts.
4. **Comeback, Rivalry, Rounds & Match Lifecycle**:
   - Comeback announced/question active/resolved (eligible team only, no answer leaks).
   - Rivalry selected & rivalry round completed (participating 2 teams only, visual-only).
   - Round started, question active, answer submitted, evaluation completed, Private Round started & per-team representative player selected (`"🎯 You're Selected to Represent Your Team!"` using `selectedPlayerPerTeam[teamId].name`), Collaborative Coding Challenge started, Final Rounds warning (last 3 rounds when `totalRounds >= 5`), and Match Ended.

### Interactive Controls Mapping
- **Bell Trigger (`Header`)**: Opens/closes the top-right slide-over drawer; shows tabular unread badge count.
- **Drawer Header Controls**: `Mark All Read` triggers `POST /api/game/notifications/read-all`; `Settings` toggles local `codearena_notif_prefs` (`toastsEnabled`, `toastDurationMs`, `showLowPriority`, `chimeEnabled`); `Close` dismisses drawer.
- **Filter Segmented Tabs & Row Actions**: Filters `All`, `Unread`, `Points`, `Cards`, `Ranking`, `Gameplay`; tapping any unread notification triggers `POST /api/game/notifications/read` cleanly and decrements the badge without deleting the item.
- **Floating Toast Queue**: Displays 1 item at a time (`high > medium > low`), auto-advances via timer respecting paused/hovered state, supports click-to-open-drawer or explicit dismiss button (`>= 44px` hitboxes).
