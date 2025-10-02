import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outDir = "dist";

await rm(outDir, { recursive: true, force: true });

const result = await Bun.build({
    entrypoints: ["./app.ts"],
    outdir: outDir,
    target: "browser",
    minify: true,
});

if (!result.success) {
    for (const log of result.logs) {
        console.error(log.message);
    }
    process.exit(1);
}

const indexSource = Bun.file("index.html");
if (!(await indexSource.exists())) {
    console.error("index.html not found at project root");
    process.exit(1);
}

const html = await indexSource.text();
const rewrittenHtml = html.replace(/src=["'][.\\/]*app\.ts["']/g, 'src="./app.js"');

if (rewrittenHtml === html) {
    console.warn("No <script> tag referencing app.ts found in index.html; written file unchanged");
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "index.html"), rewrittenHtml);
