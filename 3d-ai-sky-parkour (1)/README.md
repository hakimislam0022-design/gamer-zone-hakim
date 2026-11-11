# 3D Extreme Sky Parkour – AI BOT & YouTube Live

A browser-based 3D parkour game (Three.js + Next.js + PostgreSQL/Drizzle). It is **not** a Roblox game and does not need Roblox Studio.

* Procedural, validated, endless stage generator (stages 1–1000 unlocked, ids above 1000 keep generating).
* Autonomous AI BOT that navigates every obstacle type; instantly hands control back to the human when switched off.
* Talking block character (black outfit, white smiling face, white cap with red band and **R**) with blinking, eye/head movement, expressions and **audio-driven lip-sync**.
* Real YouTube Live Chat integration (official YouTube Data API v3, OAuth 2.0, tokens stored server-side only).
* Independent toggles: AI BOT, AI TALK, LIVE CHAT, AI VOICE, MUSIC, JOYSTICK.

## Run

```bash
npm install
npx drizzle-kit push        # creates the tables (needs DATABASE_URL)
npm run build && npm start  # or: npm run dev
```
Open `http://localhost:3000`. Press **H** to hide the UI for stream capture (OBS Browser Source / Window Capture, 1920×1080).

Copy `.env.example` to `.env` and fill in the keys below. **The game runs without any key**, but the features marked ⚠ are then limited – this is reported in the UI, never faked.

## What YOU must configure (external requirements)

| Feature | Needed | Without it |
|---|---|---|
| ⚠ AI conversation | `OPENAI_API_KEY` (any OpenAI-compatible endpoint via `OPENAI_BASE_URL`, model via `OPENAI_MODEL`) | Falls back to a rule-based Bengali/English responder (UI says *rule-based fallback*). Less intelligent, no real follow-up memory beyond rules. |
| ⚠ Character voice | `OPENAI_API_KEY` (uses `/audio/speech`, model `OPENAI_TTS_MODEL`, voice `OPENAI_TTS_VOICE`) | Falls back to the browser's speechSynthesis (voice differs per device; Bengali needs an installed `bn` voice) and the mouth uses an *estimated* envelope instead of the real audio signal. If no voice exists at all the reply is shown as subtitles only. |
| ⚠ YouTube Live Chat | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (+ optional `YOUTUBE_REDIRECT_URI`) | LIVE CHAT shows *NOT CONFIGURED / AUTHORIZATION NEEDED / WAITING FOR LIVESTREAM*. No comments are ever invented. |
| Hosting | A public HTTPS URL for OAuth in production (localhost works for testing) | – |

### YouTube setup (once)
1. Google Cloud Console → create project → enable **YouTube Data API v3**.
2. OAuth consent screen (External; add yourself as a test user while in testing mode) with scope `https://www.googleapis.com/auth/youtube.readonly`.
3. Credentials → OAuth client ID → *Web application* → Authorized redirect URI: `https://<your-host>/api/youtube/callback` (or `http://localhost:3000/api/youtube/callback`).
4. Put the client id/secret in `.env`, restart, open the game panel → **Authorize YouTube** and sign in with the channel that is (or will be) live.
5. When a broadcast is active the server auto-detects its live chat (or paste a video ID/URL and press *Connect*). Messages posted *before* the connection are treated as backlog and never answered.

> **Quota:** `liveChatMessages.list` costs ~5 units; the default quota is 10,000 units/day ≈ 2,000 polls/day (one poll every ~43 s for 24 h). The server polls at YouTube's `pollingIntervalMillis` (min 5 s) and reports `API QUOTA EXCEEDED` in the UI. For true 24-hour streams request a quota increase from Google.
> Apps in OAuth *testing* mode have refresh tokens that expire after 7 days – publish the consent screen to avoid re-authorizing weekly.

## Controls & toggles
Desktop: WASD/arrows, Space (jump), mouse drag orbit, wheel zoom. Mobile: JOYSTICK ON gives a virtual stick, JUMP button and camera arrows (canvas drag also rotates the camera).

* **AI BOT** – the only controller while ON; OFF cancels pending decisions and returns the keyboard/joystick.
* **AI TALK** – character brain: ambient commentary, event reactions and AI replies to chat. OFF = silent character.
* **LIVE CHAT** – polls real YouTube comments. Independent of AI BOT (viewers still get answers while the bot is off). Needs AI TALK on to generate replies, and AI VOICE on to *speak* them (otherwise they appear as subtitles).
* **AI VOICE**, **MUSIC**, **JOYSTICK** – independent.
* LIVE CHAT is ON by default and becomes active automatically once authorization + an active stream exist.

## Chat safety pipeline (server side)
sanitise → URL/spam filter → profanity filter → prompt-injection detection (fixed playful refusal, the LLM is never shown such text) → duplicate (60 s) and per-author rate limiting (4 msgs / 20 s) → persistent dedupe by YouTube message id (DB) → client queue with global (6.5 s) and per-viewer (20 s) cooldowns and 120 s expiry. The LLM sees viewer text only as quoted untrusted data; replies are stripped of URLs/markdown.

## Architecture
* `src/lib/stage/` – shared deterministic generator (`generator.ts`), jump physics constants and an **independent validator** (`validator.ts`: polygon-distance reachability for every jump incl. moving platforms at all phases, run-up check, overlap check, waypoint/hazard checks).
* `src/game/` – Three.js engine (`engine.ts`), custom kinematic physics (`physics.ts`), bot (`bot.ts`), character (`character.ts`), sky/ocean/clouds/decor (`scenery.ts`), procedural audio (`audio.ts`), voice + lip-sync (`voice.ts`).
* `src/app/api/` – progress, logs, config, TTS, chat reply, YouTube (auth, callback, status, connect, poll, disconnect), stage validation.
* DB tables: `player_progress`, `stage_records`, `youtube_auth` (tokens), `chat_messages`, `error_logs`.

## Verification actually performed
Run these yourself:
```bash
npx tsx scripts/validate-stages.ts 1 1000   # generator + validator for 1000 stages
npx tsx scripts/simulate-bot.ts 1 100       # headless physics simulation of the AI bot
```
Results at delivery time: **1000/1000 stages valid, 0 duplicate layouts**; headless bot simulation completed **100/100** stages 1–100 (≈60 falls in total, a few sections needed the bot's "assist" skip after 9 failures at one checkpoint) and 59/61 of stages 700–760 within the 240 s test limit. See "Honest limitations".

## Honest limitations
* **Not tested here:** real YouTube comments, real OAuth, OpenAI LLM/TTS and listening to the lip-sync need *your* keys and a live stream; the code paths are implemented but were not exercised against the live services in the build sandbox. The browser game itself was type-checked and production-built, but not visually inspected on a real GPU/browser in this environment.
* **24-hour stability is not proven.** No 24 h soak test was run. Mitigations exist (per-stage disposal of GPU resources, bounded caches, WebGL context-loss recovery, error-triggered stage rebuild, FPS-based quality fallback, persistent progress, error logging to `error_logs`), but you should run your own multi-hour test and watch the Diagnostics panel (JS heap, GPU geometries/textures).
* **Map fidelity:** the world reproduces the *style* and obstacle vocabulary of the reference screenshots (neon rectangles, pink/purple checkerboard slabs, green stair-steps, red sphere rows, rotating bars, moving platforms, black-and-white road strips, rainbow towers, orange tower, oval/round platforms, bridges, tall spiral towers, ocean, clouds, beach islands in the distance) using procedurally generated, validated stages plus a large decorative mega-course in the background. It is not a 1:1 copy of one fixed map, because stages must be generated endlessly and be provably completable.
* **Character:** recreated from the reference silhouette/colours (black outfit, white face with smile, white cap with red band and R). The torso text reads "ROBO" instead of the third-party brand name.
* The bot is a heuristic planner (waypoint route + ballistic jump aiming + hazard prediction), not a learned agent; on rare sections it needs many attempts and then uses a clearly logged assist skip.
* Real music licensing: audio is original/procedural (see `MUSIC_LICENSE.md`). Check your TTS provider's terms for monetised streams.
