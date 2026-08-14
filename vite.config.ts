import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

interface EnsureTheaterRequest {
  readonly id: string;
  readonly name: string;
  readonly longitudeE6: number;
  readonly latitudeE6: number;
}

function readRequestBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function assertEnsureRequest(value: unknown): asserts value is EnsureTheaterRequest {
  const request = value as Partial<EnsureTheaterRequest> | null;
  if (
    !request ||
    !/^world-r\d+-c\d+$/.test(request.id ?? "") ||
    typeof request.name !== "string" ||
    request.name.length < 1 ||
    request.name.length > 80 ||
    !Number.isInteger(request.longitudeE6) ||
    Math.abs(request.longitudeE6!) > 180_000_000 ||
    !Number.isInteger(request.latitudeE6) ||
    Math.abs(request.latitudeE6!) > 90_000_000
  ) {
    throw new Error("Invalid Regional Theater compiler request");
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function theaterCompilerPlugin(): Plugin {
  const pending = new Map<string, Promise<void>>();
  const projectRoot = resolve(process.cwd());

  const isCurrentManifest = (manifest: string): boolean => {
    if (!existsSync(manifest)) {
      return false;
    }
    try {
      const value = JSON.parse(readFileSync(manifest, "utf8")) as {
        readonly formatVersion?: unknown;
        readonly extent?: { readonly widthMeters?: unknown };
        readonly render?: { readonly width?: unknown };
        readonly semantic?: {
          readonly chunkEncoding?: unknown;
          readonly moistureModelVersion?: unknown;
        };
        readonly hydrographySource?: {
          readonly snapshot?: unknown;
          readonly normalizedHash?: unknown;
          readonly normalizerVersion?: unknown;
        };
      };
      return (
        value.formatVersion === 14 &&
        value.extent?.widthMeters === 768_000 &&
        value.render?.width === 8_192 &&
        value.semantic?.chunkEncoding ===
          "terrain-u8-vegetation-u8-moisture-u8-elevation-i16le-v2" &&
        value.semantic.moistureModelVersion === 1 &&
        typeof value.hydrographySource?.snapshot === "string" &&
        typeof value.hydrographySource?.normalizedHash === "string" &&
        value.hydrographySource.normalizerVersion === 5
      );
    } catch {
      return false;
    }
  };

  const compile = (request: EnsureTheaterRequest): Promise<void> => {
    const output = join(projectRoot, "public", "maps", "theaters", request.id);
    const manifest = join(output, "manifest.json");
    const compilerRoot = join(projectRoot, "tools", "map-preprocess");
    const compilerScript = join(compilerRoot, "build_regional_theater.py");
    const compilerPython =
      process.env.MAP_COMPILER_PYTHON ??
      join(projectRoot, ".cache", "map-tools", "Scripts", "python.exe");
    if (isCurrentManifest(manifest)) {
      return Promise.resolve();
    }
    const existing = pending.get(request.id);
    if (existing) {
      return existing;
    }
    const promise = new Promise<void>((resolveCompile, reject) => {
      const child = spawn(
        compilerPython,
        [
          compilerScript,
          "--id",
          request.id,
          "--name",
          request.name,
          "--center-longitude",
          String(request.longitudeE6 / 1_000_000),
          "--center-latitude",
          String(request.latitudeE6 / 1_000_000),
          "--output",
          output,
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            PYTHONNOUSERSITE: "1",
          },
          windowsHide: true,
        },
      );
      let errors = "";
      child.stderr.on("data", (chunk: Buffer) => {
        errors += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0 && existsSync(manifest)) {
          resolveCompile();
        } else {
          reject(new Error(errors.trim() || `Theater compiler exited with code ${code}`));
        }
      });
    }).finally(() => pending.delete(request.id));
    pending.set(request.id, promise);
    return promise;
  };

  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): Promise<void> => {
    if (request.url !== "/api/theaters/ensure") {
      next();
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readRequestBody(request);
      assertEnsureRequest(body);
      const manifestPath = `/maps/theaters/${body.id}/manifest.json`;
      const cached = isCurrentManifest(
        join(
          projectRoot,
          "public",
          "maps",
          "theaters",
          body.id,
          "manifest.json",
        ),
      );
      await compile(body);
      sendJson(response, 200, { manifestPath, cached });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unable to compile Theater",
      });
    }
  };

  return {
    name: "regional-theater-compiler",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [theaterCompilerPlugin()],
  build: {
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
  },
  test: {
    fileParallelism: false,
  },
});
