#!/usr/bin/env python3
"""Build the self-contained, on-site SDK manual from identified Markdown sources."""
import argparse
import html
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOCS = [
    ("start", "Start", [
        ("developer-manual", "Developer manual", "docs/zeq-developer-manual-v1.md"),
        ("integration", "Third-party integration", "docs/zeq-sdk-integration-v1.md"),
        ("module-handbook", "Module handbook", "sdk/README.md"),
    ]),
    ("api", "API + protocols", [
        ("portable-profiles", "Portable API profiles", "docs/zeq-portable-profiles-v1.md"),
        ("support-matrix", "Conformance + support", "docs/zeq-conformance-matrix-v1.md"),
        ("wire-protocol", "Doom wire + state protocol", "docs/zeq-doomgeneric-protocol-v1.md"),
    ]),
    ("operations", "Operate + release", [
        ("release-evidence", "Release evidence", "docs/zeq-release-evidence-v1.md"),
        ("final-audit", "Final audit + limitations", "docs/zeq-final-audit-v1.md"),
        ("roadmap", "Consolidated roadmap", "docs/zeq-roadmap-v1.md"),
    ]),
    ("projects", "Tested reference projects", [
        ("project-01", "01 · Roblox competitive", "projects/01-roblox-competitive-modes/README.md"),
        ("project-02", "02 · Minecraft servers", "projects/02-minecraft-technical-servers/README.md"),
        ("project-03", "03 · Unity multiplayer", "projects/03-unity-multiplayer/README.md"),
        ("project-04", "04 · Unreal multiplayer", "projects/04-unreal-multiplayer/README.md"),
        ("project-05", "05 · Godot multiplayer", "projects/05-godot-multiplayer/README.md"),
        ("project-06", "06 · Racing + ghosts", "projects/06-racing-ghost-integrity/README.md"),
        ("project-07", "07 · Fighting rollback", "projects/07-fighting-platform-fighters/README.md"),
        ("project-08", "08 · RTS lockstep", "projects/08-rts-moba-servers/README.md"),
        ("project-09", "09 · Coupled digital twins", "projects/09-simulation-digital-twins/README.md"),
        ("project-10", "10 · Exact order book", "projects/10-financial-trading-simulation/README.md"),
        ("project-11", "11 · Versioned design steps", "projects/11-collaborative-cad-engineering/README.md"),
        ("project-12", "12 · Sample-accurate audio", "projects/12-audio-daw-plugins/README.md"),
        ("project-13", "13 · Reproducible particle caches", "projects/13-video-vfx-caches/README.md"),
        ("project-16", "16 · Replay receipts", "projects/16-generic-replay-anticheat/README.md"),
        ("project-index", "20-project programme", "projects/README.md"),
    ]),
]
MODULES = [
    ("zeq_time.c/.h/.py", "zeq-time-v1", "Exact host tick/Zeqond conversion, Q64 phase, lapse and checked rounding", "sdk/zeq_time.h", "sdk/tests/test_time.c"),
    ("zeq_physics.c/.h/.py", "zeq-physics-v1", "Doom-unit midpoint integration, finite impulses and exact cooldowns", "sdk/zeq_physics.h", "sdk/tests/test_physics.c"),
    ("zeq-game-sdk.js", "ZeqSDK", "JavaScript exact time/physics, legacy carrier, ledger and optional sidecar bridge", "sdk/zeq-game-sdk.js", "sdk/tests/test_time.js"),
    ("zeq-security.js", "ZeqSecurity", "Canonical signed records, proof creation, verification and explicit trust", "sdk/zeq-security.js", "sdk/tests/test_security.js"),
    ("zeq-capsule.js", "ZeqCapsule", "ZEQC3 PIN-derived encrypted local save capsules", "sdk/zeq-capsule.js", "sdk/tests/test_browser.js"),
    ("zeq-content.js", "ZeqContent", "Signed manifests, bounded PK3, publisher trust and sealed parcels", "sdk/zeq-content.js", "sdk/tests/test_content.js"),
    ("zeq-net.js", "ZeqNet", "Canonical session descriptors and deterministic test-link impairment; not transport", "sdk/zeq-net.js", "sdk/tests/test_net.js"),
    ("zeq-quantities.js", "ZeqQuantities", "Exact bounded rational units, dimensions, equations and uncertainty", "sdk/zeq-quantities.js", "sdk/tests/test_quantities.js"),
    ("zeq-numerics.js", "ZeqNumerics", "Budgeted scientific Float64 diagnostics; non-authoritative", "sdk/zeq-numerics.js", "sdk/tests/test_numerics.js"),
    ("zeq-experiments.js", "ZeqExperiments", "Scenarios, sweeps, bounded conditions and actual reproduction", "sdk/zeq-experiments.js", "sdk/tests/test_experiments.js"),
    ("zeq-lifecycle.js", "ZeqLifecycle", "Signed ownership/lifecycle and default-deny scoped host methods", "sdk/zeq-lifecycle.js", "sdk/tests/test_lifecycle.js"),
    ("zeq-bot.js", "ZeqBot", "Deterministic outer command scheduler while the host owns its tick", "sdk/zeq-bot.js", "sdk/tests/test_bot.js"),
    ("zeq-replay.js / zeq-mcp.js", "Node.js adapters", "Real Doom headless replay and opt-in local process/input control", "sdk/zeq-replay.js", "sdk/tests/test_mcp.js"),
    ("zeq-kernel.js", "Optional sidecar", "Local signed sessions, append-only records and offline verification", "sdk/zeq-kernel.js", "sdk/tests/test_sidecar.js"),
    ("zeq_pixel.c/.h / zeq-pixel.js", "zeq-pixel-v1", "Deterministic opaque raster, rational projection and canonical bytes", "sdk/zeq_pixel.h", "sdk/tests/test_pixel.js"),
    ("zeq_texture.c/.h", "zeq-texture-validation-v1", "Structural resource validation only; not content authorization", "sdk/zeq_texture.h", "sdk/tests/test_texture.js"),
    ("reference/zeq-chamber.*", "zeq-chamber-v1", "Non-Doom C99/JavaScript/Python canonical replay host", "sdk/reference/zeq_chamber.h", "sdk/tests/test_chamber.js"),
    ("zq/zeq-host.js", "zeq-host-v1", "Ordered non-authoritative event-to-contract observation", "sdk/zq/zeq-host.js", "sdk/zq/tests/test_doom.js"),
    ("zq/zeq-browser.js", "zeq-browser-v1", "Owner-configured scoped HTTP(S) contract-machine client", "sdk/zq/zeq-browser.js", "sdk/zq/tests/test_doom.js"),
]


def render_markdown(path):
    result = subprocess.run([
        "pandoc", "--from=gfm", "--to=html5", "--wrap=none", str(path)
    ], check=True, capture_output=True, text=True)
    return result.stdout


def build(sdk_root):
    articles = []
    search = []
    nav = []
    for group_id, group_name, entries in DOCS:
        links = []
        for doc_id, title, relative in entries:
            path = sdk_root / relative
            # Doom-host protocol documentation belongs to the reference-host tree,
            # not the SDK-only distribution; all other manuals come from SDK root.
            if relative == "docs/zeq-doomgeneric-protocol-v1.md":
                path = ROOT / relative
            if not path.is_file():
                raise FileNotFoundError(path)
            body = render_markdown(path)
            # Repository-relative documentation links become local portal routes.
            def route_link(match):
                url = html.unescape(match.group(1))
                if url.startswith(("http://", "https://", "mailto:")):
                    return match.group(0)
                parts = url.split("#", 1)
                clean = parts[0].split("/")[-1]
                anchor = parts[1] if len(parts) == 2 else ""
                for _, _, candidates in DOCS:
                    for candidate_id, _, candidate_path in candidates:
                        if Path(candidate_path).name == clean:
                            suffix = f"/{candidate_id}--{anchor}" if anchor else ""
                            return f'href="#{candidate_id}{suffix}"'
                if not clean and anchor:
                    return f'href="#{doc_id}/{doc_id}--{anchor}"'
                if url.endswith(".md"):
                    return f'href="{html.escape(url, quote=True)}"'
                return match.group(0)
            body = re.sub(r'href="([^"]+)"', route_link, body)
            # Wide Markdown tables scroll inside their own container on narrow screens.
            body = re.sub(r'(<table(?:\s[^>]*)?>.*?</table>)', r'<div class="table-wrap">\1</div>', body, flags=re.DOTALL)
            # Prefix generated heading IDs so independently rendered manuals remain valid HTML.
            body = re.sub(r'id="([^"]+)"', lambda m: f'id="{doc_id}--{m.group(1)}"', body)
            # Repository source links resolve to the same-origin SDK release tree.
            body = re.sub(r'href="(?:\.\./)?(?:sdk|projects)/([^"#]+)"', r'href="projects/\1"' if relative.startswith("projects/") else r'href="sdk/\1"', body)
            articles.append(f'<article class="doc" id="doc-{doc_id}" data-doc="{doc_id}" hidden><div class="doc-source">{html.escape(relative)}</div>{body}</article>')
            text = re.sub(r"<[^>]+>", " ", body)
            search.append({"id": doc_id, "title": title, "text": html.unescape(re.sub(r"\s+", " ", text)).lower()})
            links.append(f'<a class="nav-doc" href="#{doc_id}" data-doc-link="{doc_id}">{html.escape(title)}</a>')
        nav.append(f'<section class="nav-group" data-group="{group_id}"><h2>{html.escape(group_name)}</h2>{"".join(links)}</section>')

    module_rows = "".join(
        f'<tr><td><a href="{html.escape(source)}" target="_blank" rel="noopener"><code>{html.escape(name)}</code></a></td><td><code>{html.escape(profile)}</code></td><td>{html.escape(role)}</td><td><a href="{html.escape(test)}" target="_blank" rel="noopener">conformance source</a></td></tr>'
        for name, profile, role, source, test in MODULES
    )
    source_files = []
    for base in (sdk_root / "sdk", sdk_root / "projects"):
        for path in sorted(base.rglob("*")):
            if not path.is_file() or any(part in {".git", "__pycache__", "node_modules", "build"} for part in path.parts):
                continue
            if path.suffix in {".pyc", ".o", ".out", ".wasm", ".png", ".jpg", ".zip"}:
                continue
            source_files.append(path.relative_to(sdk_root).as_posix())
    source_links = "".join(f'<a class="source-file" href="{html.escape(path)}" target="_blank" rel="noopener"><code>{html.escape(path)}</code><span>VIEW SOURCE</span></a>' for path in source_files)
    articles.append(f'''<article class="doc" id="doc-source" data-doc="source" hidden><div class="doc-source">same-origin source release</div><h1>Source + test browser</h1><p>Every portable SDK source, public vector, test, and completed reference-project file below is served by this website. These links open local files, not GitHub pages.</p><div class="source-grid">{source_links}</div></article>''')
    search.append({"id": "source", "title": "Source + test browser", "text": " ".join(source_files).lower()})
    nav.append(f'<section class="nav-group" data-group="source"><h2>Source release</h2><a class="nav-doc" href="#source" data-doc-link="source">Source + test browser</a></section>')

    overview = f'''<article class="doc overview" id="doc-overview" data-doc="overview"><div class="hero"><span class="kicker">ZEQ GAMES SDK · DEVELOPER EDITION</span><h1>Deterministic systems.<br><em>Documented end to end.</em></h1><p>Integrate exact time, replayable state, signed evidence, encrypted saves, verified content, and reproducible experiments around your existing authoritative engine.</p><div class="hero-actions"><a class="primary" href="#developer-manual">START INTEGRATING</a><a class="secondary" href="#source">BROWSE SOURCE + TESTS</a></div></div><div class="metric-row"><div><strong>19</strong><span>MODULE SURFACES</span></div><div><strong>14</strong><span>TESTED PROJECT LANES</span></div><div><strong>0</strong><span>NPM RUNTIME DEPENDENCIES</span></div><div><strong>100%</strong><span>DOCUMENTATION ON THIS SITE</span></div></div><section class="overview-section"><span class="kicker">A COMPLETE ADOPTION PATH</span><h2>From first tick to controlled release.</h2><div class="path-grid"><a href="#developer-manual"><b>01</b><h3>Baseline the host</h3><p>Identify the real tick, complete commands, one-step transition, canonical state, and immutable run identity.</p></a><a href="#integration"><b>02</b><h3>Integrate exactly</h3><p>Adopt versioned arithmetic without replacing your engine, renderer, game loop, or existing mechanics.</p></a><a href="#portable-profiles"><b>03</b><h3>Prove the boundary</h3><p>Run shared vectors, actual replay, altered-input, tamper, truncation, and resource-limit gates.</p></a><a href="#release-evidence"><b>04</b><h3>Package honestly</h3><p>Bind source and artifact identities, state support limits, migrate explicitly, and verify delivery.</p></a></div></section><section class="overview-section"><span class="kicker">QUICK API MAP</span><h2>Use only what your product needs.</h2><div class="table-wrap"><table><thead><tr><th>Module</th><th>Profile / global</th><th>Purpose and boundary</th><th>Evidence</th></tr></thead><tbody>{module_rows}</tbody></table></div></section><section class="production-note"><span class="kicker">PRODUCTION CLAIM BOUNDARY</span><h2>Specific evidence. Specific environments.</h2><p>The portable modules and reference lanes have substantial local conformance evidence. That does not certify arbitrary third-party engines, physical devices, hostile networks, competitive legitimacy, physical accuracy, or an uncompromised host. Use the production gate in the developer manual and qualify readiness by product, host, profile, runtime, and release.</p><a href="#developer-manual/developer-manual--17-production-release-gate">READ THE PRODUCTION RELEASE GATE →</a></section></article>'''
    articles.insert(0, overview)
    search.insert(0, {"id": "overview", "title": "SDK documentation home", "text": "installation integration modules production release exact time replay security saves content networking"})

    template = TEMPLATE
    replacements = {
        "__NAV__": "".join(nav),
        "__ARTICLES__": "".join(articles),
        "__SEARCH__": json.dumps(search, ensure_ascii=False).replace("</", "<\\/")
    }
    for key, value in replacements.items():
        template = template.replace(key, value)
    output = ROOT / "web/sdk.html"
    output.write_text(template, encoding="utf-8")
    print(json.dumps({"output": str(output), "documents": len(DOCS and search), "source_files": len(source_files), "bytes": output.stat().st_size}))


TEMPLATE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Complete on-site Zeq Games SDK developer documentation, source, examples, tests, integration and release guides."><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='8' fill='%2370f3ae'/%3E%3Ctext x='32' y='41' text-anchor='middle' font-family='monospace' font-weight='700' font-size='28' fill='%2307110e'%3EZQ%3C/text%3E%3C/svg%3E"><title>Zeq SDK · Developer Documentation</title>
<style>
:root{--bg:#07100e;--panel:#0b1714;--panel2:#0e1d18;--ink:#e9f5ef;--soft:#93aaa0;--line:#233b32;--green:#70f3ae;--cyan:#7ddfd3;--amber:#ffd58a;--sidebar:292px;--toc:220px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--cyan);text-decoration:none}a:hover{color:var(--green)}button,input{font:inherit}.topbar{position:fixed;z-index:30;inset:0 0 auto;height:68px;display:flex;align-items:center;gap:22px;padding:0 28px;background:rgba(7,16,14,.96);border-bottom:1px solid var(--line);backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:12px;color:var(--ink);font-weight:800;letter-spacing:.08em}.brand-mark{width:29px;height:29px;display:grid;place-items:center;background:var(--green);color:#04110b;font:900 13px ui-monospace,monospace;border-radius:3px}.brand small{display:block;color:var(--soft);font-size:9px;letter-spacing:.16em;font-weight:600}.topnav{display:flex;gap:20px;margin-left:auto;font:700 11px ui-monospace,monospace;letter-spacing:.08em}.topnav a{color:var(--soft)}.topnav a:hover{color:var(--green)}.menu{display:none;background:none;border:1px solid var(--line);color:var(--ink);padding:7px 10px;border-radius:3px}.sidebar{position:fixed;z-index:20;top:68px;bottom:0;left:0;width:var(--sidebar);overflow:auto;padding:22px 18px 140px;background:#08130f;border-right:1px solid var(--line)}.search{width:100%;border:1px solid var(--line);border-radius:3px;background:#050d0a;color:var(--ink);padding:11px 12px;outline:none}.search:focus{border-color:var(--green)}.search-status{min-height:26px;padding:7px 2px;color:var(--soft);font-size:11px}.nav-group{margin:20px 0}.nav-group h2{margin:0 0 7px;color:#6e877c;font:700 10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}.nav-doc{display:block;padding:6px 9px;border-left:2px solid transparent;color:var(--soft);font-size:13px;line-height:1.35}.nav-doc:hover{background:#10221b;color:var(--ink)}.nav-doc.active{border-color:var(--green);background:#10251c;color:var(--green)}.main{margin-left:var(--sidebar);padding-top:68px;min-height:100vh}.doc{max-width:1120px;margin:0 auto;padding:54px 54px 110px}.doc[hidden]{display:none}.doc-source{margin-bottom:18px;color:#668277;font:10px ui-monospace,monospace;letter-spacing:.09em}.doc h1{max-width:920px;margin:0 0 25px;font-size:clamp(34px,4.3vw,59px);line-height:1.08;letter-spacing:-.045em}.doc h2{margin:55px 0 16px;padding-top:16px;border-top:1px solid var(--line);font-size:27px;line-height:1.25;letter-spacing:-.02em}.doc h3{margin:34px 0 12px;font-size:20px;line-height:1.3}.doc h4{margin:26px 0 8px;font-size:16px}.doc p,.doc li{max-width:850px}.doc p{color:#c1d1c9}.doc li{margin:5px 0;color:#c1d1c9}.doc strong{color:var(--ink)}.doc blockquote{margin:24px 0;padding:15px 20px;border-left:3px solid var(--amber);background:#171a12;color:#f0dfb8}.doc blockquote p{color:inherit;margin:0}.doc code{padding:2px 5px;border-radius:3px;background:#13251e;color:#a9f4cc;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.doc pre{position:relative;max-width:100%;margin:20px 0;padding:21px;overflow:auto;border:1px solid #28473a;border-radius:5px;background:#040b08;color:#d7eee2;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}.doc pre code{padding:0;background:none;color:inherit;font-size:12.5px;line-height:1.7;white-space:pre;overflow-wrap:normal}.copy{position:absolute;right:8px;top:8px;padding:5px 8px;border:1px solid #345647;border-radius:3px;background:#102019;color:#a7c4b5;font:700 9px ui-monospace,monospace;letter-spacing:.07em;cursor:pointer}.copy:hover{color:var(--green);border-color:var(--green)}.table-wrap{max-width:100%;overflow:auto}.doc table{width:100%;margin:20px 0;border-collapse:collapse;font-size:13px}.doc th{text-align:left;color:var(--green);font:700 10px ui-monospace,monospace;letter-spacing:.07em;text-transform:uppercase}.doc th,.doc td{padding:11px 12px;border:1px solid var(--line);vertical-align:top}.doc td{color:#bfd0c7}.doc tr:nth-child(even) td{background:rgba(18,38,30,.35)}.doc img{max-width:100%}.doc hr{border:0;border-top:1px solid var(--line);margin:40px 0}.kicker{color:var(--green);font:700 10px ui-monospace,monospace;letter-spacing:.16em}.hero{padding:42px 0 48px}.hero h1{font-size:clamp(46px,6vw,79px);max-width:1000px}.hero h1 em{color:var(--green);font-style:normal}.hero p{max-width:760px;font-size:18px}.hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px}.hero-actions a{padding:12px 17px;border:1px solid var(--green);border-radius:3px;font:800 11px ui-monospace,monospace;letter-spacing:.07em}.primary{background:var(--green);color:#04110b!important}.secondary{color:var(--green)}.metric-row{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:5px;background:var(--panel)}.metric-row div{padding:22px;border-right:1px solid var(--line)}.metric-row div:last-child{border:0}.metric-row strong{display:block;color:var(--green);font-size:31px;line-height:1.2}.metric-row span{color:var(--soft);font:700 9px ui-monospace,monospace;letter-spacing:.08em}.overview-section{margin-top:60px}.overview-section h2,.production-note h2{margin-top:8px}.path-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.path-grid a{padding:23px;border:1px solid var(--line);border-radius:5px;background:var(--panel)}.path-grid a:hover{border-color:var(--green);background:var(--panel2)}.path-grid b{color:var(--green);font:700 11px ui-monospace,monospace}.path-grid h3{margin:12px 0 6px}.path-grid p{margin:0;font-size:13px}.production-note{margin-top:60px;padding:29px;border:1px solid #665a31;border-radius:5px;background:#191a11}.production-note .kicker{color:var(--amber)}.production-note p{color:#ddd1af}.source-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.source-file{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--line);background:var(--panel)}.source-file span{flex:none;color:var(--soft);font:700 8px ui-monospace,monospace;letter-spacing:.06em}.footer-note{padding:30px 54px;border-top:1px solid var(--line);color:var(--soft);font-size:12px}.mobile-close{display:none}
@media(min-width:1500px){.doc{margin-left:5vw}}@media(max-width:1000px){:root{--sidebar:250px}.doc{padding:40px 30px 90px}.metric-row{grid-template-columns:repeat(2,1fr)}.metric-row div:nth-child(2){border-right:0}.metric-row div:nth-child(-n+2){border-bottom:1px solid var(--line)}.topnav{gap:12px}}@media(max-width:760px){.topbar{height:60px;padding:0 15px;gap:12px}.menu{display:block}.brand{font-size:13px}.brand small{display:none}.topnav a:first-child{display:none}.topnav{font-size:9px}.sidebar{top:60px;width:min(86vw,320px);transform:translateX(-102%);transition:transform .18s}.sidebar.open{transform:translateX(0);box-shadow:20px 0 60px #000}.main{margin-left:0;padding-top:60px}.doc{padding:28px 19px 70px}.hero{padding-top:24px}.hero h1{font-size:43px}.hero p{font-size:16px}.doc h1{font-size:36px}.doc h2{font-size:24px;margin-top:42px}.path-grid,.source-grid{grid-template-columns:1fr}.metric-row{grid-template-columns:1fr 1fr}.metric-row div{padding:15px}.metric-row strong{font-size:26px}.metric-row span{font-size:8px}.doc table{min-width:620px}.doc pre{margin-left:-4px;margin-right:-4px;padding:17px 12px}.doc pre code{font-size:11.5px}.footer-note{padding:24px 19px}.production-note{padding:21px}.topnav a[href="index.html"]{display:none}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.sidebar{transition:none}}
</style></head><body>
<header class="topbar"><button class="menu" id="menu" aria-label="Open documentation navigation" aria-expanded="false">MENU</button><a class="brand" href="#overview"><span class="brand-mark">ZQ</span><span>ZEQ SDK<small>DEVELOPER DOCUMENTATION</small></span></a><nav class="topnav" aria-label="Product navigation"><a href="index.html">DOOM MACHINE</a><a href="game.html">PLAY DOOM</a><a href="#source">SOURCE</a><a href="#support-matrix">SUPPORT</a></nav></header>
<aside class="sidebar" id="sidebar"><label><span class="kicker">SEARCH THE MANUAL</span><input class="search" id="search" type="search" placeholder="replay, ZEQC3, install…" autocomplete="off"></label><div class="search-status" id="search-status">All documentation is served locally.</div><nav id="doc-nav" aria-label="SDK documentation">__NAV__</nav></aside>
<main class="main"><div id="articles">__ARTICLES__</div><div class="footer-note">Zeq Games SDK · Engineering documentation and source served from this website. Commercial license terms and support commitments are defined separately by the distribution agreement.</div></main>
<script id="search-data" type="application/json">__SEARCH__</script>
<script>
"use strict";
const docs=[...document.querySelectorAll(".doc")],links=[...document.querySelectorAll("[data-doc-link]")],sidebar=document.getElementById("sidebar"),menu=document.getElementById("menu"),search=document.getElementById("search"),searchStatus=document.getElementById("search-status"),index=JSON.parse(document.getElementById("search-data").textContent);
function route(){const parts=(location.hash.slice(1)||"overview").split("/");let id=parts[0],anchor=parts[1]||"";if(!docs.some(d=>d.dataset.doc===id)){id="overview";anchor=""}docs.forEach(d=>d.hidden=d.dataset.doc!==id);links.forEach(a=>{const active=a.dataset.docLink===id;a.classList.toggle("active",active);if(active)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});document.title=(index.find(x=>x.id===id)?.title||"SDK")+" · Zeq SDK";sidebar.classList.remove("open");menu.setAttribute("aria-expanded","false");addCopyButtons();if(anchor){requestAnimationFrame(()=>document.getElementById(anchor)?.scrollIntoView())}else window.scrollTo(0,0)}
function addCopyButtons(){document.querySelectorAll(".doc:not([hidden]) pre").forEach(pre=>{if(pre.querySelector(".copy"))return;const button=document.createElement("button");button.className="copy";button.type="button";button.textContent="COPY";button.setAttribute("aria-label","Copy code example");button.addEventListener("click",async()=>{const text=pre.querySelector("code")?.textContent||pre.textContent;try{await navigator.clipboard.writeText(text);button.textContent="COPIED"}catch{const range=document.createRange();range.selectNodeContents(pre);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);button.textContent="SELECTED"}setTimeout(()=>button.textContent="COPY",1600)});pre.appendChild(button)})}
menu.addEventListener("click",()=>{const open=sidebar.classList.toggle("open");menu.setAttribute("aria-expanded",String(open))});window.addEventListener("hashchange",route);document.addEventListener("keydown",e=>{if(e.key==="/"&&document.activeElement!==search){e.preventDefault();search.focus()}if(e.key==="Escape"){sidebar.classList.remove("open");menu.setAttribute("aria-expanded","false")}});
search.addEventListener("input",()=>{const q=search.value.trim().toLowerCase();if(!q){links.forEach(a=>a.hidden=false);document.querySelectorAll(".nav-group").forEach(g=>g.hidden=false);searchStatus.textContent="All documentation is served locally.";return}const matches=index.filter(item=>(item.title+" "+item.text).includes(q));const ids=new Set(matches.map(x=>x.id));links.forEach(a=>a.hidden=!ids.has(a.dataset.docLink));document.querySelectorAll(".nav-group").forEach(g=>g.hidden=![...g.querySelectorAll(".nav-doc")].some(a=>!a.hidden));searchStatus.textContent=matches.length?matches.length+" matching document"+(matches.length===1?"":"s"):"No matches. Try replay, install, security, or API."});
route();
</script></body></html>'''

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk-root", type=Path, required=True)
    args = parser.parse_args()
    build(args.sdk_root.resolve())
