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

const bundlePath = join(outDir, "app.js");
const bundleFile = Bun.file(bundlePath);
if (!(await bundleFile.exists())) {
    console.error(`Bundled script not found at ${bundlePath}`);
    process.exit(1);
}

const bundledScript = await bundleFile.text();
const escapedScript = bundledScript.replace(/<\/script>/g, "<\\/script>");
const scriptPattern = /<script([^>]*?)\bsrc=["'][^"']*app\.(?:ts|js)["']([^>]*)>\s*<\/script>/i;

const finalHtml = html.replace(scriptPattern, (match, preAttrs = "", postAttrs = "") => {
    const attributeSource = `${preAttrs}${postAttrs}`;
    const withoutSrc = attributeSource.replace(/\s*src\s*=\s*["'][^"']*["']/i, "");
    const normalizedAttrs = withoutSrc.replace(/\s+/g, " ").trim();
    const attributeSuffix = normalizedAttrs ? ` ${normalizedAttrs}` : "";
    return `<script${attributeSuffix}>\n${escapedScript}\n</script>`;
});

if (finalHtml === html) {
    console.warn("No <script> tag referencing app.ts or app.js found in index.html; script not inlined");
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "index.html"), finalHtml);

if (finalHtml !== html) {
    await rm(bundlePath, { force: true });
}
