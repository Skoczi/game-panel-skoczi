import type { FastDownloadListing } from "./fastDownload.js";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icon = (kind: "folder" | "file" | "arrow" | "home" | "download") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    {
      folder:
        '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
      file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
      arrow: '<path d="m9 5 7 7-7 7"/>',
      home: '<path d="m3 10 9-7 9 7v10H3ZM9 20v-7h6v7"/>',
      download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    }[kind]
  }</svg>`;
const size = (n: number | null) => {
  if (n === null) return "Folder";
  if (n < 1024) return n + " B";
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + " KiB";
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + " MiB";
  return (n / 1024 ** 3).toFixed(1) + " GiB";
};
const css = `
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e4edf7;background:#0b1220}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0,rgba(0,200,223,.07),transparent 55%),#0b1220}a{color:inherit;text-decoration:none}a:focus-visible{outline:2px solid #00c8df;outline-offset:3px;border-radius:8px}svg{width:21px;height:21px;flex-shrink:0}.shell{width:min(1040px,100%);margin:0 auto;padding:40px 28px 28px}.brand{display:flex;align-items:center;gap:10px;color:#8c9fb6;font-size:12px;font-weight:700;letter-spacing:.13em}.brand svg{color:#00c8df}.hero{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:34px 0 26px}h1{margin:0;font-size:clamp(28px,5vw,38px);letter-spacing:-.04em;line-height:1.15}.subtitle{margin:10px 0 0;font-size:14px;color:#8498b1}.badge{display:inline-flex;align-items:center;gap:7px;border:1px solid #1d574d;background:#0b302b;color:#65dfb1;border-radius:30px;padding:7px 12px;font-size:12px;white-space:nowrap}.dot{width:6px;height:6px;border-radius:50%;background:#34d399}.panel{border:1px solid #26374a;border-radius:20px;background:#0f1b2b;overflow:hidden;box-shadow:0 16px 60px #0002}.crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-height:65px;padding:18px 23px;background:#122235;border-bottom:1px solid #26374a;font-size:14px;color:#9bafc6}.crumbs>a{display:inline-flex;align-items:center;gap:8px;min-height:28px;overflow-wrap:anywhere}.crumbs>a:hover{color:#00d4ed}.crumbs>svg{width:13px;height:13px;color:#50647b}.crumbs [aria-current]{color:#e4edf7;font-weight:600}.listhead{padding:19px 23px 12px;display:flex;justify-content:space-between;color:#758aa3;font-size:11px;letter-spacing:.1em;text-transform:uppercase}.row{display:flex;align-items:center;gap:14px;padding:15px 23px;border-bottom:1px solid #203045;min-height:77px;transition:background .15s}.row:last-child{border-bottom:0}.row:hover{background:#14283b}.glyph{display:grid;place-items:center;width:42px;height:42px;flex-shrink:0;border-radius:12px;background:#17273a;color:#91aac5}.folder .glyph{background:#0b303e;color:#00c8df}.name{font-size:14px;font-weight:550;overflow-wrap:anywhere;line-height:1.45}.label{flex:1;min-width:0}.kind{font-size:11px;color:#6f879f;margin-top:4px;letter-spacing:.045em}.meta{color:#9bb0c8;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}.action{color:#56718c;display:flex;margin-left:8px}.action svg{width:17px;height:17px}.row:hover .action{color:#00c8df}.empty{padding:44px 24px;text-align:center;color:#92a7bf}.empty strong{display:block;color:#e4edf7;font-size:19px;margin-bottom:12px}.empty p{line-height:1.7;margin:0}.empty a{display:inline-block;margin-top:24px;padding:10px 16px;border:1px solid #31506a;border-radius:10px;color:#00c8df}.pager{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #26374a;padding:18px 23px;font-size:13px;color:#8ca5bd}.pager a{padding:9px 12px;background:#192c42;border-radius:9px;color:#c6d9ec}.footer{display:flex;justify-content:space-between;gap:15px;margin:22px 3px 0;color:#627b96;font-size:11px;line-height:1.6}.footer span:last-child{text-align:right}@media(max-width:540px){.shell{padding:26px 16px}.hero{margin:29px 0 23px;gap:12px}.subtitle{font-size:12px}.badge{padding:6px 9px;font-size:11px}.panel{border-radius:16px}.crumbs{padding:14px 16px;gap:8px;font-size:13px}.listhead{padding:17px 16px 10px}.row{padding:14px 16px;gap:11px;min-height:74px}.glyph{width:36px;height:36px;border-radius:10px}.glyph svg{width:19px;height:19px}.name{font-size:13px}.meta{font-size:11px}.action{margin-left:0}.footer{font-size:10px}.pager{padding:16px}.empty{padding:32px 18px}}@media(prefers-reduced-motion:reduce){.row{transition:none}}
`;
export function renderFastDownloadPage(
  listing: FastDownloadListing | null,
  serverId?: number,
  code = 404,
): string {
  const id = listing?.serverId ?? serverId;
  const base = id ? `/fdl/srv${id}/` : "";
  const href = (p: string, directory = true) =>
    base +
    p.split("/").map(encodeURIComponent).join("/") +
    (directory && p ? "/" : "");
  const title = listing ? "FastDownload" : "Path unavailable";
  let body = "";
  if (listing) {
    const parts = listing.path ? listing.path.split("/") : [];
    const crumbs =
      `<a href="${base}" ${!parts.length ? 'aria-current="page"' : ""}>${icon("home")}Server ${id}</a>` +
      parts
        .map(
          (p, i) =>
            `${icon("arrow")}<a href="${escape(href(parts.slice(0, i + 1).join("/")))}" ${i === parts.length - 1 ? 'aria-current="page"' : ""}>${escape(p)}</a>`,
        )
        .join("");
    const rows = listing.entries
      .map(
        (e) =>
          `<a class="row ${e.directory ? "folder" : "file"}" href="${escape(href(e.path, e.directory))}"${e.directory ? "" : " download"}><span class="glyph">${icon(e.directory ? "folder" : "file")}</span><span class="label"><span class="name">${escape(e.name)}</span><span class="kind" style="display:block">${e.directory ? "DIRECTORY" : escape(e.name.toLowerCase().endsWith(".bz2") ? "BZIP2 ASSET" : (e.name.split(".").pop() || "FILE").toUpperCase() + " FILE")}</span></span><span class="meta">${size(e.size)}</span><span class="action">${icon(e.directory ? "arrow" : "download")}</span></a>`,
      )
      .join("");
    const pager =
      listing.pages > 1
        ? `<nav class="pager" aria-label="Pagination">${listing.page > 1 ? `<a href="${escape(href(listing.path))}?page=${listing.page - 1}">← Previous</a>` : "<span></span>"}<span>${listing.page} / ${listing.pages}</span>${listing.page < listing.pages ? `<a href="${escape(href(listing.path))}?page=${listing.page + 1}">Next →</a>` : "<span></span>"}</nav>`
        : "";
    body = `<section class="panel"><nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav><div class="listhead"><span>Name</span><span>${listing.total} ${listing.total === 1 ? "item" : "items"}</span></div>${rows || '<div class="empty"><strong>No published files yet</strong><p>Files will appear here when they are available for download.</p></div>'}${pager}</section>`;
  } else
    body = `<section class="panel"><div class="empty"><strong>${code === 405 ? "Use a download link" : "This path is not available"}</strong><p>The file or folder may have been removed or is not published through FastDownload.</p>${base ? `<a href="${base}">← Browse server files</a>` : ""}</div></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} · Game Panel</title><style>${css}</style></head><body><main class="shell"><div class="brand">${icon("download")} GAME PANEL</div><header class="hero"><div><h1>${escape(title)}</h1><p class="subtitle">${listing ? "Game assets, ready to download." : "FastDownload · " + code}</p></div>${listing ? '<span class="badge"><span class="dot"></span>Live files</span>' : ""}</header>${body}<footer class="footer"><span>FastDownload${id ? " · Server " + id : ""}</span><span>Maps, models &amp; sounds</span></footer></main></body></html>`;
}
