# Ludo Club

A lightweight browser Ludo game for 2–6 friends. One player creates a room, shares its six-character code, and starts the game when everyone is ready.

## Run locally

Requires Node.js 18 or newer.

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). For friends on other devices to connect, run the server on a host reachable by them and share its address along with the room code.

## Gameplay

- Take turns rolling a six-sided die.
- Roll a six to move a token out of the yard.
- Land on an opponent to send their token back, except on safe spaces.
- Roll the exact number to move a token home.
- Rolling a six, capturing, or reaching home grants another turn.

## Private game archive setup

The private records page is served directly at `/archive` and has no link in the public game UI. Its API remains unavailable until the server has a PostgreSQL connection and private-access secrets.

1. Create a PostgreSQL database and configure `DATABASE_URL` on the app service. For Render, use the database's internal connection URL when the web service and database share a region.
2. Run `npm run private:password` in a local terminal. It prompts without echoing the password and prints a scrypt hash. Put the printed value in the Render environment as `ADMIN_PASSWORD_HASH`.
3. Set `ADMIN_USERNAME` and `ADMIN_SESSION_SECRET` on the service. Generate the session secret with `openssl rand -hex 32`. Keep these values in the hosting provider's secret environment settings, never in the repository.
4. Deploy. The service creates the archive tables on startup. Newly captured photos and games started after the database is configured are archived there. Rows are retained until explicitly removed from PostgreSQL.

The photo and game archive endpoints require a same-origin authenticated session. The session cookie is HttpOnly, Secure on HTTPS, SameSite=Strict, signed, and expires after one hour. The sign-in page is not linked from the game.

## Automated tests

Install dependencies with `npm ci`, then run `npm test` for the complete local check. The command syntax-checks the server and browser scripts, runs unit and live-HTTP integration tests, and launches Chromium end-to-end tests. CI runs the same command on every push and pull request.

Individual commands:

```sh
npm run test:unit         # Rules and shared board geometry
npm run test:integration  # Isolated server processes and HTTP clients
npm run test:e2e          # Chromium browser flows, including two clients
npm run test:coverage     # Rule-module coverage report
```

Coverage text, HTML, and LCOV reports are written to `coverage/`. The current 90% threshold applies to the extracted core rules in `game-rules.js`; it does not imply 90% coverage of the entire browser UI or server. Playwright failure screenshots and traces are written to `test-results/`.

The server is plain Node HTTP with in-memory rooms and polling; it does not use React, Socket.IO, or WebSockets. Integration tests use independent server processes and deterministic dice values. Browser tests use independent browser contexts and deterministic server rolls. For manual local debugging, run `npm start`, then visit `http://localhost:3000`.

The tests record a known game-rule mismatch as an expected failure: the current rules mark a player as a winner when their first token reaches home, although Ludo normally requires all four tokens. The suite deliberately does not change that existing behavior. Rooms also reject joining after a game starts, so late-join synchronization is not an applicable supported flow. These limitations should be resolved as separate product decisions, then the corresponding tests can become required passing cases.
