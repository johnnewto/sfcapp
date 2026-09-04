// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { notebookToJson } from "../src/notebook/document";
import {
  buildNotebookShareUrl,
  compressNotebookSharePayload,
  decompressNotebookSharePayload,
  NOTEBOOK_SHARE_CELL_QUERY_PARAM,
  NOTEBOOK_SHARE_MAX_COMPRESSED_LENGTH,
  NOTEBOOK_SHARE_QUERY_PARAM,
  parseNotebookShareSearch,
  readNotebookShareSearchSource,
  resolveNotebookShareLinkToCopy,
  tryLoadNotebookFromShareSearch
} from "../src/notebook/notebookShareLink";
import { createNotebookFromTemplate } from "../src/notebook/templates";

describe("notebookShareLink", () => {
  const originalPath = window.location.pathname;
  const originalSearch = window.location.search;
  const originalHash = window.location.hash;

  afterEach(() => {
    history.replaceState(history.state, "", `${originalPath}${originalSearch}${originalHash}`);
  });

  it("round-trips compact notebook JSON through LZ compression", () => {
    const document = createNotebookFromTemplate("sim");
    document.title = "Shared SIM Notebook";

    const source = notebookToJson(document);
    const nbz = compressNotebookSharePayload(source);
    const restored = decompressNotebookSharePayload(nbz);

    expect(restored).toBe(source);
    expect(tryLoadNotebookFromShareSearch(`?${NOTEBOOK_SHARE_QUERY_PARAM}=${nbz}`)?.title).toBe(
      "Shared SIM Notebook"
    );
  });

  it("parses share search params and builds URLs with optional cell ids", () => {
    const document = createNotebookFromTemplate("sim");
    document.title = "URL Builder Notebook";

    expect(parseNotebookShareSearch("?nbz=abc&cell=intro")).toEqual({
      nbz: "abc",
      cellId: "intro"
    });

    const built = buildNotebookShareUrl({
      basePath: "/sfcapp/",
      cellId: "intro",
      document,
      origin: "https://example.test"
    });

    expect("url" in built).toBe(true);
    if (!("url" in built)) {
      return;
    }

    expect(built.url).toMatch(/^https:\/\/example\.test\/sfcapp\/#\/notebook\?/);
    const hashQuery = built.url.split("?").slice(1).join("?");
    const params = new URLSearchParams(hashQuery);
    expect(params.get(NOTEBOOK_SHARE_QUERY_PARAM)).toBeTruthy();
    expect(params.get(NOTEBOOK_SHARE_CELL_QUERY_PARAM)).toBe("intro");
  });

  it("loads share payloads from hash routes without sending nbz to the server path", () => {
    const document = createNotebookFromTemplate("sim");
    document.title = "Hash Shared Notebook";
    const nbz = compressNotebookSharePayload(notebookToJson(document));
    history.replaceState(history.state, "", `/#/notebook?${NOTEBOOK_SHARE_QUERY_PARAM}=${nbz}`);

    expect(tryLoadNotebookFromShareSearch(readNotebookShareSearchSource())?.title).toBe(
      "Hash Shared Notebook"
    );
  });

  it("loads publish-style #?nbz= hash payloads", () => {
    const document = createNotebookFromTemplate("sim");
    document.title = "Publish Style Hash";
    const nbz = compressNotebookSharePayload(notebookToJson(document));
    history.replaceState(history.state, "", `/publish/live#?${NOTEBOOK_SHARE_QUERY_PARAM}=${nbz}`);

    expect(tryLoadNotebookFromShareSearch(readNotebookShareSearchSource())?.title).toBe(
      "Publish Style Hash"
    );
  });

  it("loads nbz from Pages 404 double-hash rewrite URLs", () => {
    const document = createNotebookFromTemplate("sim");
    document.title = "Pages Double Hash";
    const nbz = compressNotebookSharePayload(notebookToJson(document));
    history.replaceState(
      history.state,
      "",
      `/#/publish/live#?${NOTEBOOK_SHARE_QUERY_PARAM}=${nbz}`
    );

    expect(tryLoadNotebookFromShareSearch(readNotebookShareSearchSource())?.title).toBe(
      "Pages Double Hash"
    );
  });

  it("returns an error when the compressed payload exceeds the share limit", () => {
    const document = createNotebookFromTemplate("bmw");
    // Pad with high-entropy content so the compressed payload reliably exceeds the
    // share limit regardless of the configured limit value.
    let filler = "";
    while (filler.length < NOTEBOOK_SHARE_MAX_COMPRESSED_LENGTH * 4) {
      filler += Math.random().toString(36).slice(2);
    }
    document.cells.push({
      id: "oversized-filler",
      type: "markdown",
      title: "Oversized filler",
      source: filler
    });

    const compressedLength = compressNotebookSharePayload(notebookToJson(document)).length;
    expect(compressedLength).toBeGreaterThan(NOTEBOOK_SHARE_MAX_COMPRESSED_LENGTH);

    const built = buildNotebookShareUrl({
      basePath: "/",
      document,
      origin: "https://example.test"
    });

    expect("error" in built).toBe(true);
  });

  it("returns null for invalid share payloads without throwing", () => {
    expect(decompressNotebookSharePayload("not-valid-lz-data")).toBeNull();
    expect(tryLoadNotebookFromShareSearch(`?${NOTEBOOK_SHARE_QUERY_PARAM}=not-valid-lz-data`)).toBeNull();
    expect(parseNotebookShareSearch("?other=1")).toBeNull();
  });

  it("prefers a shortened URL when the share shorten API succeeds", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ shortUrl: "https://tinyurl.com/abc123" }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveNotebookShareLinkToCopy(
      "http://localhost:5173/notebook?nbz=compressed"
    );

    expect(resolved).toEqual({
      shortened: true,
      url: "https://tinyurl.com/abc123"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/v1/notebook-share/shorten",
      expect.objectContaining({ method: "POST" })
    );

    vi.unstubAllGlobals();
  });

  it("falls back to the long URL when shortening fails", async () => {
    const longUrl = "http://localhost:5173/notebook?nbz=compressed";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "SHARE_LINKS is not configured." }), { status: 503 }))
    );

    const resolved = await resolveNotebookShareLinkToCopy(longUrl);

    expect(resolved).toEqual({
      shortened: false,
      url: longUrl
    });

    vi.unstubAllGlobals();
  });
});
