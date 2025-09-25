# jobs-agent

Minimal Blink agent scaffold built with TypeScript and AI SDK v5.

## Features

- HTML parsing tool using Cheerio (no JS execution)
- Coder jobs tools: list openings and fetch details from AshbyHQ (parses inline JSON, no JS)
- AI SDK v5 tool-call syntax using `inputSchema`
- TypeScript configuration targeting modern ESNext
- Bun lockfile committed for reproducible installs

## Behavior

- Identity: Responds as "OllieBot" in first person about Coder (e.g., "our leadership team"); does not reference vendor/model names. For provider/compute questions, replies briefly and redirects to Coder jobs help.
- Broad jobs queries (e.g., "what jobs are open?") return a concise nested-bullet summary:
  - Top-level bullet: job title
  - Sub-bullets: department/team, location, workplaceType (Remote/Hybrid/On-site), compensation (if available), and a link to the job listing.
- Specific role queries (e.g., "are you hiring for Sales Engineer?") filter listings by title (case-insensitive) and return the same nested-bullet style for each matching opening, including links. If none match, the agent reports none found and may suggest related titles.
- Leadership questions: Fetch and parse https://coder.com/about, provide a brief first-person summary of key leaders (name and role) using nested bullets, and include the About link for reference.
- The agent keeps responses brief and links out for full details.

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

# Deploy to production
npx blink deploy --prod
```

## Tools

### fetch_and_parse_html

Fetches a URL and parses HTML to extract metadata, headings, links, and body text.

Input:

```json
{
  "url": "https://example.com",
  "extract": ["title", "description", "headings", "links", "text"],
  "maxContentChars": 10000
}
```

Notes:

- No JavaScript execution; client-rendered pages may be incomplete
- Adds a User-Agent header

### list_coder_jobs

Lists open roles from Coder's AshbyHQ page by parsing the inline `window.__appData` JSON payload.

Output shape:

```json
{
  "sourceUrl": "https://jobs.ashbyhq.com/Coder",
  "count": 3,
  "jobs": [
    {
      "id": "<uuid>",
      "title": "...",
      "department": "...",
      "team": "...",
      "location": "...",
      "workplaceType": "Remote",
      "employmentType": "FullTime",
      "publishedDate": "2025-08-20",
      "compensationTierSummary": "...",
      "jobUrl": "https://jobs.ashbyhq.com/Coder/<uuid>"
    }
  ]
}
```

### get_coder_job_details

Fetches details for an individual Coder job posting URL by parsing inline JSON (and structured ld+json if present).

Input:

```json
{ "url": "https://jobs.ashbyhq.com/Coder/<job-id>" }
```

Output includes:

- id, title, department/team, location, employmentType, publishedDate
- compensationTierSummary (if available)
- descriptionHtml (best-effort from inline JSON or ld+json)
- applyUrl (best-effort from anchors on the page)

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

- HTML parsing is best-effort and may not capture JS-rendered content
- Ashby jobs parsing uses inline JSON and does not execute JS
- Update the agent model, system prompt, and tools in `agent.ts` to suit your use case.

## License

TBD
