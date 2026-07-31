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

  test("rejects multi-char fill", () => {
    const grid = parseGrid("abc\n");
    expect(() =>
      writeSlice(grid, { r1: 1, c1: 1, r2: 1, c2: 3 }, "X", ".."),
    ).toThrow(/one character/);
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

  test("write exact-shape persists to disk", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code } = await run([path, "write", "2:2-3:4", "XYZ\nPQR"]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("abcde\nfXYZj\nkPQRo\n");
  });

  test("write with --fill pads and persists", async () => {
    const path = await makeFile("grid.txt", "abcde\nfghij\nklmno\n");
    const { code } = await run([path, "write", "1:1-3:3", "X\nYY", "--fill=."]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("X..de\nYY.ij\n...no\n");
  });

  test("write extends rows down", async () => {
    const path = await makeFile("grid.txt", "abcde\n");
    const { code } = await run([path, "write", "2:1-3:5", "fghij\nklmno"]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("abcde\nfghij\nklmno\n");
  });

  test("write extends cols right when covering full height", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code } = await run([path, "write", "1:4-2:5", "XY\nZW"]);
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("abcXY\ndefZW\n");
  });

  test("write causing non-rectangular result exits nonzero and leaves file untouched", async () => {
    const original = "abc\ndef\n";
    const path = await makeFile("grid.txt", original);
    const { code, stderr } = await run([path, "write", "1:4-1:5", "XY"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/rectangular/);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  test("write with omitted range positions exits nonzero", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code, stderr } = await run([path, "write", "1:1-:", "XYZ\nPQR"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Omitted/);
  });

  test("write with non-ASCII content exits nonzero", async () => {
    const path = await makeFile("grid.txt", "abc\n");
    const { code, stderr } = await run([path, "write", "1:1-1:3", "ab\t"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Non-printable/);
  });

  test("write content from stdin (content arg omitted)", async () => {
    const path = await makeFile("grid.txt", "abc\ndef\n");
    const { code } = await run([path, "write", "1:1-2:3"], "XYZ\nPQR\n");
    expect(code).toBe(0);
    expect(await readFile(path, "utf8")).toBe("XYZ\nPQR\n");
  });

  test("roundtrip: write then read returns same content", async () => {
    const path = await makeFile("grid.txt", "....\n....\n....\n....\n");
    await run([path, "write", "2:2-3:3", "AB\nCD"]);
    const { code, stdout } = await run([path, "read", "2:2-3:3"]);
    expect(code).toBe(0);
    expect(stdout).toBe("AB\nCD\n");
    expect(await readFile(path, "utf8")).toBe("....\n.AB.\n.CD.\n....\n");
  });
});
