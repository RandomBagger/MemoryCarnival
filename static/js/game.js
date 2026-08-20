"use strict";
const startView = document.getElementById("start-view");
const gameView = document.getElementById("game-view");
const overView = document.getElementById("over-view");
const startBtn = document.getElementById("start-btn");
const playAgainBtn = document.getElementById("play-again-btn");
const saveScoreBtn = document.getElementById("save-score-btn");
const playerNameInput = document.getElementById("player-name");
const roundLabel = document.getElementById("round-label");
const cardsLabel = document.getElementById("cards-label");
const statusLabel = document.getElementById("status-label");
const stage = document.getElementById("stage");
const grid = document.getElementById("grid");
const finalRound = document.getElementById("final-round");
const leaderboardList = document.getElementById("leaderboard-list");
const confettiLayer = document.getElementById("confetti-layer");
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const musicSelect = document.getElementById("music-select");
const musicVolume = document.getElementById("music-volume");
const musicEmpty = document.getElementById("music-empty");
const bgMusic = document.getElementById("bg-music");
const aboutTitle = document.getElementById("about-title");
const aboutBody = document.getElementById("about-body");
/* ------------------------------------------------------------------ *
 * Layout mode — decided once, at load, and never re-evaluated. Flipping
 * board size mid-game would invalidate the run, so a rotation or resize
 * deliberately does nothing until reload.
 * ------------------------------------------------------------------ */
const MOBILE_RATIO = 0.85; // portrait-ish
const MOBILE_MAX_WIDTH = 820; // ...or just plain narrow
const IS_MOBILE = window.innerWidth / window.innerHeight < MOBILE_RATIO || window.innerWidth < MOBILE_MAX_WIDTH;
if (IS_MOBILE)
    document.body.classList.add("mobile");
/** 4 cards on mobile (2x2), 8 on desktop (4x2). Everything else is identical. */
const GRID_SIZE = IS_MOBILE ? 4 : 8;
/**
 * Reads a duration custom property off :root and returns it in milliseconds.
 * Read live on every access (see TIMING below) so tweaking a var in devtools
 * retunes the JS waits as well as the CSS animations, with no reload.
 */
function cssMs(name, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw)
        return fallback;
    if (raw.endsWith("ms"))
        return parseFloat(raw);
    if (raw.endsWith("s"))
        return parseFloat(raw) * 1000;
    const n = parseFloat(raw);
    return Number.isNaN(n) ? fallback : n;
}
const TIMING = {
    get show() { return cssMs("--dur-show", 950); },
    get gap() { return cssMs("--dur-gap", 300); },
    get mediaFade() { return cssMs("--dur-media-fade", 220); },
    get revealDelay() { return cssMs("--dur-reveal-delay", 900); },
    get winHold() { return cssMs("--dur-win-hold", 1400); },
    get loseFade() { return cssMs("--dur-lose-fade", 1100); },
    get loseHold() { return cssMs("--dur-lose-hold", 1300); },
    get confetti() { return cssMs("--dur-confetti", 1600); },
    get startFade() { return cssMs("--dur-start-fade", 180); },
    get startExpand() { return cssMs("--dur-start-expand", 550); },
    get viewIn() { return cssMs("--dur-view-in", 260); },
    get banner() { return cssMs("--dur-banner", 1000); },
};
/** Fixed bands, lowest first. `speed` multiplies the base --dur-show/--dur-gap. */
const DIFFICULTY_BANDS = [
    { upTo: 2, length: 1, speed: 1.0 },
    { upTo: 5, length: 2, speed: 1.0 },
    { upTo: 10, length: 3, speed: 1.0 },
    { upTo: 20, length: 4, speed: 1.0 },
    { upTo: 30, length: 4, speed: 0.78 },
    { upTo: 50, length: 5, speed: 0.62 },
];
// Past the last band it never stops: quicker every 5 rounds, one more card
// every 20. Floors keep it humanly possible instead of a subliminal flash.
const ENDLESS_FROM = 50;
const ENDLESS_BASE_LENGTH = 5;
const ENDLESS_BASE_SPEED = 0.62;
const ENDLESS_SPEED_EVERY = 5;
const ENDLESS_SPEED_FACTOR = 0.92;
const ENDLESS_CARD_EVERY = 20;
const MIN_SHOW_MS = 260;
const MIN_GAP_MS = 90;
/** A wrong answer knocks you back to this fraction of your round... */
const SETBACK_KEEP = 0.7;
/** ...unless you are below this round, where a wrong answer ends the run. */
const SAFE_ROUND = 10;
function difficultyFor(atRound) {
    const band = DIFFICULTY_BANDS.find((b) => atRound <= b.upTo);
    let length;
    let speed;
    if (band) {
        length = band.length;
        speed = band.speed;
    }
    else {
        const past = atRound - ENDLESS_FROM;
        length = ENDLESS_BASE_LENGTH + Math.floor(past / ENDLESS_CARD_EVERY);
        speed =
            ENDLESS_BASE_SPEED * Math.pow(ENDLESS_SPEED_FACTOR, Math.floor(past / ENDLESS_SPEED_EVERY));
    }
    return {
        length,
        show: Math.max(MIN_SHOW_MS, TIMING.show * speed),
        gap: Math.max(MIN_GAP_MS, TIMING.gap * speed),
    };
}
/**
 * Picks the round's 8-card board.
 *
 * Even rounds want media the player has never been shown; odd rounds want
 * familiar faces. Both are best-effort: whichever pile runs short is topped up
 * from the other, so a small assets/ folder still plays, it just stops feeling
 * fresh once every item has been shown once.
 */
function pickBoard(atRound) {
    const unseen = pool.filter((i) => !seenIds.has(i.id));
    const seen = pool.filter((i) => seenIds.has(i.id));
    const wantFresh = atRound % 2 === 0;
    const primary = wantFresh ? unseen : seen;
    const backup = wantFresh ? seen : unseen;
    const chosen = shuffle(primary).slice(0, GRID_SIZE);
    if (chosen.length < GRID_SIZE) {
        chosen.push(...shuffle(backup).slice(0, GRID_SIZE - chosen.length));
    }
    return shuffle(chosen);
}
/** True when this round actually managed to be all-new media. */
function boardIsFresh(items) {
    return items.every((i) => !seenIds.has(i.id));
}
/**
 * A fresh sequence each round, drawn from the current board so every item is
 * guaranteed to be clickable. Repeats are allowed (ABABA), but never back to
 * back — two identical items in a row just look like the stage failed to change.
 */
function randomSequence(length) {
    const out = [];
    for (let i = 0; i < length; i++) {
        let pick = board[Math.floor(Math.random() * board.length)];
        if (board.length > 1) {
            while (out.length > 0 && pick.id === out[out.length - 1].id) {
                pick = board[Math.floor(Math.random() * board.length)];
            }
        }
        out.push(pick);
    }
    return out;
}
let pool = [];
/** This round's 8 cards. Rebuilt every round by pickBoard() for the freshness rule. */
let board = [];
let sequence = [];
let round = 0;
/** Highest round cleared this run. Setbacks must not lower the score. */
let bestRound = 0;
/** Every item ever shown on stage this run — drives the odd/even freshness rule. */
let seenIds = new Set();
/** Suppresses the step-up banner on the round right after a setback. */
let justSetBack = false;
let accepting = false;
let selections = [];
let cardRefs = [];
let skipPlayback = false;
async function loadMedia() {
    const res = await fetch("/api/media");
    pool = await res.json();
}
function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
function renderMedia(item, container) {
    let el;
    if (item.type === "video") {
        const video = document.createElement("video");
        video.src = item.url;
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        el = video;
    }
    else {
        const img = document.createElement("img");
        img.src = item.url;
        el = img;
    }
    container.appendChild(el);
    return el;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** sleep() that bails early when skipPlayback is raised, so debug keys can cut playback short. */
async function playbackSleep(ms) {
    const step = 50;
    let waited = 0;
    while (waited < ms) {
        if (skipPlayback)
            return;
        const slice = Math.min(step, ms - waited);
        await sleep(slice);
        waited += slice;
    }
}
/** Warns on the stage when a round steps up, so difficulty is never a surprise. */
async function announceStep(atRound) {
    if (atRound <= 1 || justSetBack)
        return;
    const prev = difficultyFor(atRound - 1);
    const now = difficultyFor(atRound);
    let text = "";
    if (now.length > prev.length)
        text = `🎪 ${now.length} cards now!`;
    else if (now.show < prev.show - 1)
        text = "⚡ Speeding up!";
    if (!text)
        return;
    const banner = document.createElement("div");
    banner.className = "round-banner";
    banner.textContent = text;
    stage.innerHTML = "";
    stage.appendChild(banner);
    await playbackSleep(TIMING.banner);
    stage.innerHTML = "";
}
async function startRound() {
    round += 1;
    const diff = difficultyFor(round);
    roundLabel.textContent = String(round);
    cardsLabel.textContent = String(diff.length);
    accepting = false;
    skipPlayback = false;
    board = pickBoard(round);
    const fresh = boardIsFresh(board);
    statusLabel.textContent = fresh ? "Watch closely — all new acts!" : "Watch closely!";
    sequence = randomSequence(diff.length);
    buildGrid(shuffle(board));
    await announceStep(round);
    justSetBack = false;
    // Only what actually goes on stage counts as "seen".
    sequence.forEach((item) => seenIds.add(item.id));
    for (const item of sequence) {
        if (skipPlayback)
            break;
        stage.innerHTML = "";
        stage.classList.add("flash");
        const el = renderMedia(item, stage);
        el.classList.add("stage-media");
        void el.offsetWidth; // commit the starting styles so the fade-in animates
        el.classList.add("visible");
        await playbackSleep(diff.show);
        el.classList.remove("visible"); // fade out
        stage.classList.remove("flash");
        await playbackSleep(TIMING.mediaFade);
        stage.innerHTML = "";
        await playbackSleep(diff.gap);
    }
    stage.innerHTML = "";
    stage.classList.remove("flash");
    skipPlayback = false;
    statusLabel.textContent = `Pick all ${sequence.length} in order.`;
    accepting = true;
}
function buildGrid(items) {
    grid.innerHTML = "";
    selections = [];
    cardRefs = [];
    items.forEach((item) => {
        const card = document.createElement("button");
        card.className = "grid-card";
        card.type = "button";
        renderMedia(item, card);
        const badgeHolder = document.createElement("div");
        badgeHolder.className = "badge-holder";
        card.appendChild(badgeHolder);
        card.addEventListener("click", () => onCardClick(item, card, badgeHolder));
        grid.appendChild(card);
        cardRefs.push({ item, card, badgeHolder });
    });
}
function onCardClick(item, card, badgeHolder) {
    if (!accepting)
        return;
    const badge = document.createElement("span");
    badge.className = "pick-badge";
    badge.textContent = String(selections.length + 1);
    badgeHolder.appendChild(badge);
    selections.push({ item, card, badge });
    card.classList.add("selected");
    statusLabel.textContent = `${selections.length}/${sequence.length} selected`;
    if (selections.length === sequence.length) {
        accepting = false;
        statusLabel.textContent = "Locking in...";
        setTimeout(revealResult, TIMING.revealDelay);
    }
}
function revealResult() {
    let allCorrect = true;
    selections.forEach((sel, i) => {
        const isRight = sel.item.id === sequence[i].id;
        sel.badge.classList.add(isRight ? "right" : "wrong");
        if (!isRight)
            allCorrect = false;
    });
    if (allCorrect) {
        bestRound = Math.max(bestRound, round);
        statusLabel.textContent = "Nailed it! Next round...";
        celebrateWin();
        setTimeout(startRound, TIMING.winHold);
        return;
    }
    // Below the safe round a mistake is fatal; above it you only lose ground.
    if (round < SAFE_ROUND) {
        statusLabel.textContent = "Oops! Game over.";
        document.body.classList.add("losing");
        setTimeout(gameOver, TIMING.loseHold);
    }
    else {
        void setbackRound();
    }
}
/** Knocks the player back down the curve instead of ending the run. */
async function setbackRound() {
    const target = Math.max(1, Math.floor(round * SETBACK_KEEP));
    statusLabel.textContent = `Slipped back to round ${target}!`;
    document.body.classList.add("losing");
    await sleep(TIMING.loseHold);
    stage.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "round-banner";
    banner.textContent = `😖 Back to round ${target}`;
    stage.appendChild(banner);
    document.body.classList.remove("losing");
    await sleep(TIMING.banner);
    justSetBack = true;
    round = target - 1; // startRound() adds the one back
    await startRound();
}
function celebrateWin() {
    const colors = ["#cf4173", "#f39399", "#f6d8bd", "#5d3140", "#8c1f3a"];
    const life = TIMING.confetti + 400;
    for (let i = 0; i < 60; i++) {
        const piece = document.createElement("span");
        piece.className = "confetti-piece";
        piece.style.left = `${Math.random() * 100}vw`;
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = `${Math.random() * 0.4}s`;
        piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
        piece.style.setProperty("--drift", `${Math.random() * 160 - 80}px`);
        confettiLayer.appendChild(piece);
        setTimeout(() => piece.remove(), life);
    }
}
/**
 * Grows the shell panel to fill the viewport while the marquee and leaderboard
 * collapse away, then fades the game view in. See DESIGN.md section 4.2.
 */
async function expandIntoGame() {
    startView.classList.add("start-leaving");
    await sleep(TIMING.startFade);
    startView.classList.add("hidden");
    startView.classList.remove("start-leaving");
    document.body.classList.add("playing");
    await sleep(TIMING.startExpand);
    gameView.classList.remove("hidden");
    await sleep(TIMING.viewIn);
}
/** Reverse of expandIntoGame: shell shrinks back, marquee and leaderboard return. */
async function collapseToPanel() {
    document.body.classList.remove("playing");
    await sleep(TIMING.startExpand);
}
async function gameOver() {
    gameView.classList.add("hidden");
    finalRound.textContent = String(bestRound);
    // Stay grey through the shrink, then let the colour flood back with the
    // over screen.
    await collapseToPanel();
    overView.classList.remove("hidden");
    document.body.classList.remove("losing");
    await loadLeaderboard();
}
async function loadLeaderboard() {
    const res = await fetch("/api/scores");
    const scores = await res.json();
    leaderboardList.innerHTML = "";
    scores.forEach((s) => {
        const li = document.createElement("li");
        li.textContent = `${s.player_name} — Round ${s.round_reached}`;
        leaderboardList.appendChild(li);
    });
}
function newGame() {
    board = shuffle(pool).slice(0, GRID_SIZE);
    sequence = [];
    round = 0;
    bestRound = 0;
    seenIds = new Set();
    justSetBack = false;
}
async function resetGame() {
    overView.classList.add("hidden");
    document.body.classList.remove("losing");
    document.body.classList.add("playing");
    await sleep(TIMING.startExpand);
    gameView.classList.remove("hidden");
    await sleep(TIMING.viewIn);
    newGame();
    await startRound();
}
startBtn.addEventListener("click", async () => {
    playMusicIfChosen(); // this click is the gesture that unblocks autoplay
    if (pool.length === 0) {
        await loadMedia();
    }
    await expandIntoGame();
    if (pool.length < GRID_SIZE) {
        statusLabel.textContent = `Add more files to /assets to play! Need at least ${GRID_SIZE}.`;
        return;
    }
    newGame();
    await startRound();
});
playAgainBtn.addEventListener("click", resetGame);
saveScoreBtn.addEventListener("click", async () => {
    const name = playerNameInput.value.trim() || "Anonymous";
    await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_name: name, round_reached: bestRound }),
    });
    saveScoreBtn.disabled = true;
    saveScoreBtn.textContent = "Saved!";
    await loadLeaderboard();
});
/** Fills the About side panel from /api/settings. Edited at /admin. */
async function loadAbout() {
    const res = await fetch("/api/settings");
    const settings = await res.json();
    aboutTitle.textContent = settings.about_title;
    aboutBody.innerHTML = "";
    // Blank line separates paragraphs. textContent, so the copy is never markup.
    settings.about_text
        .split(/\n\s*\n/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .forEach((chunk) => {
        const p = document.createElement("p");
        p.className = "side-text";
        p.textContent = chunk;
        aboutBody.appendChild(p);
    });
}
const MUSIC_KEY = "mc-music-track";
const VOLUME_KEY = "mc-music-volume";
async function loadMusic() {
    const res = await fetch("/api/music");
    const tracks = await res.json();
    tracks.forEach((track) => {
        const opt = document.createElement("option");
        opt.value = track.url;
        opt.textContent = `🎵 ${track.name}`;
        musicSelect.appendChild(opt);
    });
    if (tracks.length === 0)
        musicEmpty.classList.remove("hidden");
    const savedVolume = localStorage.getItem(VOLUME_KEY);
    musicVolume.value = savedVolume !== null && savedVolume !== void 0 ? savedVolume : "50";
    bgMusic.volume = Number(musicVolume.value) / 100;
    // Restore the previous pick if that file is still on disk. Playback itself
    // waits for a user gesture — browsers block autoplay otherwise.
    const savedTrack = localStorage.getItem(MUSIC_KEY);
    if (savedTrack && tracks.some((t) => t.url === savedTrack)) {
        musicSelect.value = savedTrack;
        bgMusic.src = savedTrack;
    }
}
function playMusicIfChosen() {
    if (!bgMusic.src || !musicSelect.value)
        return;
    void bgMusic.play().catch(() => {
        /* blocked until a user gesture — the next click will start it */
    });
}
musicSelect.addEventListener("change", () => {
    const url = musicSelect.value;
    localStorage.setItem(MUSIC_KEY, url);
    if (!url) {
        bgMusic.pause();
        bgMusic.removeAttribute("src");
        return;
    }
    bgMusic.src = url;
    playMusicIfChosen();
});
musicVolume.addEventListener("input", () => {
    bgMusic.volume = Number(musicVolume.value) / 100;
    localStorage.setItem(VOLUME_KEY, musicVolume.value);
});
function toggleSettings(open) {
    const willOpen = open !== null && open !== void 0 ? open : settingsPanel.classList.contains("hidden");
    settingsPanel.classList.toggle("hidden", !willOpen);
    settingsBtn.setAttribute("aria-expanded", String(willOpen));
}
settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSettings();
});
document.addEventListener("click", (e) => {
    const target = e.target;
    if (settingsPanel.classList.contains("hidden"))
        return;
    if (settingsPanel.contains(target) || settingsBtn.contains(target))
        return;
    toggleSettings(false);
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
        toggleSettings(false);
});
/* ------------------------------------------------------------------ *
 * Debug harness — see DESIGN.md section 6.
 * Lets you replay a transition repeatedly without playing honest rounds.
 * ------------------------------------------------------------------ */
const DEBUG = location.search.includes("debug=1") ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
function clearPicks() {
    cardRefs.forEach((ref) => {
        ref.badgeHolder.innerHTML = "";
        ref.card.classList.remove("selected");
    });
    selections = [];
}
/** Fills in the whole round's picks automatically, then lets the normal reveal run. */
async function debugAutoPlay(correct) {
    if (gameView.classList.contains("hidden") || cardRefs.length === 0)
        return;
    skipPlayback = true;
    await sleep(80); // let the playback loop unwind and hand back control
    clearPicks();
    accepting = true;
    sequence.forEach((item, i) => {
        var _a;
        let target = cardRefs.find((r) => r.item.id === item.id);
        if (!correct && i === sequence.length - 1) {
            target = (_a = cardRefs.find((r) => r.item.id !== item.id)) !== null && _a !== void 0 ? _a : target;
        }
        if (target)
            onCardClick(target.item, target.card, target.badgeHolder);
    });
}
async function debugSkipPlayback() {
    skipPlayback = true;
}
async function debugNextRound(step = 1) {
    if (gameView.classList.contains("hidden"))
        return;
    skipPlayback = true;
    await sleep(80);
    accepting = false;
    round += step - 1; // startRound adds the last one
    await startRound();
}
function debugReset() {
    gameView.classList.add("hidden");
    overView.classList.add("hidden");
    document.body.classList.remove("playing", "losing");
    startView.classList.remove("hidden", "start-leaving");
    grid.innerHTML = "";
    stage.innerHTML = "";
    cardRefs = [];
    selections = [];
    accepting = false;
    skipPlayback = true;
    round = 0;
    bestRound = 0;
    sequence = [];
    seenIds = new Set();
    justSetBack = false;
    saveScoreBtn.disabled = false;
    saveScoreBtn.textContent = "💾 Save Score";
}
function installDebug() {
    const hint = document.createElement("div");
    hint.className = "debug-hint";
    hint.textContent = "debug  W win  L lose  S skip  N next  J +10 rounds  R reset";
    document.body.appendChild(hint);
    document.addEventListener("keydown", (e) => {
        const target = e.target;
        if (target &&
            (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
            return;
        }
        if (!settingsPanel.classList.contains("hidden"))
            return; // settings has focus
        switch (e.key.toLowerCase()) {
            case "w":
                void debugAutoPlay(true);
                break;
            case "l":
                void debugAutoPlay(false);
                break;
            case "s":
                void debugSkipPlayback();
                break;
            case "n":
                void debugNextRound(1);
                break;
            case "j":
                void debugNextRound(10);
                break;
            case "r":
                debugReset();
                break;
        }
    });
}
if (DEBUG)
    installDebug();
loadMedia();
loadLeaderboard();
loadMusic();
loadAbout();
