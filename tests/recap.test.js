import { describe, it, expect } from "vitest";
import { isRecapDue } from "../api/lib/recap.js";

describe("isRecapDue", () => {
  it("returns true on Sunday 8am when not already sent", () => {
    expect(isRecapDue(7, 8, false)).toBe(true);
  });

  it("returns true on Sunday 6am when not already sent", () => {
    expect(isRecapDue(7, 6, false)).toBe(true);
  });

  it("returns true on Sunday 11am when not already sent", () => {
    expect(isRecapDue(7, 11, false)).toBe(true);
  });

  it("returns false on Sunday 5am (before window)", () => {
    expect(isRecapDue(7, 5, false)).toBe(false);
  });

  it("returns false on Sunday 12pm (after window)", () => {
    expect(isRecapDue(7, 12, false)).toBe(false);
  });

  it("returns false on Saturday at any hour", () => {
    expect(isRecapDue(6, 8, false)).toBe(false);
    expect(isRecapDue(6, 10, false)).toBe(false);
    expect(isRecapDue(6, 12, false)).toBe(false);
  });

  it("returns false on Monday at any hour", () => {
    expect(isRecapDue(1, 8, false)).toBe(false);
  });

  it("returns false when already sent this week regardless of window", () => {
    expect(isRecapDue(7, 8, true)).toBe(false);
    expect(isRecapDue(7, 6, true)).toBe(false);
    expect(isRecapDue(7, 11, true)).toBe(false);
  });

  it("returns true when force is true regardless of day/hour/dedup", () => {
    expect(isRecapDue(7, 8, true, true)).toBe(true);
    expect(isRecapDue(1, 3, false, true)).toBe(true);
    expect(isRecapDue(6, 23, true, true)).toBe(true);
  });
});