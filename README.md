# Ludo Club

A lightweight browser Ludo game for 2–6 friends. One player creates a room, shares its six-character code, and starts the game when everyone is ready.

## Run locally

Requires Node.js 18 or newer. No package installation is needed.

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). For friends on other devices to connect, run the server on a host reachable by them and share its address along with the room code.

## Gameplay

- Take turns rolling a six-sided die.
- Roll a six to move a token out of the yard.
- Land on an opponent to send their token back, except on safe spaces.
- Roll the exact number to move a token home.
- Rolling a six, capturing, or reaching home grants another turn.
