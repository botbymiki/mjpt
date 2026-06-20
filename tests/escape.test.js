import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

describe("api/lib/escape.js — escapeMarkdown()", () => {
  it("exists as a file", () => {
    const path = resolve(__dirname, "../api/lib/escape.js");
    expect(existsSync(path)).toBe(true);
  });

  it("exports an escapeMarkdown function", async () => {
    const mod = await import("../api/lib/escape.js");
    expect(mod.escapeMarkdown).toBeDefined();
    expect(typeof mod.escapeMarkdown).toBe("function");
  });

  it("escapes asterisks (*)", async () => {
    const { escapeMarkdown } = await import("../api/lib/escape.js");
    expect(escapeMarkdown("felt *better")).toBe("felt \\*better");
    expect(escapeMarkdown("was *great* today")).toBe("was \\*great\\* today");
  });

  it("escapes underscores (_)", async () => {
    const { escapeMarkdown } = await import("../api/lib/escape.js");
    expect(escapeMarkdown("a_bit_weird")).toBe("a\\_bit\\_weird");
  });

  it("escapes backticks (`)", async () => {
    const { escapeMarkdown } = await import("../api/lib/escape.js");
    expect(escapeMarkdown("`code` feels wrong")).toBe("\\`code\\` feels wrong");
  });

  it("escapes square brackets ([])", async () => {
    const { escapeMarkdown } = await import("../api/lib/escape.js");
    expect(escapeMarkdown("[maybe] or [not]")).toBe("\\[maybe\\] or \\[not\\]");
  });

  it("escapes tilde (~)", async () => {
    const { escapeMarkdown } = await import("../api/lib/escape.js");
    expect(escapeMarkdown("~spoiler~ alert")).toBe("\\~spoiler\\~ alert");
  });

  it("handles strings with no special chars unchanged", async () => {
    const { escapeMarkdown } = await import("../api/lib/escape.js");
    expect(escapeMarkdown("Just a normal note.")).toBe("Just a normal note.");
    expect(escapeMarkdown("")).toBe("");
    expect(escapeMarkdown("123 numbers ok")).toBe("123 numbers ok");
  });

  it("escapes combined special characters", async () => {
    const { escapeMarkdown } = await import("../api/lib/escape.js");
    const input = "it was *really* _bad_ and ~weird~";
    const expected = "it was \\*really\\* \\_bad\\_ and \\~weird\\~";
    expect(escapeMarkdown(input)).toBe(expected);
  });
});

describe("buildConfirmationMsg escapes notes in webhook.js", () => {
  it("imports escapeMarkdown from ./lib/escape", () => {
    const content = readFileSync(
      resolve(__dirname, "../api/webhook.js"),
      "utf8"
    );
    expect(content).toMatch(/require\(["'].\/lib\/escape["']\)/);
  });
});