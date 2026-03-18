import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { initSentry, captureError } from "./sentry.js";
import { projects } from "./routes/projects";
import { ai } from "./routes/ai";
import { exportRoute } from "./routes/export";
import { math } from "./routes/math";
import { simulation } from "./routes/simulation";
import { library } from "./routes/library";
import { shareLinks, shareResolve, comments } from "./routes/collaboration";
import { dashboard } from "./routes/dashboard";

initSentry();

const app = new Hono();

app.use("/*", cors());

// Global error handler — report to Sentry
app.onError((err, c) => {
  captureError(err instanceof Error ? err : new Error(String(err)));
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/projects", projects);
app.route("/api/ai", ai);
app.route("/api/export", exportRoute);
app.route("/api/math", math);
app.route("/api/simulation", simulation);
app.route("/api/library", library);
app.route("/api/dashboard", dashboard);
app.route("/api/projects", shareLinks);
app.route("/api/projects", comments);
app.route("/api/share", shareResolve);

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 3001;
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Backend running on http://localhost:${port}`);
  });
}

export default app;
