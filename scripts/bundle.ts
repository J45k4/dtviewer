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

let finalHtml = html.replace(scriptPattern, (match, preAttrs = "", postAttrs = "") => {
    const attributeSource = `${preAttrs}${postAttrs}`;
    const withoutSrc = attributeSource.replace(/\s*src\s*=\s*["'][^"']*["']/i, "");
    const normalizedAttrs = withoutSrc.replace(/\s+/g, " ").trim();
    const attributeSuffix = normalizedAttrs ? ` ${normalizedAttrs}` : "";
    return `<script${attributeSuffix}>\n${escapedScript}\n</script>`;
});

if (finalHtml === html) {
    console.warn("No <script> tag referencing app.ts or app.js found in index.html; script not inlined");
}

const faviconSource = Bun.file("favicon.ico");
if (await faviconSource.exists()) {
    const arrayBuffer = await faviconSource.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:image/x-icon;base64,${base64}`;
    const faviconPattern = /<link[^>]*\brel=["']icon["'][^>]*>/i;

    if (faviconPattern.test(finalHtml)) {
        finalHtml = finalHtml.replace(faviconPattern, (match) => {
            if (/href=/i.test(match)) {
                return match.replace(/href\s*=\s*["'][^"']*["']/i, `href="${dataUrl}"`);
            }
            return match.replace(/>$/, ` href="${dataUrl}">`);
        });
    } else {
        finalHtml = finalHtml.replace(
            /<head[^>]*>/i,
            (headTag) => `${headTag}\n        <link rel="icon" href="${dataUrl}">`
        );
    }
} else {
    console.warn("favicon.ico not found; leaving favicon link unchanged");
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "index.html"), finalHtml);

if (finalHtml !== html) {
    await rm(bundlePath, { force: true });
}
