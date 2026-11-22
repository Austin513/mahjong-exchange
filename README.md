# Mahjong Exchange

A multiplayer website that combines a live four-seat Riichi mahjong table with a
play-money market on who wins each hand.

> Work in progress. See `docs/PLAN.md` for the plan and `docs/prs/` for PR descriptions.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5175 (Vite middleware + WebSocket server, seeded rooms allowed)
# or a production build:
npm run build && npm start
```

Other commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run bot-eval`.

Rules: `docs/RULES.md` (also at `/rules` in the app).
