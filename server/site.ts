import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { product } from "../src/config/product.ts";

const mime: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function registerClassroomSite(app: FastifyInstance, directory: string) {
  const root = resolve(directory);
  const shell = await readFile(resolve(root, "classroom.html"));
  const pageHeaders = {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
  for (const route of ["/classroom", "/classroom/", "/join", "/join/"]) {
    app.get(route, async (_request, reply) =>
      reply.headers(pageHeaders).type("text/html; charset=utf-8").send(shell),
    );
  }
  app.get("/", async (_request, reply) => reply.redirect("/classroom"));
  app.get("/app", async (_request, reply) => reply.redirect(product.siteUrl + "/app"));
  app.get("/robots.txt", async (_request, reply) =>
    reply.type("text/plain; charset=utf-8").send("User-agent: *\nDisallow: /\n"),
  );
  async function asset(file: string, reply: FastifyReply, cacheControl: string) {
    let bytes: Buffer;
    try {
      bytes = await readFile(resolve(root, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply.callNotFound();
      throw error;
    }
    return reply.headers({ "X-Content-Type-Options": "nosniff", "Cache-Control": cacheControl })
      .type(mime[extname(file)]).send(bytes);
  }
  app.get("/mark.svg", async (_request, reply) => asset("mark.svg", reply, "public, max-age=3600"));
  for (const folder of ["assets", "fonts"]) {
    app.get<{ Params: { file: string } }>("/" + folder + "/:file", async (request, reply) => {
      const name = request.params.file;
      if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|mjs|css|woff2?|ttf|svg|png|webp)$/.test(name))
        return reply.callNotFound();
      return asset(folder + "/" + name, reply,
        folder === "assets" ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    });
  }
}
