import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

describe("api/lib/firebase.js module", () => {
  it("exists as a file", () => {
    const path = resolve(__dirname, "../api/lib/firebase.js");
    expect(existsSync(path)).toBe(true);
  });

  it("exports db, BOT, and API properties", () => {
    // We can't initialize Firebase without credentials in test,
    // but we can statically verify the module interface
    const content = readFileSync(
      resolve(__dirname, "../api/lib/firebase.js"),
      "utf8"
    );
    expect(content).toContain("module.exports");
    expect(content).toContain("db");
    expect(content).toContain("BOT");
    expect(content).toContain("API");
  });

  it("requires firebase-admin/app and firebase-admin/firestore", () => {
    const content = readFileSync(
      resolve(__dirname, "../api/lib/firebase.js"),
      "utf8"
    );
    expect(content).toContain('require("firebase-admin/app")');
    expect(content).toContain('require("firebase-admin/firestore")');
  });
});

describe("Consumer files import from ./lib/firebase", () => {
  const consumers = ["../api/cron.js", "../api/webhook.js"];

  consumers.forEach((relPath) => {
    const filePath = resolve(__dirname, relPath);
    it(`${relPath} imports from ./lib/firebase or ../../lib/firebase`, () => {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf8");
      expect(content).toMatch(/require\(["'].*lib\/firebase["']\)/);
    });

    it(`${relPath} no longer has inline initializeApp`, () => {
      const content = readFileSync(filePath, "utf8");
      expect(content).not.toContain('require("firebase-admin/app")');
      expect(content).not.toContain('initializeApp({');
    });
  });

  it("admin.js imports from ./lib/firebase", () => {
    const filePath = resolve(__dirname, "../api/admin.js");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toMatch(/require\(["'].*lib\/firebase["']\)/);
    expect(content).not.toContain('require("firebase-admin/app")');
    expect(content).not.toContain('initializeApp({');
  });

  it("import.js imports from ./lib/firebase", () => {
    const filePath = resolve(__dirname, "../api/import.js");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toMatch(/require\(["'].*lib\/firebase["']\)/);
    expect(content).not.toContain('require("firebase-admin/app")');
    expect(content).not.toContain('initializeApp({');
  });
});