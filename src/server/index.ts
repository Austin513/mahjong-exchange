// Entry point. `npm run dev` serves the client through Vite middleware (HMR);
// `npm start` serves the production build from dist/client.

import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app";

const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT ?? 5175);
const host = process.env.HOST ?? "0.0.0.0";
const allowSeededRooms = dev || process.env.ALLOW_SEEDED_ROOMS === "1";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

async function main() {
  let fallback: (req: IncomingMessage, res: ServerResponse) => void;
  if (dev) {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa", configFile: resolve("vite.config.ts") });
    fallback = (req, res) => vite.middlewares(req, res);
  } else {
    const root = resolve("dist/client");
    if (!existsSync(join(root, "index.html"))) {
      console.error("dist/client is missing. Run `npm run build` first.");
      process.exit(1);
    }
    fallback = (req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      let file = normalize(join(root, urlPath));
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      });
      createReadStream(file).pipe(res);
    };
  }
  const { server } = createApp({ allowSeededRooms, fallback });
  server.listen(port, host, () => {
    console.log(`Mahjong Exchange ${dev ? "(dev)" : ""} listening on http://localhost:${port}`);
    if (allowSeededRooms) console.log("Seeded fixture rooms are enabled.");
  });
}

void main();
