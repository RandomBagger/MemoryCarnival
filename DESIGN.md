# Memory Carnival — UI/UX Design Doc

This is the design surface. Edit this file in plain English. Code follows this doc, not the other way round.

Sections marked **[DESIGNING]** are open — rewrite them however you want.
Sections marked **[BUILT]** describe what the code does today.

---

## 1. Screens

Idle layout is three columns: about / shell / leaderboard, under the marquee.
While playing, marquee collapses vertically and both side panels collapse
horizontally (`max-width` → 0), leaving the shell alone on screen.

| id | element | when visible |
|---|---|---|
| start | `#start-view` | before first round |
| game | `#game-view` | during play |
| over | `#over-view` | after a failed round |
| about | `#about-panel` | idle only (left column) — placeholder copy, rewrite freely |
| leaderboard | `#leaderboard-panel` | idle only (right column) |

### Mobile **[BUILT]**

Mode is decided **once at load** in `game.ts` — `innerWidth / innerHeight < 0.85`
(portrait-ish) or `innerWidth < 820` (narrow) — and sets `body.mobile`. Rotating or
resizing deliberately does nothing until reload: changing board size mid-run would
invalidate the game in progress.

What changes:
- **4 cards instead of 8**, laid out 2×2 (`GRID_SIZE`, and `.grid` goes `aspect-ratio: 1/1`).
  Also drops the minimum asset requirement from 8 to 4.
- **One column.** `.columns` stacks; the shell gets `order: -1` so the game sits at the
  top and About / High Rollers read below it.
- **Vertical scroll only** on the idle screens: `html`/`body` unlock, `.stage-wrap` goes
  `position: static`, and `overflow-x` is pinned to `hidden`.
- **While playing**, side panels fold away by `max-height` (not `max-width`, which is the
  desktop direction), the wrap locks to `100dvh`, and scrolling is disabled — the board
  is always fully on screen.

Height budget on mobile (`dvh`, not `vh` — `vh` counts the area behind the browser URL
bar, so a `100vh` layout is taller than what is actually visible, which is what forced
scrolling):

| piece | size |
|---|---|
| stage | `flex: 1 1 auto`, capped at `30dvh` |
| board | square, `max-width: min(100%, 46dvh)` |
| HUD + gaps + padding | ~14dvh |

Worst case checked is 320×568, which still leaves slack. The stage cap is what
guarantees it: without it the stage takes all remaining height and pushes the board off
the bottom on short screens.

Everything else — difficulty curve, setbacks, freshness rule, transitions, music — is
identical to desktop.

---

## 2. Game states

Today the flow is a chain of `setTimeout` calls. Named states below are the intent;
code does not have an explicit state machine yet (candidate refactor).

```
idle ──start──▶ showing ──sequence done──▶ picking ──last pick──▶ revealing
                   ▲                                                │
                   └──────────── win ◀──────────────────────────────┤
                                                                    │
                                             lost ◀─────────────────┘
```

| state | player can click grid | status text |
|---|---|---|
| idle | no | "Get ready..." |
| showing | no | "Watch closely!" |
| picking | yes | "N/M selected" |
| revealing | no | "Locking in..." |
| won | no | "Nailed it! Next round..." |
| lost | no | "Oops! Game over." |

---

## 3. Event → reaction table **[BUILT]**

| event | reaction |
|---|---|
| click Start | start screen hides, game screen unhides (instant — **no transition, flagged bad**) |
| round begins | grid rebuilt from 8 fresh shuffled items, one new item appended to sequence |
| sequence playback | each item on `#stage` for `--dur-show`, blank for `--dur-gap`, stage gets `.flash` ring while showing |
| click a card | numbered `.pick-badge` appended to that card, card gets `.selected`. Repeat clicks on same card allowed (ABABA patterns) |
| final pick | input locks, status → "Locking in...", wait `--dur-reveal-delay` |
| reveal — all right | badges go green, confetti burst, wait `--dur-win-hold`, next round |
| reveal — any wrong | badges go red/green per position, grid greys out over `--dur-lose-fade`, wait `--dur-lose-hold`, over screen |
| over screen | shows final round, name input, Save Score, Play Again |

---

## 4. Open design work

### 4.1 Leaderboard placement **[DESIGNING]**

Want:
- Full leaderboard on **start** and **over** screens only.
- Hidden during gameplay.
- During gameplay, show only the **next rival**: the lowest leaderboard entry whose
  `round_reached` is still above your current round.

Rival element sketch (fill in / rewrite):

```
┌──────────────────────────────────┐
│  Round 3        🎯 Beat: jj — R5 │
└──────────────────────────────────┘
```

Open questions to answer here:
- Where does it sit — inside the HUD next to Round badge, or its own strip?
- What happens when you **pass** the rival mid-game? (proposal: badge does a
  celebratory pop, then re-targets to the next entry up)
- What when there is no rival left (you are top)? (proposal: "👑 You're #1")
- Ties — several people at R5, you are at R3. Show one name, or "3 players @ R5"?

Answer:
> _(write here)_

### 4.2 Start transition **[BUILT]**

Structure change: there is now **one shell panel** (`#shell`) that holds all three views
(`#start-view`, `#game-view`, `#over-view`). Start does not swap panels — the same box grows.

Beats:

1. `0ms` — start view fades + scales to 0.96 over `--dur-start-fade` (180ms), then hides.
2. `180ms` — `body.playing` goes on. In parallel over `--dur-start-expand` (550ms):
   marquee and leaderboard panel fade to 0 and collapse their `max-height`/padding/border
   to nothing; `#shell` grows from `720px × 300px` to `min(98vw,1180px) × calc(100vh - 28px)`.
3. `730ms` — game view fades in over `--dur-view-in` (260ms).
4. `990ms` — sequence playback begins.

Loss reverses it: `collapseToPanel()` drops `body.playing`, shell shrinks, marquee and
leaderboard come back, over view fades in.

No vertical scroll at any point: `html, body { overflow: hidden }`, `.stage-wrap` is
`position: fixed; inset: 0`, and the play area flexes (`stage` 38% / `grid` 62%).

The grid is the one thing that does **not** stretch to fill, and the sizing **direction**
matters:

- `.grid` is `flex: 0 0 auto` with `width: 100%` and `aspect-ratio` (2/1 desktop 4×2,
  1/1 mobile 2×2), so **height is derived from width**.
- `max-width: min(100%, 118vh)` desktop / `min(100%, 52vh)` mobile caps the width so the
  derived height can never outgrow the shell.
- `.grid-card` simply fills its cell (`width/height: 100%`). The cells are already
  square, so the card is square without an `aspect-ratio` of its own.
- `.stage` takes whatever is left (`flex: 1 1 auto`).

The earlier version did it the other way round — card height fixed at 100% with
`aspect-ratio: 1/1` — which meant a width-clamped grid produced cards wider than their
cells, and they overlapped. Deriving height from width makes overflow impossible.

Media inside uses `object-fit: contain`: `cover` crops, and a cropped sprite can hide
the detail the player is supposed to be remembering.

### 4.3 Lose transition **[BUILT]**

1. `0ms` — badges resolve green/red, status reads "Oops! Game over."
2. `0ms` — `body.losing` goes on: the **whole page** desaturates over `--dur-lose-fade`
   (1100ms) via `filter: grayscale(1) brightness(0.62)` on `<body>`, so the striped
   background, panels, gear and all go grey together — not just the grid.
3. `--dur-lose-hold` (1300ms) — `gameOver()` runs: game view hides, shell shrinks and
   the side panels return, all still grey.
4. after the collapse — over view fades in and `losing` comes off, so colour floods
   back as the results appear.

Note: `filter` on `<body>` makes it a containing block for fixed children. Harmless
here because `body` is exactly viewport-sized (`html, body { height: 100% }`), so
`.stage-wrap`'s `position: fixed; inset: 0` resolves identically.

### 4.4 Sequence playback **[BUILT]**

Each item fades and scales in (`.stage-media` → `.visible`, 0.94 → 1) over
`--dur-media-fade`, holds for `--dur-show`, fades out over `--dur-media-fade`, then a
`--dur-gap` blank. So one item costs `fade + show + fade + gap`, not `show + gap` —
worth remembering when retuning `--dur-show`.

---

## 5. Timing knobs **[BUILT]**

All durations live in one place: the `:root` block at the top of `static/css/style.css`.
JS reads them live from computed style, so **changing a var in devtools retunes both the
CSS animations and the JS waits without a reload.**

| var | default | controls |
|---|---|---|
| `--dur-show` | 950ms | how long each sequence item is on stage |
| `--dur-gap` | 300ms | blank gap between sequence items |
| `--dur-reveal-delay` | 900ms | pause after final pick before verdict |
| `--dur-win-hold` | 1400ms | how long the win celebration holds before next round |
| `--dur-lose-fade` | 1100ms | grid grey-out duration |
| `--dur-lose-hold` | 1300ms | how long the greyed grid holds before over screen |
| `--dur-confetti` | 1600ms | confetti fall duration |
| `--dur-start-fade` | 180ms | start view fading out on click |
| `--dur-start-expand` | 550ms | shell grow / marquee + leaderboard collapse |
| `--dur-view-in` | 260ms | any view fading in |

Palette (also `:root`): `--plum #5D3140`, `--pink #CF4173`, `--rose #F39399`,
`--cream #F6D8BD`, plus `--wine #8C1F3A` (wrong badge) and `--good #3FA06B` (right badge).

Tuning loop: open devtools → Elements → `:root` → drag the number → replay with a debug
key below → write the value you liked into `style.css`.

---

## 6. Settings **[BUILT]**

Gear button pinned top-right (`#settings-btn`, spins on hover). Click toggles
`#settings-panel`; click-outside and `Esc` close it. Debug keys are suppressed while
the panel is open so typing there never fires them.

Panel contents:
- **Background music** — `<select>` populated from `GET /api/music`, which lists
  `assets/music/` (`.mp3 .ogg .wav .m4a .flac .opus`). "🔇 None" stops playback.
- **Volume** — 0–100 slider.

Both persist in `localStorage` (`mc-music-track`, `mc-music-volume`) and restore on
load. Playback does not autostart on page load — browsers block that. It starts on the
first gesture: changing the select, or clicking Start with a track already chosen.

Music lives in `assets/music/` but is deliberately outside `MEDIA_KINDS` in `app.py`,
so tracks can never leak into the game's media pool.

## 7. Admin panel **[BUILT]**

`/admin` — manage everything in `assets/` without touching the filesystem by hand.

One card per folder (images, sprites, gifs, videos, music). Each has a dropzone that
doubles as a file picker, and a grid of tiles. Tiles render on `--sprite-bg` inside a
square with `object-fit: contain`, i.e. the exact in-game card treatment, so the preview
tells you how the asset will actually look on the board. Audio tiles get inline
`<audio controls>`; clicking any tile opens a bigger modal preview.

Deletes are two-step — first click arms the button ("Sure?"), second confirms, and it
disarms itself after 3s.

**About panel editor** sits at the top of `/admin`: a heading field and a body textarea,
with a live preview rendered in the game's real `.side-panel` styles. A blank line in the
body starts a new paragraph. Copy is stored in the SQLite `settings` table
(`about_title`, `about_text`) and the game fetches it on load, so edits show up on
refresh. Body is written with `textContent`, so the copy can never inject markup.
The editor is kept out of the re-render path, so uploads and deletes elsewhere on the
page never wipe unsaved edits.

API: `GET /api/assets`, `POST /api/assets/<folder>` (multipart `files`),
`DELETE /api/assets/<folder>/<filename>`, `GET|POST /api/settings`.

Server-side rules: extension must match the folder, filenames go through
`secure_filename`, resolved paths are checked to stay inside the target folder, and
existing files are never overwritten (a `-1`, `-2` suffix is added). Upload cap 256 MB
per request.

**No authentication.** This is a local dev tool — anyone who can reach the port can
upload and delete. Do not expose this app to a network as-is.

The panel also warns when there are fewer than 8 playable media files, since the game
needs that many for its 8-card board (music does not count toward it).

## 9. Difficulty curve **[BUILT]**

All of it lives in one block at the top of `game.ts` (`DIFFICULTY_BANDS` + the
`ENDLESS_*` constants). Nothing elsewhere hardcodes a round number.

| rounds | cards | speed | watch time |
|---|---|---|---|
| 1–2 | 1 | 1.00× | ~1.7s |
| 3–5 | 2 | 1.00× | ~3.4s |
| 6–10 | 3 | 1.00× | ~5.1s |
| 11–20 | 4 | 1.00× | ~6.8s |
| 21–30 | 4 | 0.78× | ~5.7s |
| 31–50 | 5 | 0.62× | ~6.1s |
| 51+ | 5, +1 every 20 | ×0.92 every 5 | — |

Floors: `MIN_SHOW_MS` 260, `MIN_GAP_MS` 90 — hit around round 100, after which only
card count grows. Without them the endless band eventually flashes items faster than
anyone can see.

**Model change:** sequences are now generated fresh each round by `randomSequence()`,
not appended to. Lengths repeat across rounds (R1 and R2 are both 1 card), so the old
"extend the running sequence" model no longer applies. Repeats within a sequence are
allowed, but never back to back — two identical items in a row just read as the stage
failing to change.

Difficulty steps are telegraphed: `announceStep()` puts "🎪 N cards now!" or
"⚡ Speeding up!" on the stage for `--dur-banner` before playback. The HUD also carries
a live `Cards N` badge.

### 9.1 Failure — setback, not death

A wrong answer at round `>= SAFE_ROUND` (10) knocks you back to `floor(round * 0.7)`
and play continues. Below round 10 it ends the run.

The screen greys for `--dur-lose-hold`, then a "😖 Back to round N" banner plays and the
new round starts. The step-up banner is suppressed on that round, otherwise dropping
from 31 to 21 would announce a difficulty change that isn't happening.

Because rounds can go down, the score is `bestRound` — the highest round *cleared* this
run — not the round you were on when you stopped. The over screen and the leaderboard
POST both use it.

Ladders this produces (each entry is one mistake):

| fail at | then |
|---|---|
| 10 | 7 → dead |
| 25 | 17 → 11 → 7 → dead |
| 40 | 28 → 19 → 13 → 9 → dead |
| 100 | 70 → 49 → 34 → 23 → 16 → 11 → … |

So a deep run survives ~5–6 mistakes; a shallow one gets one or two. That is a soft
landing high up and real stakes low down, which is the right way round.

### 9.2 Odd / even freshness

- **Even rounds** try to fill the board entirely with media never yet shown on stage.
- **Odd rounds** prefer media the player has already seen.
- Either can fall short; the board is topped up from the other pile, so a small
  `assets/` folder still plays.

Only items that actually appear in a sequence count as seen — being on the grid is not
the same as having been shown.

Freshness is bounded by how many assets exist. Rough simulation over 40 rounds:

| pool size | even rounds that were genuinely all-new |
|---|---|
| 8 | 0 / 20 |
| 16 | 1 / 20 |
| 24 | 3 / 20 |
| 40 | 6 / 20 |
| 80 | 14 / 20 |

The status line says "Watch closely — all new acts!" only when the board really is
all-new, so the promise is never made falsely.

## 8. Debug keys **[BUILT]**

Active on `localhost`, or on any URL with `?debug=1`. A hint strip shows bottom-left.

| key | does |
|---|---|
| `W` | force a win reveal (skips picking) |
| `L` | force a lose reveal |
| `S` | skip the rest of the sequence playback, jump straight to picking |
| `N` | jump forward a round |
| `J` | jump forward 10 rounds (for reaching the late difficulty bands) |
| `R` | hard reset to start screen |

Purpose: replay a transition 20 times in a row without playing 5 honest rounds.
