import { describe, it, expect } from "vitest";
import {
  DIMENSION_LIMITS,
  fromDisplayUnits,
  parseNumericDraft,
  toDisplayUnits,
} from "../src/measurements";

describe("dimension entry boundaries", () => {
  it("accepts the completed value without clamping intermediate typing", () => {
    expect(parseNumericDraft("1", 5, 2000)).toBeNull();
    expect(parseNumericDraft("150", 5, 2000)).toBe(150);
    expect(parseNumericDraft("150.25", 5, 2000)).toBe(150.25);
  });
  it("rejects empty, nonfinite and out-of-range drafts", () => {
    for (const value of [
      "",
      " ",
      "-2",
      "0",
      "Infinity",
      "NaN",
      "1e309",
      "2001",
    ])
      expect(parseNumericDraft(value, 5, 2000)).toBeNull();
    expect(parseNumericDraft("5", 5, 2000)).toBe(5);
    expect(parseNumericDraft("2000", 5, 2000)).toBe(2000);
  });
  it("preserves decimal centimetres and inches and their allowed boundaries", () => {
    expect(fromDisplayUnits(150.25, "cm")).toBe(1.5025);
    expect(toDisplayUnits(1.5025, "cm")).toBe(150.25);
    expect(fromDisplayUnits(60, "in")).toBe(1.524);
    for (const limits of Object.values(DIMENSION_LIMITS))
      for (const metres of [limits.min, limits.max])
        for (const unit of ["cm", "in"] as const) {
          expect(
            fromDisplayUnits(toDisplayUnits(metres, unit), unit),
          ).toBeCloseTo(metres, 5);
        }
  });
});
