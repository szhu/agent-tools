import { dir } from "@cross/dir";
import { join } from "@std/path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  parseGrid,
  parseRange,
  readSlice,
  resolveRange,
  tilePattern,
  writeSlice,
} from "./main.ts";

describe("parseRange", () => {
  test("l:c-l:c basic", () =>
    expect(parseRange("1:1-3:5")).toEqual({
      kind: "range",
      r1: 1,
      c1: 1,
      r2: 3,
      c2: 5,
    }));

  test("l:c-wxh basic", () =>
    expect(parseRange("1:1-5x3")).toEqual({
      kind: "size",
      r1: 1,
      c1: 1,
      h: 3,
      w: 5,
    }));

  test("(i,j)-(i,j) basic", () =>
    expect(parseRange("(0,0)-(3,5)")).toEqual({
      kind: "range",
      r1: 1,
      c1: 1,
      r2: 3,
      c2: 5,
    }));

  test("(i,j)x(h,w) basic", () =>
    expect(parseRange("(0,0)x(3,5)")).toEqual({
      kind: "size",
      r1: 1,
      c1: 1,
      h: 3,
      w: 5,
    }));

  test(":-: all omitted", () =>
    expect(parseRange(":-:")).toEqual({ kind: "range" }));

  test("5:-: partial omit", () =>
    expect(parseRange("5:-:")).toEqual({ kind: "range", r1: 5 }));

  test("(,)x(,8) partial omit size", () =>
    expect(parseRange("(,)x(,8)")).toEqual({ kind: "size", w: 8 }));

  test("(,)-(,) all omitted parens", () =>
    expect(parseRange("(,)-(,)")).toEqual({ kind: "range" }));

  test("rejects non-integer", () =>
    expect(() => parseRange("a:1-2:3")).toThrow());

  test("rejects malformed", () => expect(() => parseRange("1:1")).toThrow());
});

describe("resolveRange", () => {
  test("range: fills defaults", () =>
    expect(resolveRange({ kind: "range" }, 5, 7, true)).toEqual({
      r1: 1,
      c1: 1,
      r2: 5,
      c2: 7,
    }));

  test("range: partial fills", () =>
    expect(resolveRange({ kind: "range", r1: 5 }, 10, 20, true)).toEqual({
      r1: 5,
      c1: 1,
      r2: 10,
      c2: 20,
    }));

  test("size: fills defaults", () =>
    expect(resolveRange({ kind: "size" }, 5, 7, true)).toEqual({
      r1: 1,
      c1: 1,
      r2: 5,
      c2: 7,
    }));

  test("size: (,)x(,8) on 4x10", () =>
    expect(resolveRange({ kind: "size", w: 8 }, 4, 10, true)).toEqual({
      r1: 1,
      c1: 1,
      r2: 4,
      c2: 8,
    }));

  test("size: exact", () =>
    expect(
      resolveRange({ kind: "size", r1: 2, c1: 3, h: 4, w: 5 }, 100, 100, false),
    ).toEqual({ r1: 2, c1: 3, r2: 5, c2: 7 }));

  test("range: rejects omitted for write", () =>
    expect(() => resolveRange({ kind: "range" }, 5, 5, false)).toThrow());

  test("size: rejects omitted for write", () =>
    expect(() => resolveRange({ kind: "size", w: 8 }, 5, 5, false)).toThrow());
});

describe("parseGrid", () => {
  test("simple rectangular file", () =>
    expect(parseGrid("abc\ndef\n")).toEqual(["abc", "def"]));

  test("no trailing newline", () =>
    expect(parseGrid("abc\ndef")).toEqual(["abc", "def"]));

  test("empty file", () => expect(parseGrid("")).toEqual([]));

  test("lone newline is empty", () => expect(parseGrid("\n")).toEqual([]));

  test("rejects non-rectangular", () =>
    expect(() => parseGrid("abc\nde\n")).toThrow(/rectangular/));

  test("rejects tab", () =>
    expect(() => parseGrid("a\tb\n")).toThrow(/Non-printable/));

  test("rejects non-ASCII", () =>
    expect(() => parseGrid("abé\n")).toThrow(/Non-printable/));

  test("padShortLines pads to max line width", () =>
    expect(parseGrid("abcde\nfg\nhij\n", true)).toEqual([
      "abcde",
      "fg   ",
      "hij  ",
    ]));

  test("padShortLines leaves already-rectangular input untouched", () =>
    expect(parseGrid("abc\ndef\n", true)).toEqual(["abc", "def"]));

  test("padShortLines still rejects non-ASCII", () =>
    expect(() => parseGrid("abc\nde\t\n", true)).toThrow(/Non-printable/));
});

describe("readSlice", () => {
  const grid = parseGrid("abcde\nfghij\nklmno\n");

  test("full", () =>
    expect(readSlice(grid, { r1: 1, c1: 1, r2: 3, c2: 5 })).toBe(
      "abcde\nfghij\nklmno",
    ));

  test("single cell", () =>
    expect(readSlice(grid, { r1: 2, c1: 3, r2: 2, c2: 3 })).toBe("h"));

  test("middle rect", () =>
    expect(readSlice(grid, { r1: 2, c1: 2, r2: 3, c2: 4 })).toBe("ghi\nlmn"));

  test("out of bounds row", () =>
    expect(() => readSlice(grid, { r1: 1, c1: 1, r2: 4, c2: 5 })).toThrow(
      /out of bounds/,
    ));

  test("out of bounds col", () =>
    expect(() => readSlice(grid, { r1: 1, c1: 1, r2: 3, c2: 6 })).toThrow(
      /out of bounds/,
    ));

  test("ignoreMissing clips out-of-bounds range to file", () =>
    expect(readSlice(grid, { r1: 2, c1: 4, r2: 10, c2: 20 }, true)).toBe(
      "ij\nno",
    ));

  test("ignoreMissing returns empty when range is entirely outside file", () =>
    expect(readSlice(grid, { r1: 10, c1: 10, r2: 20, c2: 20 }, true)).toBe(""));

  test("ignoreMissing on in-bounds range returns full slice", () =>
    expect(readSlice(grid, { r1: 2, c1: 2, r2: 3, c2: 4 }, true)).toBe(
      "ghi\nlmn",
    ));
});

describe("tilePattern", () => {
  test("length 0 returns empty", () => expect(tilePattern("--", 0)).toBe(""));
  test("phase 0", () => expect(tilePattern("-- ", 10)).toBe("-- -- -- -"));
  test("phase 1", () => expect(tilePattern("-- ", 5, 1)).toBe("- -- "));
  test("phase wraps", () => expect(tilePattern("ab", 6, 5)).toBe("bababa"));
  test("empty pattern throws", () =>
    expect(() => tilePattern("", 3)).toThrow());
});

describe("writeSlice", () => {
  test("exact-shape overwrite", () => {
    const grid = parseGrid("abcde\nfghij\nklmno\n");
    expect(
      writeSlice(grid, { r1: 2, c1: 2, r2: 3, c2: 4 }, "XYZ\nPQR", undefined),
    ).toEqual(["abcde", "fXYZj", "kPQRo"]);
  });

  test("wrong content shape errors", () => {
    const grid = parseGrid("abcde\nfghij\n");
    expect(() =>
      writeSlice(grid, { r1: 1, c1: 1, r2: 2, c2: 5 }, "XX\nYY", undefined),
    ).toThrow(/width/);
  });

  test("--fill pads short content", () => {
    const grid = parseGrid("abcde\nfghij\nklmno\n");
    expect(
      writeSlice(grid, { r1: 1, c1: 1, r2: 3, c2: 3 }, "X\nYY", "."),
    ).toEqual(["X..de", "YY.ij", "...no"]);
  });

  test("--fill rejects overlong content", () => {
    const grid = parseGrid("abcde\n");
    expect(() =>
      writeSlice(grid, { r1: 1, c1: 1, r2: 1, c2: 3 }, "TOOLONG", "."),
    ).toThrow(/max/);
  });

  test("--fill with multi-char pattern tiles across width", () => {
    const grid = parseGrid("");
    expect(
      writeSlice(grid, { r1: 1, c1: 1, r2: 2, c2: 10 }, "", "-- "),
    ).toEqual(["-- -- -- -", "-- -- -- -"]);
  });

  test("--fill pattern continues in phase past content", () => {
    const grid = parseGrid("");
    expect(
      writeSlice(grid, { r1: 1, c1: 1, r2: 1, c2: 6 }, "X", "-- "),
    ).toEqual(["X- -- "]);
  });

  test("--fill rejects empty pattern", () => {
    const grid = parseGrid("abc\n");
    expect(() =>
      writeSlice(grid, { r1: 1, c1: 1, r2: 1, c2: 3 }, "", ""),
    ).toThrow(/at least one/);
  });

  test("--fill rejects non-ASCII pattern", () => {
    const grid = parseGrid("abc\n");
    expect(() =>
      writeSlice(grid, { r1: 1, c1: 1, r2: 1, c2: 3 }, "", "a\tb"),
    ).toThrow(/printable/);
  });

  test("extends rows down when covering full width", () => {
    const grid = parseGrid("abcde\n");
    expect(
      writeSlice(
        grid,
        { r1: 2, c1: 1, r2: 3, c2: 5 },
        "fghij\nklmno",
        undefined,
      ),
    ).toEqual(["abcde", "fghij", "klmno"]);
  });

  test("extends cols right when covering full height", () => {
    const grid = parseGrid("abc\ndef\n");
    expect(
      writeSlice(grid, { r1: 1, c1: 4, r2: 2, c2: 5 }, "XY\nZW", undefined),
    ).toEqual(["abcXY", "defZW"]);
  });

  test("extending cols on partial rows fails", () => {
    const grid = parseGrid("abc\ndef\n");
    expect(() =>
      writeSlice(grid, { r1: 1, c1: 4, r2: 1, c2: 5 }, "XY", undefined),
    ).toThrow(/rectangular/);
  });

  test("extending rows past end with gap fails", () => {
    const grid = parseGrid("abc\n");
    expect(() =>
      writeSlice(grid, { r1: 3, c1: 1, r2: 3, c2: 3 }, "XYZ", undefined),
    ).toThrow();
  });

  test("rejects non-ASCII in content", () => {
    const grid = parseGrid("abc\n");
    expect(() =>
      writeSlice(grid, { r1: 1, c1: 1, r2: 1, c2: 3 }, "ab\t", undefined),
    ).toThrow(/Non-printable/);
  });

  test("writing into an empty file", () => {
    const grid = parseGrid("");
    expect(
      writeSlice(grid, { r1: 1, c1: 1, r2: 2, c2: 3 }, "abc\ndef", undefined),
    ).toEqual(["abc", "def"]);
  });
});

describe("cli e2e", () => {
  const scriptPath = join(import.meta.dirname, "main.ts");
  const testId = import.meta
    .filename!.replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  let baseDir: string;
  let workDir: string;

  beforeAll(async () => {
    baseDir = join(await dir("tmp"), testId);
    await mkdir(baseDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    workDir = await mkdtemp(join(baseDir, "case-"));
  });

  async function run(
    args: string[],
    stdin?: string,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      const child = spawn("bun", [scriptPath, ...args], {
        stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout!.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) =>
        resolve({ code: code ?? -1, stdout, stderr }),
      );
      if (stdin !== undefined) {
        child.stdin!.write(stdin);
        child.stdin!.end();
      }
    });
  }

  async function makeFile(name: string, content: string): Promise<string> {
    const path = join(workDir, name);
    await writeFile(path, content);
    return path;
  }

  test("read whole file with :-:", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\nghi\n");
    const { code, stdout } = await run([path, "read", ":-:"]);
    expect(code).toBe(0);
    expect(stdout).toBe("abc\ndef\nghi\n");
  });

  test("read subrect with 1-indexed range", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code, stdout } = await run([path, "read", "2:2-3:4"]);
    expect(code).toBe(0);
    expect(stdout).toBe("ghi\nlmn\n");
  });

  test("read subrect with 0-indexed exclusive range", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code, stdout } = await run([path, "read", "(1,1)-(3,4)"]);
    expect(code).toBe(0);
    expect(stdout).toBe("ghi\nlmn\n");
  });

  test("read subrect with 1-indexed size (wxh)", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code, stdout } = await run([path, "read", "2:2-3x2"]);
    expect(code).toBe(0);
    expect(stdout).toBe("ghi\nlmn\n");
  });

  test("read subrect with 0-indexed size (h,w)", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code, stdout } = await run([path, "read", "(1,1)x(2,3)"]);
    expect(code).toBe(0);
    expect(stdout).toBe("ghi\nlmn\n");
  });

  test("read with partial omission (row 2 onwards)", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\nghi\n");
    const { code, stdout } = await run([path, "read", "2:-:"]);
    expect(code).toBe(0);
    expect(stdout).toBe("def\nghi\n");
  });

  test("read out-of-bounds exits nonzero", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code, stderr } = await run([path, "read", "1:1-5:5"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/out of bounds/);
  });

  test("read non-rectangular file exits nonzero", async () => {
    const path = await makeFile("grid.txt", "abc\nde\n");
    const { code, stderr } = await run([path, "read", ":-:"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/rectangular/);
  });

  test("read file with tab exits nonzero", async () => {
    const path = await makeFile("grid.txt", "a\tb\n");
    const { code, stderr } = await run([path, "read", ":-:"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Non-printable/);
  });

  test("read --ignore-missing tolerates ragged files", async () => {
    const path = await makeFile("grid.txt", "abcde\nfg\nhij\n");
    const { code, stdout } = await run([
      path,
      "read",
      "1:1-3:5",
      "--ignore-missing",
    ]);
    expect(code).toBe(0);
    expect(stdout).toBe("abcde\nfg   \nhij  \n");
  });

  test("read on ragged file without --ignore-missing errors", async () => {
    const path = await makeFile("grid.txt", "abcde\nfg\nhij\n");
    const { code, stderr } = await run([path, "read", "1:1-3:5"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/rectangular/);
  });

  test("read --ignore-missing clips range to file bounds", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code, stdout } = await run([
      path,
      "read",
      "2:3-10:20",
      "--ignore-missing",
    ]);
    expect(code).toBe(0);
    expect(stdout).toBe("hij\nmno\n");
  });

  test("read --ignore-missing on fully-outside range prints nothing", async () => {
    const path = await makeFile("grid.txt", "abc\n");
    const { code, stdout } = await run([
      path,
      "read",
      "10:10-20:20",
      "--ignore-missing",
    ]);
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  test("read on nonexistent file exits nonzero", async () => {
    const path = join(workDir, "missing.txt");
    const { code, stderr } = await run([path, "read", ":-:"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/ENOENT|no such file/i);
  });

  test("read with no range defaults to whole file", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code, stdout } = await run([path, "read"]);
    expect(code).toBe(0);
    expect(stdout).toBe("abc\ndef\n");
  });

  test("write exact-shape persists to disk", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code } = await run([path, "write", "2:2-3:4", "--", "XYZ\nPQR"]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("abcde\nfXYZj\nkPQRo\n");
  });

  test("write with content missing '--' exits nonzero", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code, stderr } = await run([path, "write", "1:1-2:3", "XYZ\nPQR"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--/);
  });

  test("write with '--' followed by literal '--' as content", async () => {
    const path = await makeFile("grid.txt", "abc\n");
    const { code } = await run([path, "write", "1:1-1:2", "--", "--"]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("--c\n");
  });

  test("write with --fill pads and persists", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code } = await run([
      path,
      "write",
      "1:1-3:3",
      "--fill=.",
      "--",
      "X\nYY",
    ]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("X..de\nYY.ij\n...no\n");
  });

  test("write with --clip trims over-sized content", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code } = await run([
      path,
      "write",
      "1:1-2:3",
      "--clip",
      "--",
      "XXXXX\nYYYYY\nZZZZZ",
    ]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("XXXde\nYYYij\nklmno\n");
  });

  test("write with --clip + --fill combined handles both directions", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code } = await run([
      path,
      "write",
      "1:1-2:3",
      "--clip",
      "--fill=.",
      "--",
      "XX",
    ]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("XX.de\n...ij\nklmno\n");
  });

  test("write without --clip errors on over-sized content", async () => {
    const path = await makeFile("grid.txt", "abcde\n");
    const { code, stderr } = await run([
      path,
      "write",
      "1:1-1:3",
      "--",
      "TOOLONG",
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/expected 3|max 3/);
  });

  test("write extends rows down", async () => {
    const path = await makeFile("grid.txt", "abcde\n");
    const { code } = await run([
      path,
      "write",
      "2:1-3:5",
      "--",
      "fghij\nklmno",
    ]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("abcde\nfghij\nklmno\n");
  });

  test("write extends cols right when covering full height", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code } = await run([path, "write", "1:4-2:5", "--", "XY\nZW"]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("abcXY\ndefZW\n");
  });

  test("write causing non-rectangular result exits nonzero and leaves file untouched", async () => {
    const original = "abc\ndef\n";
    const path = await makeFile("grid.txt", original);
    const { code, stderr } = await run([path, "write", "1:4-1:5", "--", "XY"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/rectangular/);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  test("write with omitted range positions exits nonzero", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code, stderr } = await run([
      path,
      "write",
      "1:1-:",
      "--",
      "XYZ\nPQR",
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Omitted/);
  });

  test("write with non-ASCII content exits nonzero", async () => {
    const path = await makeFile("grid.txt", "abc\n");
    const { code, stderr } = await run([
      path,
      "write",
      "1:1-1:3",
      "--",
      "ab\t",
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Non-printable/);
  });

  test("write content from stdin (no '--')", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code } = await run([path, "write", "1:1-2:3"], "XYZ\nPQR\n");
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("XYZ\nPQR\n");
  });

  test("write with --fill and no content fills the whole range", async () => {
    const path = join(workDir, "canvas.txt");
    const { code } = await run([path, "write", "1:1-3:5", "--fill= "]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("     \n     \n     \n");
  });

  test("write with multi-char --fill tiles pattern across the range", async () => {
    const path = join(workDir, "canvas.txt");
    const { code } = await run([path, "write", "1:1-1:10", "--fill=-- "]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("-- -- -- -\n");
  });

  test("write with space-separated --fill 'PATTERN' accepts values starting with dash", async () => {
    const path = join(workDir, "canvas.txt");
    const { code } = await run([path, "write", "1:1-1:20", "--fill", "-- "]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("-- -- -- -- -- -- --\n");
  });

  test("write with space-separated --fill ' ' still works", async () => {
    const path = join(workDir, "canvas.txt");
    const { code } = await run([path, "write", "1:1-1:5", "--fill", " "]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("     \n");
  });

  test("write with multi-char --fill and content keeps pattern phase from range's left edge", async () => {
    const path = join(workDir, "canvas.txt");
    const { code } = await run([
      path,
      "write",
      "1:1-1:6",
      "--fill=-- ",
      "--",
      "X",
    ]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("X- -- \n");
  });

  test("write with --fill extends an existing file to a larger rectangle", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code } = await run([path, "write", "1:4-2:6", "--fill=."]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("abc...\ndef...\n");
  });

  test("write with --fill and no content still errors when result would not be rectangular", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code, stderr } = await run([path, "write", "3:1-4:5", "--fill=."]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/rectangular/);
  });

  test("write with no content and no --fill exits nonzero", async () => {
    const path = join(workDir, "canvas.txt");
    const { code } = await run([path, "write", "1:1-3:5"]);
    expect(code).not.toBe(0);
  });

  test("write creates the file if it does not exist", async () => {
    const path = join(workDir, "new.txt");
    const { code } = await run([path, "write", "1:1-2:3", "--", "abc\ndef"]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("abc\ndef\n");
  });

  test("roundtrip: write then read returns same content", async () => {
    const path = await makeFile("grid.txt", "....\n....\n....\n....\n");
    await run([path, "write", "2:2-3:3", "--", "AB\nCD"]);
    const { code, stdout } = await run([path, "read", "2:2-3:3"]);
    expect(code).toBe(0);
    expect(stdout).toBe("AB\nCD\n");
    expect(await readFile(path, "utf8")).toBe("....\n.AB.\n.CD.\n....\n");
  });
});
