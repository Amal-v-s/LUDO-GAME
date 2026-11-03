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
