import { convertToModelMessages, streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import { load } from "cheerio";

export default blink.agent({
  async sendMessages({ messages }) {
    return streamText({
      model: "openai/gpt-oss-120b",
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
            if (!m) throw new Error("Ashby inline appData not found");
            const appData = JSON.parse(m[1]);

            const postings = appData?.jobPostingList?.jobPostings ?? [];
            const jobs = postings.map((p: any) => ({
              id: p.id,
              title: p.title,
              department: p.departmentName ?? null,
              team: p.teamName ?? null,
              location: p.locationName ?? null,
              workplaceType: p.workplaceType ?? null,
              employmentType: p.employmentType ?? null,
              isListed: p.isListed ?? null,
              publishedDate: p.publishedDate ?? null,
              compensationTierSummary: p.shouldDisplayCompensationOnJobBoard
                ? (p.compensationTierSummary ?? null)
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
            if (!appDataMatch)
              throw new Error("Ashby inline appData not found on job page");
            const appData = JSON.parse(appDataMatch[1]);

            const jobId = (() => {
              try {
                const u = new URL(url);
                const parts = u.pathname.split("/").filter(Boolean);
                return parts[parts.length - 1] ?? null;
              } catch {
                return null;
              }
            })();

            const deepFind = (
              node: any,
              fn: (v: any, k?: string) => boolean,
            ): any => {
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

            const posting = deepFind(
              appData,
              (v, k) =>
                v &&
                typeof v === "object" &&
                (v as any).posting &&
                typeof (v as any).posting.title === "string",
            )?.posting;

            const ldjsonMatch = html.match(
              /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
            );
            let ldjson: any = undefined;
            if (ldjsonMatch) {
              try {
                const parsed = JSON.parse(ldjsonMatch[1]);
                ldjson = Array.isArray(parsed)
                  ? parsed.find((x) => x?.["@type"] === "JobPosting")
                  : parsed?.["@type"] === "JobPosting"
                    ? parsed
                    : undefined;
              } catch {}
            }

            const base = (posting ?? jobPosting ?? {}) as any;

            const title = base.title || ldjson?.title || "";
            const descriptionHtml =
              base.descriptionHtml || ldjson?.description || "";
            const department = base.departmentName ?? null;
            const team = base.teamName ?? null;
            const location = base.locationName ?? null;
            const employmentType =
              base.employmentType ?? ldjson?.employmentType ?? null;
            const publishedDate =
              base.publishedDate ?? ldjson?.datePosted ?? null;
            const compensationTierSummary =
              base.compensationTierSummary ?? null;

            // Build apply URL: first try anchor tags, then guess from job URL
            let applyUrl: string | null = null;
            const anchorMatch = html.match(
              /<a[^>]+href=["']([^"']+)["'][^>]*>(?:[^<]*apply[^<]*|[^<]*Apply[^<]*)<\/a>/i,
            );
            if (anchorMatch) {
              try {
                const abs = anchorMatch[1];
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
      },
    });
  },
});
