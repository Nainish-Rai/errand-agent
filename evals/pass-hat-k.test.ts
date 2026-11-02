import { describe, expect, it } from "vitest";

import { passHatK } from "./pass-hat-k";

describe("pass^k", () => {
  it("is the plain pass rate at k = 1", () => {
    expect(passHatK(3, 4, 1)).toBe(0.75);
  });

  it("is C(c, k) / C(n, k)", () => {
    // C(3,2) / C(4,2) = 3 / 6
    expect(passHatK(3, 4, 2)).toBe(0.5);
    // C(4,3) / C(5,3) = 4 / 10
    expect(passHatK(4, 5, 3)).toBeCloseTo(0.4);
  });

  it("is 1 when every trial passed and 0 when fewer than k passed", () => {
    expect(passHatK(2, 2, 2)).toBe(1);
    expect(passHatK(1, 2, 2)).toBe(0);
    expect(passHatK(0, 3, 1)).toBe(0);
  });

  it("refuses a k larger than the trials or counts that don't add up", () => {
    expect(() => passHatK(1, 2, 3)).toThrow(RangeError);
    expect(() => passHatK(3, 2, 1)).toThrow(RangeError);
    expect(() => passHatK(1.5, 2, 1)).toThrow(RangeError);
  });
});
