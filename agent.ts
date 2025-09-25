import { convertToModelMessages, streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import { load } from "cheerio";

export default blink.agent({
  async sendMessages({ messages }) {
    return streamText({
      model: "anthropic/claude-sonnet-4",
      system: `You are a basic agent the user will customize.

You have tools for:
- Fetching and parsing HTML content (no JS execution)
- Listing Coder job openings and fetching details for a specific job
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
                z.enum(["title", "description", "headings", "links", "text"])
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
                `Failed to fetch ${url}: ${res.status} ${res.statusText}`
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
          description: "List open roles from Coder's AshbyHQ page.",
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
                `Failed to fetch listings: ${res.status} ${res.statusText}`
              );
            const html = await res.text();
            const $ = load(html);

            const seen = new Set<string>();
            const jobs: Array<{
              title: string;
              url: string;
              location?: string | null;
              team?: string | null;
            }> = [];

            $("a[href]").each((_, el) => {
              const href = $(el).attr("href") || "";
              const absolute = href.startsWith("http")
                ? href
                : new URL(href, sourceUrl).toString();
              if (!absolute.includes("jobs.ashbyhq.com/Coder/")) return;
              const title = $(el).text().trim();
              if (!title || seen.has(absolute)) return;

              // Heuristic: try to pick nearby text for location/team
              const card = $(el).closest("a, div, li, article");
              const nearby = card.text().replace(/\s+/g, " ").trim();
              let location: string | null = null;
              let team: string | null = null;

              // naive parsing hints
              const locMatch = nearby.match(
                /(Remote|Hybrid|On[- ]site|USA|United States|Canada|Europe|[A-Z][a-z]+, [A-Z]{2})/
              );
              if (locMatch) location = locMatch[0];

              jobs.push({ title, url: absolute, location, team });
              seen.add(absolute);
            });

            return { sourceUrl, count: jobs.length, jobs };
          },
        }),

        get_coder_job_details: tool({
          description:
            "Fetch details for a specific Coder job posting URL on AshbyHQ.",
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
                `Failed to fetch job page: ${res.status} ${res.statusText}`
              );
            const html = await res.text();
            const $ = load(html);

            const title = (
              $('meta[property="og:title"]').attr("content") ||
              $("h1").first().text() ||
              $("title").text() ||
              ""
            ).trim();

            const description = (
              $('meta[name="description"]').attr("content") ||
              $('meta[property="og:description"]').attr("content") ||
              ""
            ).trim();

            // Try ld+json JobPosting for structured data
            let structured: any = undefined;
            try {
              const rawLd = $('script[type="application/ld+json"]')
                .first()
                .text();
              if (rawLd) {
                const parsed = JSON.parse(rawLd);
                if (Array.isArray(parsed)) {
                  structured =
                    parsed.find((x) => x && x["@type"] === "JobPosting") ||
                    parsed[0];
                } else {
                  structured =
                    parsed["@type"] === "JobPosting" ? parsed : parsed;
                }
              }
            } catch {}

            // Extract main content text (fallback)
            let text = $("body").text().replace(/\s+/g, " ").trim();
            if (text.length > 20000) text = text.slice(0, 20000);

            // Attempt to find location and employment type
            const location =
              structured?.jobLocation?.address?.addressLocality ||
              structured?.jobLocation?.address?.addressRegion ||
              structured?.jobLocation?.address?.addressCountry ||
              structured?.jobLocation?.address?.addressLocality ||
              null;

            const employmentType = structured?.employmentType || null;

            // Apply URL
            let applyUrl: string | null = null;
            $("a[href]").each((_, el) => {
              const href = $(el).attr("href") || "";
              const text = $(el).text().toLowerCase();
              if (text.includes("apply") || href.includes("ashby")) {
                applyUrl = href.startsWith("http")
                  ? href
                  : new URL(href, url).toString();
              }
            });

            return {
              url,
              title,
              description,
              location,
              employmentType,
              applyUrl,
              structured,
              text,
            };
          },
        }),
      },
    });
  },
});
