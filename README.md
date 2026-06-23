# Doodle Chain

A draw-and-guess party game. Write a prompt, draw what the last person wrote, guess what the last person drew, and watch the chain go gloriously wrong. No accounts: share a four-letter room code and play.

**Live: [doodlechain.app.space](https://doodlechain.app.space)** · MIT · Built on the [DeepSpace SDK](https://docs.deep.space)

## Quick start

Deploy your own copy:

```sh
git clone https://github.com/deepdotspace/doodlechain && cd doodlechain
npm install
npx deepspace login     # one-time, opens a browser tab
npx deepspace deploy    # → <name>.app.space
```

Real-time sync, the database, and hosting all come from DeepSpace, so there's nothing else to configure. Your subdomain is the `name` field in `wrangler.toml`; change it for your own deployment. For local changes, use `npx deepspace dev`.

## How to play

1. One person creates a room and shares the four-letter code.
2. Everyone picks a nickname and joins. No sign-up.
3. Each player writes a short starting prompt. Then the "books" pass around the table: you draw the prompt you were handed, the next player guesses your drawing in words, the next draws that guess, and so on until every book has visited everyone.
4. The reveal plays each chain back as a slideshow, so the whole room can see how "a cowboy octopus on a skateboard" turned into something unrecognizable.

Best with 2 to 10 players on laptops with a voice call running in another window. A round takes about five minutes.

## Commands

| Command | What it does |
|---|---|
| `npx deepspace dev` | Local dev server (Vite + Worker, HMR on `:5173`) |
| `npx deepspace deploy` | Deploy to `<name>.app.space` |
| `npx deepspace test` | Smoke + API specs |
| `npm run test:unit` | Unit tests (vitest) |
| `npm run type-check` | `tsc --noEmit` |

## How it works

A DeepSpace app on Cloudflare Workers. Each room is a real-time Durable Object: players connect over a WebSocket, and the host-authoritative game state (lobby, the per-round draw/guess phases, the chain rotation, and the final reveal) syncs to every screen in the same tick. Players are anonymous, identified by a nickname and a room code. The chain rotation (who draws whose guess each round) is a small pure module in `src/game/`.

## Tests

- **Smoke + API** (Playwright): the landing, room creation, and worker API.
- **Unit** (vitest): the chain-rotation invariants and game logic.
- `npm run type-check` runs `tsc --noEmit`.

## Credits

Background music by Kevin MacLeod (incompetech.com), licensed under Creative Commons Attribution 4.0. Full attribution in [CREDITS.md](CREDITS.md). A mute toggle is always in the corner.

## License

MIT, see [LICENSE](LICENSE). Built with the [DeepSpace SDK](https://docs.deep.space).
