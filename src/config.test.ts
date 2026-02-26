import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

import fs from "node:fs";
import { expandTilde, loadConfig } from "./config.js";

const HOME = os.homedir();

describe("expandTilde", () => {
  it("expands ~/ to home directory", () => {
    expect(expandTilde("~/foo")).toBe(`${HOME}/foo`);
  });

  it("expands bare ~ to home directory", () => {
    expect(expandTilde("~")).toBe(HOME);
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandTilde("/usr/local/bin")).toBe("/usr/local/bin");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandTilde("foo/bar")).toBe("foo/bar");
  });

  it("does not expand ~ in the middle of a path", () => {
    expect(expandTilde("/home/~user")).toBe("/home/~user");
  });
});

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws when config file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(() => loadConfig()).toThrow("Config file not found");
  });

  it("throws on invalid JSON", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("not json{");
    expect(() => loadConfig()).toThrow("Invalid JSON");
  });

  it("throws when repository is missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ machine: "my-laptop", paths: ["~/.zshrc"] }),
    );
    expect(() => loadConfig()).toThrow("Invalid config");
  });

  it("throws when repository is empty", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ repository: "", machine: "my-laptop", paths: ["~/.zshrc"] }),
    );
    expect(() => loadConfig()).toThrow("Invalid config");
  });

  it("throws when machine is missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ repository: "git@github.com:test/repo.git", paths: ["~/.zshrc"] }),
    );
    expect(() => loadConfig()).toThrow("Invalid config");
  });

  it("throws when machine is empty", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        repository: "git@github.com:test/repo.git",
        machine: "",
        paths: ["~/.zshrc"],
      }),
    );
    expect(() => loadConfig()).toThrow("Invalid config");
  });

  it("throws when paths is missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ repository: "git@github.com:test/repo.git", machine: "my-laptop" }),
    );
    expect(() => loadConfig()).toThrow("Invalid config");
  });

  it("throws when paths is empty", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        repository: "git@github.com:test/repo.git",
        machine: "my-laptop",
        paths: [],
      }),
    );
    expect(() => loadConfig()).toThrow("Invalid config");
  });

  it("throws when a path is empty", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        repository: "git@github.com:test/repo.git",
        machine: "my-laptop",
        paths: [""],
      }),
    );
    expect(() => loadConfig()).toThrow("Invalid config");
  });

  it("includes field path in validation error message", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ repository: 123, machine: "my-laptop", paths: ["~/.zshrc"] }),
    );
    expect(() => loadConfig()).toThrow(/repository/);
  });

  it("parses config with only paths", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        repository: "git@github.com:test/repo.git",
        machine: "my-laptop",
        paths: ["~/.zshrc"],
      }),
    );

    const config = loadConfig();
    expect(config.paths).toEqual([`${HOME}/.zshrc`]);
  });

  it("parses full config and expands tildes", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        repository: "git@github.com:test/repo.git",
        machine: "my-laptop",
        paths: ["~/.zshrc", "~/.config/ghostty/**"],
      }),
    );

    const config = loadConfig();
    expect(config.repository).toBe("git@github.com:test/repo.git");
    expect(config.machine).toBe("my-laptop");
    expect(config.paths).toEqual([`${HOME}/.zshrc`, `${HOME}/.config/ghostty/**`]);
  });
});
