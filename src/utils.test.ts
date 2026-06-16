import { describe, it, expect } from "vitest";
import { errorMessage, uniq, pluralize } from "./utils.js";

describe("errorMessage", () => {
  it("returns the message from an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("uniq", () => {
  it("removes duplicate values", () => {
    expect(uniq([1, 1, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  it("returns an empty array unchanged", () => {
    expect(uniq([])).toEqual([]);
  });
});

describe("pluralize", () => {
  it("does not add an 's' for a count of 1", () => {
    expect(pluralize(1, "file")).toBe("1 file");
  });

  it("adds an 's' for counts other than 1", () => {
    expect(pluralize(0, "file")).toBe("0 files");
    expect(pluralize(2, "file")).toBe("2 files");
  });
});
