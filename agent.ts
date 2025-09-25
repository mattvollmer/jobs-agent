import { convertToModelMessages, streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import { load } from "cheerio";

export default blink.agent({
  async sendMessages({ messages }) {
    return streamText({
      model: "anthropic/claude-sonnet-4",
      system: `You are OllieBot, a friendly bot designed to help job seekers find and learn about open roles at Coder.

You have tools for:
- Fetching and parsing HTML content (no JS execution)
- Listing Coder job openings and fetching details for a specific job

Identity and voice:
- Always refer to yourself as "OllieBot".
- Always speak in first person about Coder (e.g., "our leadership team", "our roles").
- Do not mention vendor/model/provider names.
- If asked about provider/model/compute, give a brief non-technical reply and redirect back to helping with Coder jobs.

Behavior for job-related questions:
- If asked broadly (e.g., "what jobs are open?"), call list_coder_jobs and return a concise bulleted list using nested bullets:
  - Top-level bullet: the job title (plain text)
  - Sub-bullets (each on its own line):
    - Department/Team (if present)
    - Location
    - WorkplaceType (Remote/Hybrid/On-site)
    - Compensation (if available)
    - Link (the full job URL)
- If asked about a specific role (e.g., "are you hiring for Sales Engineer?"), filter the listings by title substring (case-insensitive). Return the same nested-bullet format for each matching opening. If none match, say none found and suggest related titles.
- Keep responses brief; do not dump full descriptions. Link out to the listing page for details.

Leadership questions:
- If asked about our leadership team, fetch and parse https://coder.com/about (use fetch_and_parse_html). Provide a brief first-person summary of key leaders (name and role) using nested bullets, then include the About link for reference. Do not only redirect; include context and the link.

Docs ingestion (benefits/people/company info):
- For Coder company questions (e.g., benefits, policies, culture, interview process, people/teams), call read_public_google_doc with no url to use GOOGLE_DOC_URL or GOOGLE_DOC_URLS by default. If no default is configured, ask for a public link. Summarize briefly in first person using nested bullets when appropriate. Do not include or expose the Google Doc link in your response.
`,
      messages: convertToModelMessages(messages),
      tools: {
        fetch_and_parse_html: tool({
          description:
            "Fetch a URL and parse HTML to extract metadata, headings, links, and plain text. Does not execute JavaScript.",
          inputSchema: z.object({
            url: z.string().url(),
            extract: z
              .array(
                z.enum(["title", "description", "headings", "links", "text"]),
              )
              .optional(),
            maxContentChars: z.number().int().positive().max(200000).optional(),
          }),
          execute: async ({ url, extract, maxContentChars }) => {
            const headers = {
              "User-Agent":
                "jobs-agent/1.0 (+https://github.com/mattvollmer/jobs-agent)",
              Accept: "text/html,application/xhtml+xml",
            } as const;

            const res = await fetch(url, { headers });
            if (!res.ok)
              throw new Error(
                `Failed to fetch ${url}: ${res.status} ${res.statusText}`,
              );
            const contentType = res.headers.get("content-type") ?? "";
            const html = await res.text();
            const $ = load(html);

            const opts = {
              extract: extract ?? [
                "title",
                "description",
                "headings",
                "links",
                "text",
              ],
              maxContentChars: maxContentChars ?? 10000,
            } as const;

            const out: any = {
              url,
              status: res.status,
              contentType,
            };

            if (opts.extract.includes("title")) {
              out.title = (
                $('meta[property="og:title"]').attr("content") ||
                $("title").first().text() ||
                ""
              ).trim();
            }

            if (opts.extract.includes("description")) {
              out.description = (
                $('meta[name="description"]').attr("content") ||
                $('meta[property="og:description"]').attr("content") ||
                ""
              ).trim();
            }

            if (opts.extract.includes("headings")) {
              const pick = (sel: string) =>
                $(sel)
                  .map((_, el) => $(el).text().trim())
                  .get()
                  .filter(Boolean);
              out.headings = {
                h1: pick("h1"),
                h2: pick("h2"),
              };
            }

            if (opts.extract.includes("links")) {
              out.links = $("a[href]")
                .map((_, el) => {
                  const href = $(el).attr("href") || "";
                  const text = $(el).text().trim();
                  return { href, text };
                })
                .get()
                .filter((l) => l.href)
                .slice(0, 500);
            }

            if (opts.extract.includes("text")) {
              let text = $("body").text().replace(/\s+/g, " ").trim();
              if (text.length > opts.maxContentChars) {
                text = text.slice(0, opts.maxContentChars);
              }
              out.text = text;
            }

            return out;
          },
        }),

        list_coder_jobs: tool({
          description:
            "List open roles from Coder's AshbyHQ page (parses inline JSON, no JS).",
          inputSchema: z.object({}),
          execute: async () => {
            const sourceUrl = "https://jobs.ashbyhq.com/Coder";
            const res = await fetch(sourceUrl, {
              headers: {
                "User-Agent":
                  "jobs-agent/1.0 (+https://github.com/mattvollmer/jobs-agent)",
                Accept: "text/html,application/xhtml+xml",
              },
            });
            if (!res.ok)
              throw new Error(
                `Failed to fetch listings: ${res.status} ${res.statusText}`,
              );
            const html = await res.text();

            const m = html.match(/window\.__appData\s*=\s*(\{[\s\S]*?\});/);
            if (!m || !m[1]) throw new Error("Ashby inline appData not found");
            const jsonText = m[1];
            const appData = JSON.parse(jsonText as string);

            const postings =
              (appData as any)?.jobBoard?.jobPostings ??
              (appData as any)?.jobPostingList?.jobPostings ??
              [];
            const jobs = (postings as any[]).map((p: any) => ({
              id: p.id as string,
              title: (p.title as string) ?? "",
              department: (p.departmentName as string) ?? null,
              team: (p.teamName as string) ?? null,
              location: (p.locationName as string) ?? null,
              workplaceType: (p.workplaceType as string) ?? null,
              employmentType: (p.employmentType as string) ?? null,
              isListed: (p.isListed as boolean) ?? null,
              publishedDate: (p.publishedDate as string) ?? null,
              compensationTierSummary: p.shouldDisplayCompensationOnJobBoard
                ? ((p.compensationTierSummary as string) ?? null)
                : null,
              jobUrl: `${sourceUrl}/${p.id}`,
            }));

            return { sourceUrl, count: jobs.length, jobs };
          },
        }),

        get_coder_job_details: tool({
          description:
            "Fetch details for a specific Coder job posting URL on AshbyHQ (parses inline JSON).",
          inputSchema: z.object({ url: z.string().url() }),
          execute: async ({ url }) => {
            const res = await fetch(url, {
              headers: {
                "User-Agent":
                  "jobs-agent/1.0 (+https://github.com/mattvollmer/jobs-agent)",
                Accept: "text/html,application/xhtml+xml",
              },
            });
            if (!res.ok)
              throw new Error(
                `Failed to fetch job page: ${res.status} ${res.statusText}`,
              );
            const html = await res.text();

            const appDataMatch = html.match(
              /window\.__appData\s*=\s*(\{[\s\S]*?\});/,
            );
            if (!appDataMatch || !appDataMatch[1])
              throw new Error("Ashby inline appData not found on job page");
            const appData = JSON.parse(appDataMatch[1] as string);

            const jobId = (() => {
              try {
                const u = new URL(url);
                const parts = u.pathname.split("/").filter(Boolean);
                return parts[parts.length - 1] ?? null;
              } catch {
                return null;
              }
            })();

            const deepFind = (node: any, fn: (v: any) => boolean): any => {
              if (node == null) return undefined;
              if (fn(node)) return node;
              if (Array.isArray(node)) {
                for (const item of node) {
                  const r = deepFind(item, fn);
                  if (r !== undefined) return r;
                }
              } else if (typeof node === "object") {
                for (const k of Object.keys(node)) {
                  const v = (node as any)[k];
                  const r = deepFind(v, fn);
                  if (r !== undefined) return r;
                }
              }
              return undefined;
            };

            const jobPosting = deepFind(
              appData,
              (v) =>
                v &&
                typeof v === "object" &&
                (v as any).id &&
                typeof (v as any).title === "string" &&
                (jobId ? (v as any).id === jobId : true),
            );

            const postingWrapper = deepFind(
              appData,
              (v) =>
                v &&
                typeof v === "object" &&
                (v as any).posting &&
                typeof (v as any).posting.title === "string",
            );
            const posting = (postingWrapper as any)?.posting;

            const ldjsonMatch = html.match(
              /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
            );
            let ldjson: any = undefined;
            if (ldjsonMatch && ldjsonMatch[1]) {
              try {
                const parsed = JSON.parse(ldjsonMatch[1] as string);
                ldjson = Array.isArray(parsed)
                  ? parsed.find((x) => x?.["@type"] === "JobPosting")
                  : parsed?.["@type"] === "JobPosting"
                    ? parsed
                    : undefined;
              } catch {}
            }

            const base = (posting ?? jobPosting ?? {}) as any;

            const title: string = base.title || ldjson?.title || "";
            const descriptionHtml: string =
              base.descriptionHtml || ldjson?.description || "";
            const department: string | null = base.departmentName ?? null;
            const team: string | null = base.teamName ?? null;
            const location: string | null = base.locationName ?? null;
            const employmentType: string | null =
              base.employmentType ?? ldjson?.employmentType ?? null;
            const publishedDate: string | null =
              base.publishedDate ?? ldjson?.datePosted ?? null;
            const compensationTierSummary: string | null =
              base.compensationTierSummary ?? null;

            let applyUrl: string | null = null;
            const anchorMatch = html.match(
              /<a[^>]+href=["']([^"']+)["'][^>]*>(?:[^<]*apply[^<]*|[^<]*Apply[^<]*)<\/a>/i,
            );
            if (anchorMatch && anchorMatch[1]) {
              try {
                const abs = anchorMatch[1] as string;
                applyUrl = abs.startsWith("http")
                  ? abs
                  : new URL(abs, url).toString();
              } catch {}
            }

            return {
              id: jobId,
              url,
              title,
              department,
              team,
              location,
              employmentType,
              publishedDate,
              compensationTierSummary,
              descriptionHtml,
              applyUrl,
            };
          },
        }),

        read_public_google_doc: tool({
          description:
            "Read content from a public Google Docs link. If no url is provided, defaults to GOOGLE_DOC_URL or first in GOOGLE_DOC_URLS (comma-separated). Supports export as text or HTML. No auth required if the doc is public.",
          inputSchema: z.object({
            url: z.string().url().optional(),
            format: z.enum(["txt", "html"]).optional(),
            maxChars: z.number().int().positive().max(500000).optional(),
          }),
          execute: async ({ url, format, maxChars }) => {
            // If URL not provided, try env vars
            const envSingle = process.env.GOOGLE_DOC_URL;
            const envMulti = process.env.GOOGLE_DOC_URLS; // comma-separated
            const chosenUrl =
              url ??
              envSingle ??
              (envMulti ? envMulti.split(/\s*,\s*/)[0] : undefined);
            if (!chosenUrl) {
              throw new Error(
                "Missing URL. Provide 'url' or set GOOGLE_DOC_URL (single) or GOOGLE_DOC_URLS (comma-separated).",
              );
            }
            const u = new URL(chosenUrl);
            const sourceUrl = u.toString();
            const fmt = format ?? "txt";
            const headers = {
              "User-Agent":
                "jobs-agent/1.0 (+https://github.com/mattvollmer/jobs-agent)",
              Accept:
                fmt === "html"
                  ? "text/html,application/xhtml+xml"
                  : "text/plain, text/html;q=0.7",
            } as const;

            const mDoc = u.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
            const mPub = u.pathname.match(/\/document\/d\/e\/([a-zA-Z0-9_-]+)/);

            const fetchText = async (endpoint: string) => {
              const res = await fetch(endpoint, { headers });
              if (!res.ok)
                throw new Error(
                  `Failed to fetch ${endpoint}: ${res.status} ${res.statusText}`,
                );
              return res.text();
            };

            let content = "";
            let mode: "export" | "published" | "raw" = "raw";
            let usedUrl = sourceUrl;
            if (mDoc && mDoc[1]) {
              // Use export endpoint
              const docId = mDoc[1];
              const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=${fmt}`;
              usedUrl = exportUrl;
              content = await fetchText(exportUrl);
              mode = "export";
            } else if (mPub && mPub[1]) {
              // Published to web link, fetch embedded HTML and extract text if txt requested
              const pubId = mPub[1];
              const pubUrl = `https://docs.google.com/document/d/e/${pubId}/pub?embedded=true`;
              usedUrl = pubUrl;
              const html = await fetchText(pubUrl);
              if (fmt === "html") {
                content = html;
              } else {
                const $ = load(html);
                const text = $("body").text().replace(/\s+/g, " ").trim();
                content = text;
              }
              mode = "published";
            } else {
              // Fallback: fetch whatever is at the URL (must be public) and extract
              const raw = await fetchText(sourceUrl);
              if (fmt === "html") {
                content = raw;
              } else {
                const $ = load(raw);
                content = $("body").text().replace(/\s+/g, " ").trim();
              }
              mode = "raw";
            }

            const limit = maxChars ?? (fmt === "html" ? 200000 : 100000);
            if (content.length > limit) content = content.slice(0, limit);

            return {
              sourceUrl,
              resolvedUrl: usedUrl,
              mode,
              format: fmt,
              length: content.length,
              content,
            };
          },
        }),
      },
    });
  },
});
