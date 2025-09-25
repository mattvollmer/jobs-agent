# jobs-agent

Minimal Blink agent scaffold built with TypeScript and AI SDK v5.

## Features

- Blink agent with an example tool (`get_ip_info`) that fetches IP information
- AI SDK v5 tool-call syntax using `inputSchema`
- TypeScript configuration targeting modern ESNext
- Bun lockfile committed for reproducible installs

## Prerequisites

- Bun (recommended) or Node.js 18+
- Access to the Blink CLI (`npx blink`) and an account to deploy if desired

## Quickstart

```bash
# Install dependencies (uses bun.lock)
bun install

# Start the dev server (runs the local Blink agent)
npx blink dev
```

## Deploy

```bash
# Deploy to Blink cloud (staging)
npx blink deploy

# Deploy to production	npx blink deploy --prod
```

## Environment variables

- Local development: `.env.local`
- Production: `.env.production`

Do not commit secrets. The `.gitignore` already excludes `.env*`.

## Project structure

```
.
├─ AGENTS.md           # Notes about agent conventions and dev/deploy tips
├─ agent.ts            # Agent entrypoint (Blink agent definition)
├─ package.json        # Dependencies and module config
├─ tsconfig.json       # TypeScript config (ESNext, strict mode)
├─ bun.lock            # Bun lockfile
└─ .gitignore
```

See `AGENTS.md` for additional guidance:

- Use AI SDK v5 for tool-call syntax (inputSchema)
- Store local secrets in `.env.local` and production secrets in `.env.production`
- Use `blink dev` for local development and `blink deploy` for cloud deployment

## Notes

- The example tool `get_ip_info` demonstrates how tools work by calling `https://ipinfo.io/json`.
- Update the agent model, system prompt, and tools in `agent.ts` to suit your use case.

## License

TBD
