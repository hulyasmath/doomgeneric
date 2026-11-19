/*
 * zeq-ship: put a browser game or simulation on a host that takes one page at a time.
 *
 * Two steps, both plain file work with no machine and no network:
 *
 *   pack    a web build (index.html with its scripts, styles and binary files)
 *           becomes one self-contained page; nothing is fetched from outside it
 *   split   a page too large for the host's upload limit becomes a small loader
 *           page plus N part pages; the loader fetches the parts, checks one
 *           SHA-256 over the whole and only then starts the page
 *
 *   const page = ZeqShip.pack({ dir: "dist", emscripten: "game.js" });
 *   const { loader, parts, sha256 } = ZeqShip.split(page.html, { slug: "game", maxBytes: 225000 });
 *
 *   node zeq-ship.js pack  dist out/index.html --emscripten game.js --shim my-shim.js
 *   node zeq-ship.js split out/index.html out/parts --slug game --max 225000
 *
 * The packed page works under a strict content-security policy: inline scripts
 * and same-origin fetches only, no blob or data URLs, no workers of its own.
 * A build that starts a Worker from a file needs a host shim (--shim) that
 * answers the same messages on the page; see examples/doom/doom-ship.js.
 *
 * No key and no secret belongs in a page. pack and split refuse text that
 * looks like one.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const FORMAT = "zeq-ship-v1";
class ZeqRefusal extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.name = "ZeqRefusal"; this.code = code; this.detail = String(detail); }
}
const refuse = (code, detail) => { throw new ZeqRefusal(code, detail); };
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const SECRET = /(zeq_ak_[0-9a-f]{16,}|zsm_[0-9A-Za-z]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9_\-.]{24,})/;
const noSecret = (text, what) => { const m = SECRET.exec(text); if (m) refuse("secret-in-page", `${what} carries text that looks like a key (${m[0].slice(0, 10)}...); a page is public`); };
/* Inline script text must not close its own element or open an HTML comment. */
const inlineSafe = (js) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const local = (ref) => !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
const clean = (ref) => ref.split(/[?#]/)[0];

function inside(dir, ref) {
  const file = path.resolve(dir, clean(ref));
  if (file !== dir && !file.startsWith(dir + path.sep)) refuse("outside-build", `${ref} leaves the build directory`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) refuse("missing-file", `${ref} is referenced but not in the build`);
  return file;
}

/* The runtime every packed page carries: embedded files by name, and fetch() answered from them. */
const RUNTIME = String.raw`
(function () {
  "use strict";
  var cache = Object.create(null);
  function file(name) {
    if (cache[name]) return cache[name];
    var el = document.querySelector('script[type="application/octet-stream"][data-zeq-file="' + name + '"]');
    if (!el) return null;
    var s = atob(el.textContent.trim()), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return (cache[name] = u);
  }
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var name = typeof input === "string" && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(input) ? input.split(/[?#]/)[0].replace(/^\.\//, "") : null;
    var bytes = name ? file(name) : null;
    if (bytes) return Promise.resolve(new Response(bytes.slice(), { status: 200, headers: { "Content-Type": /\.wasm$/.test(name) ? "application/wasm" : "application/octet-stream" } }));
    return realFetch(input, init);
  };
  window.ZeqShip = Object.freeze({ format: "zeq-ship-v1", file: file });
})();
`;
/* An Emscripten build reads its engine and its preloaded data from the page instead of the network. */
const EMSCRIPTEN = (wasm) => String.raw`
(function () {
  if (typeof Module !== "object" || !Module) return;
  var wasm = ZeqShip.file(${JSON.stringify(wasm)});
  if (wasm) Module.wasmBinary = wasm;
  Module.getPreloadedPackage = function (name) { var d = ZeqShip.file(String(name).split("/").pop()); if (!d) throw new Error("not in this page: " + name); return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength); };
})();
`;

/*
 * pack({ dir, entry = "index.html", binaries, emscripten, shims }) -> { html, sha256, files }
 *   binaries    files to carry as bytes; default: every .wasm and .data beside the entry
 *   emscripten  name of the Emscripten loader script; its engine and data come from the page
 *   shims       host JavaScript (text) placed before the first script, e.g. a worker stand-in
 */
function pack({ dir, entry = "index.html", binaries, emscripten, shims = [] }) {
  if (typeof dir !== "string") refuse("bad-input", "dir: the folder of the web build");
  dir = path.resolve(dir);
  let html = fs.readFileSync(inside(dir, entry), "utf8");
  const files = [];
  html = html.replace(/<link\b([^>]*?)\brel=["']stylesheet["']([^>]*?)>/gi, (tag, a, b) => {
    const m = /\bhref=["']([^"']+)["']/i.exec(a + b);
    if (!m || !local(m[1])) return tag;
    files.push(clean(m[1]));
    return "<style>\n" + fs.readFileSync(inside(dir, m[1]), "utf8").replace(/<\/style/gi, "<\\/style") + "\n</style>";
  });
  let first = true;
  html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
    if (!local(src)) refuse("outside-reference", `${src}: a packed page loads nothing from another origin`);
    const name = clean(src); files.push(name);
    let out = "";
    if (first) { first = false; out += "<!--zeq-ship-binaries-->\n<script>" + inlineSafe(RUNTIME) + "</script>\n" + shims.map((s) => "<script>" + inlineSafe(String(s)) + "</script>\n").join(""); }
    if (emscripten && name === clean(emscripten)) out += "<script>" + inlineSafe(EMSCRIPTEN(name.replace(/\.js$/, ".wasm"))) + "</script>\n";
    const type = /\btype=["']module["']/i.test(a + b) ? ' type="module"' : "";
    return out + `<script${type}>/* ${name} */\n` + inlineSafe(fs.readFileSync(inside(dir, src), "utf8")) + "\n</script>";
  });
  if (first) refuse("no-scripts", "the entry page loads no local script; nothing to pack");
  const carry = binaries || fs.readdirSync(dir).filter((f) => /\.(wasm|data)$/.test(f)).sort();
  const blocks = carry.map((name) => { files.push(name); return `<script type="application/octet-stream" data-zeq-file="${name.replace(/"/g, "")}">` + fs.readFileSync(inside(dir, name)).toString("base64") + "</script>"; }).join("\n");
  html = html.replace("<!--zeq-ship-binaries-->", blocks);
  const left = /<(?:script|link)\b[^>]*\b(?:src|href)=["'](?!data:|#)([^"']+)["']/i.exec(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style>[\s\S]*?<\/style>/gi, ""));
  if (left && /\.(js|css)([?#]|$)/.test(left[1])) refuse("outside-reference", `${left[1]} is still loaded from outside the page`);
  noSecret(html, "the packed page");
  return { format: FORMAT, html, bytes: Buffer.byteLength(html), sha256: sha256(Buffer.from(html)), files };
}

const LOADER = (n, hash, slug, partUrl, title) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>html,body{margin:0;height:100%;background:#090d0b;color:#35e894;font:14px ui-monospace,Menlo,Consolas,monospace}main{height:100%;display:grid;place-content:center;gap:10px;text-align:center}small{color:#8aa197}</style>
</head><body><main><div id="zeq-ship-status">loading</div><small id="zeq-ship-detail">0 / ${n} parts</small></main>
<script>
(async function () {
  "use strict";
  var N = ${n}, SHA = "${hash}", SLUG = ${JSON.stringify(slug)}, URL_ = ${JSON.stringify(partUrl)};
  var s = document.getElementById("zeq-ship-status"), d = document.getElementById("zeq-ship-detail"), failed = false;
  try {
    var done = 0;
    var texts = await Promise.all(Array.from({ length: N }, function (_, i) {
      var n = String(i + 1).padStart(2, "0");
      return fetch(URL_.replace("{slug}", SLUG).replace("{n}", n)).then(function (r) { if (!r.ok) throw new Error("part " + n + " answered " + r.status); return r.text(); })
        .then(function (t) { var m = /data-zeq-part="[0-9]+">([A-Za-z0-9+\\/=]+)</.exec(t); if (!m) throw new Error("part " + n + " carries no data"); done++; if (!failed) d.textContent = done + " / " + N + " parts"; return m[1]; });
    }));
    var bin = atob(texts.join("")), gz = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    var h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", gz))).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    if (h !== SHA) throw new Error("the assembled page does not match its hash");
    s.textContent = "starting";
    var html = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    /* the page replaces this loader only after the hash over all parts has matched */
    document.open(); document.write(html); document.close();
  } catch (e) { failed = true; s.textContent = "did not load"; d.textContent = String(e.message || e); }
})();
</script>
</body></html>
`;

/*
 * split(html, { slug, maxBytes = 225000, partUrl = "../{slug}-part-{n}/", title }) -> { loader, parts, sha256 }
 *   parts[i] = { slug: "<slug>-part-NN", html }   each page at most maxBytes
 *   loader   = the page to publish at <slug>; it fetches every part from partUrl
 */
function split(html, { slug, maxBytes = 225000, partUrl = "../{slug}-part-{n}/", title } = {}) {
  if (typeof html !== "string" || !html.length) refuse("bad-input", "html: the page to split");
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(slug))) refuse("bad-slug", "slug: a-z, 0-9 and hyphens");
  if (!Number.isInteger(maxBytes) || maxBytes < 4096) refuse("bad-limit", "maxBytes: an integer of at least 4096");
  noSecret(html, "the page");
  const gz = zlib.gzipSync(Buffer.from(html), { level: 9 });
  const b64 = gz.toString("base64");
  const frame = (i, n, body) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${slug} data ${i}/${n}</title></head>\n<body><p>Part ${i} of ${n} of <a href="../${slug}/">${slug}</a>.</p>\n<script type="application/octet-stream" data-zeq-part="${i}">${body}</script>\n</body></html>\n`;
  const room = maxBytes - Buffer.byteLength(frame(99, 99, ""));
  const count = Math.ceil(b64.length / room);
  if (count > 99) refuse("too-large", `${count} parts; raise maxBytes or shrink the build`);
  const parts = [];
  for (let i = 0; i < count; i++) parts.push({ slug: `${slug}-part-${String(i + 1).padStart(2, "0")}`, html: frame(i + 1, count, b64.slice(i * room, (i + 1) * room)) });
  const hash = sha256(gz);
  return { format: FORMAT, loader: LOADER(count, hash, slug, partUrl, title || slug), parts, sha256: hash, compressedBytes: gz.length };
}

const api = Object.freeze({ format: FORMAT, ZeqRefusal, pack, split });
module.exports = api;

if (require.main === module) {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  const opt = (name) => { const i = rest.indexOf("--" + name); return i < 0 ? undefined : rest[i + 1]; };
  const all = (name) => rest.map((v, i) => (v === "--" + name ? rest[i + 1] : null)).filter(Boolean);
  try {
    if (cmd === "pack" && a && b) {
      const p = pack({ dir: a, entry: opt("entry") || "index.html", emscripten: opt("emscripten"), shims: all("shim").map((f) => fs.readFileSync(f, "utf8")) });
      fs.mkdirSync(path.dirname(path.resolve(b)), { recursive: true }); fs.writeFileSync(b, p.html);
      console.log(JSON.stringify({ wrote: b, bytes: p.bytes, sha256: p.sha256, files: p.files.length }));
    } else if (cmd === "split" && a && b) {
      const s = split(fs.readFileSync(a, "utf8"), { slug: opt("slug"), maxBytes: opt("max") ? Number(opt("max")) : undefined, partUrl: opt("part-url"), title: opt("title") });
      fs.mkdirSync(b, { recursive: true });
      fs.writeFileSync(path.join(b, `${opt("slug")}.html`), s.loader);
      for (const p of s.parts) fs.writeFileSync(path.join(b, `${p.slug}.html`), p.html);
      console.log(JSON.stringify({ wrote: b, parts: s.parts.length, sha256: s.sha256, compressedBytes: s.compressedBytes }));
    } else { console.error("usage: zeq-ship.js pack <build-dir> <out.html> [--entry f] [--emscripten loader.js] [--shim file]...\n       zeq-ship.js split <page.html> <out-dir> --slug name [--max bytes] [--part-url template] [--title t]"); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
