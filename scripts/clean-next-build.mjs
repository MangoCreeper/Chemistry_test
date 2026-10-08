import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const buildDirectory = path.resolve(projectRoot, ".next");
if (path.relative(projectRoot, buildDirectory) !== ".next") {
  throw new Error("Next.js build output must stay inside the project directory.");
}
await rm(buildDirectory, { recursive: true, force: true });
console.log("Cleared generated Next.js output before a fresh Netlify build.");
