import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { verifySessionToken } from "./session";
import { getDb } from "../db";
import { articles, articleNodes } from "../../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "../../shared/const";
import { scheduledPublishHandler } from "../scheduledPublishHandler";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // ── ZIP export REST endpoint ──────────────────────────────────────────────
  // GET /api/articles/export-zip?businessId=<id>
  // Returns a ZIP file containing HTML, Markdown, meta .txt, schema JSON-LD,
  // and a schedule CSV for all approved articles.
  app.get("/api/articles/export-zip", async (req, res) => {
    try {
      // Auth: verify session cookie (same approach as context.ts)
      const cookieHeader = req.headers["cookie"] ?? "";
      const cookies = parseCookieHeader(cookieHeader);
      const token = cookies[COOKIE_NAME] ?? req.headers["authorization"]?.replace("Bearer ", "");
      if (!token) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const sessionPayload = await verifySessionToken(token as string);
      if (!sessionPayload) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const businessId = parseInt(req.query.businessId as string);
      if (!businessId || isNaN(businessId)) {
        res.status(400).json({ error: "businessId required" });
        return;
      }
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }
      // Fetch approved articles
      const rows = await db
        .select({
          id: articles.id,
          title: articles.title,
          bodyHtml: articles.bodyHtml,
          bodyMarkdown: articles.bodyMarkdown,
          metaTitle: articles.metaTitle,
          metaDescription: articles.metaDescription,
          focusKeyword: articles.focusKeyword,
          urlSlug: articles.urlSlug,
          schemaMarkup: articles.schemaMarkup,
          wordCount: articles.wordCount,
          statusBadge: articles.statusBadge,
          scheduledPublishAt: articles.scheduledPublishAt,
          level: articleNodes.level,
        })
        .from(articles)
        .innerJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
        .where(
          and(
            eq(articles.businessId, businessId),
            inArray(articles.status, ["approved", "scheduled", "published"])
          )
        )
        .orderBy(articleNodes.sortOrder);
      if (rows.length === 0) {
        res.status(400).json({ error: "No approved articles found." });
        return;
      }
      // Build ZIP using archiver
      const { default: archiverFn } = await import("archiver");
      const archive = archiverFn("zip", { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      const zipReady = new Promise<Buffer>((resolve, reject) => {
        archive.on("end", () => resolve(Buffer.concat(chunks)));
        archive.on("error", reject);
      });
      // Schedule CSV header
      let scheduleCsv = "title,url_slug,level,status_badge,scheduled_publish_at\n";
      for (const row of rows) {
        const slug = row.urlSlug ?? `article-${row.id}`;
        const htmlContent = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>${row.metaTitle ?? row.title ?? ""}</title>\n<meta name="description" content="${row.metaDescription ?? ""}">\n${row.schemaMarkup ? `<script type="application/ld+json">${row.schemaMarkup}</script>` : ""}\n</head>\n<body>\n${row.bodyHtml ?? ""}\n</body>\n</html>`;
        archive.append(htmlContent, { name: `articles/${slug}.html` });
        archive.append(row.bodyMarkdown ?? "", { name: `articles/${slug}.md` });
        const metaTxt = [
          `Title: ${row.title ?? ""}`,
          `Meta Title: ${row.metaTitle ?? ""}`,
          `Meta Description: ${row.metaDescription ?? ""}`,
          `Focus Keyword: ${row.focusKeyword ?? ""}`,
          `URL Slug: ${slug}`,
          `Word Count: ${row.wordCount ?? ""}`,
          `Status: ${row.statusBadge ?? ""}`,
          `Level: ${row.level ?? ""}`,
          `Scheduled: ${row.scheduledPublishAt ? new Date(row.scheduledPublishAt).toISOString() : "Not scheduled"}`,
        ].join("\n");
        archive.append(metaTxt, { name: `articles/${slug}-meta.txt` });
        if (row.schemaMarkup) {
          archive.append(row.schemaMarkup, { name: `articles/${slug}-schema.json` });
        }
        const csvTitle = `"${(row.title ?? "").replace(/"/g, '""')}"`;
        scheduleCsv += `${csvTitle},${slug},${row.level ?? ""},${row.statusBadge ?? ""},${row.scheduledPublishAt ? new Date(row.scheduledPublishAt).toISOString() : ""}\n`;
      }
      archive.append(scheduleCsv, { name: "schedule.csv" });
      archive.finalize();
      const zipBuffer = await zipReady;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="blog-batcher-export.zip"`);
      res.send(zipBuffer);
    } catch (err) {
      console.error("[ZIP Export] Error:", err);
      res.status(500).json({ error: "Export failed" });
    }
  });

  // ── Layer 9: Scheduled publish heartbeat callback ────────────────────────
  // MUST be registered BEFORE tRPC middleware — /api/scheduled/* is not auto-registered.
  // The Manus platform POSTs here when a scheduled publish job fires.
  app.post("/api/scheduled/publish-article", scheduledPublishHandler);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
