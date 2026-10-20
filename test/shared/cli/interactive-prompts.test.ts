import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  promptForFirstFrameSummary,
  promptForFrameData,
  type PromptDependencies,
} from "../../../src/shared/cli/interactive-prompts.js";

type InputConfiguration = Parameters<PromptDependencies["input"]>[0];

function scriptedInputs(values: string[]): {
  prompts: Pick<PromptDependencies, "input">;
  configurations: InputConfiguration[];
} {
  const configurations: InputConfiguration[] = [];
  return {
    configurations,
    prompts: {
      input: async (configuration) => {
        configurations.push(configuration);
        assert.ok(configurations.length <= values.length, "Unexpected extra input prompt");
        return values[configurations.length - 1];
      },
    },
  };
}

test("onboarding declines by default without asking for a summary", async () => {
  let confirmations = 0;
  const summary = await promptForFirstFrameSummary({
    confirm: async (configuration) => {
      confirmations++;
      assert.equal(configuration.default, false);
      assert.equal(configuration.message, "Would you like to create your first Frame to test Lex?");
      return false;
    },
    input: async () => assert.fail("Declining must not ask for a summary"),
  });
  assert.equal(confirmations, 1);
  assert.equal(summary, undefined);
});

test("onboarding asks for a validated summary only after confirmation", async () => {
  const calls: string[] = [];
  const summary = await promptForFirstFrameSummary({
    confirm: async () => {
      calls.push("confirm");
      return true;
    },
    input: async (configuration) => {
      calls.push("input");
      assert.equal(configuration.message, "What are you working on?");
      assert.equal(await configuration.validate?.("  "), "Please provide a summary");
      assert.equal(await configuration.validate?.("Work summary"), true);
      return "  Work summary  ";
    },
  });
  assert.deepEqual(calls, ["confirm", "input"]);
  assert.equal(summary, "  Work summary  ");
});

for (const stage of ["confirm", "input"] as const) {
  test(`onboarding propagates cancellation from ${stage} to the init handler`, async () => {
    const cancellation = new Error("User force closed the prompt");
    cancellation.name = "ExitPromptError";
    let inputs = 0;
    await assert.rejects(
      promptForFirstFrameSummary({
        confirm: async () => {
          if (stage === "confirm") throw cancellation;
          return true;
        },
        input: async () => {
          inputs++;
          throw cancellation;
        },
      }),
      (error) => error === cancellation
    );
    assert.equal(inputs, stage === "input" ? 1 : 0);
  });
}

test("remember keeps prompt order, validates raw required input and parses module CSV", async () => {
  const { prompts, configurations } = scriptedInputs([
    "",
    "  Summary  ",
    "",
    " cli, ,memory/store, ",
  ]);
  const result = await promptForFrameData({}, prompts);
  assert.deepEqual(
    configurations.map((configuration) => configuration.message),
    [
      "Reference point (memorable phrase, optional):",
      "Summary (one-line description):",
      "Next action (optional):",
      "Module scope (comma-separated):",
    ]
  );
  assert.equal(configurations[0].default, "");
  assert.equal(configurations[2].default, "");
  assert.equal(await configurations[1].validate?.(" "), "Summary is required");
  assert.equal(await configurations[1].validate?.("Summary"), true);
  assert.equal(await configurations[3].validate?.(" , , "), "At least one module is required");
  assert.equal(await configurations[3].validate?.(" ,cli, "), true);
  assert.deepEqual(result, {
    referencePoint: "",
    summary: "  Summary  ",
    next: "",
    modules: ["cli", "memory/store"],
  });
});

test("remember full interaction asks optional fields and preserves empty CSV semantics", async () => {
  const { prompts, configurations } = scriptedInputs([
    "LEX-123",
    "memorable",
    "Summary",
    "Next",
    "cli",
    "  ",
    " release, , CI ",
  ]);
  const result = await promptForFrameData({ interactive: true }, prompts);
  assert.deepEqual(
    configurations.map((configuration) => configuration.message),
    [
      "Jira ticket (optional):",
      "Reference point (memorable phrase, optional):",
      "Summary (one-line description):",
      "Next action (optional):",
      "Module scope (comma-separated):",
      "Blockers (comma-separated, optional):",
      "Merge blockers (comma-separated, optional):",
    ]
  );
  assert.deepEqual(result, {
    interactive: true,
    jira: "LEX-123",
    referencePoint: "memorable",
    summary: "Summary",
    next: "Next",
    modules: ["cli"],
    blockers: undefined,
    mergeBlockers: ["release", "CI"],
  });
});

test("remember preserves provided options and skips their prompts", async () => {
  const options = {
    interactive: true,
    jira: "LEX-123",
    referencePoint: "provided reference",
    summary: "Provided summary",
    next: "Provided next",
    modules: ["cli"],
    blockers: [],
    mergeBlockers: ["release"],
    testsFailing: ["existing test"],
    keywords: ["hardening"],
    permissions: ["historical metadata"],
  };
  const result = await promptForFrameData(options, {
    input: async () => assert.fail("Provided fields must not be prompted again"),
  });
  assert.deepEqual(result, options);
});

test("remember partial flags remain authoritative while unprovided fields are prompted", async () => {
  const { prompts, configurations } = scriptedInputs(["reference", "next"]);
  const result = await promptForFrameData({ summary: "Provided", modules: ["cli"] }, prompts);
  assert.deepEqual(
    configurations.map((configuration) => configuration.message),
    ["Reference point (memorable phrase, optional):", "Next action (optional):"]
  );
  assert.deepEqual(result, {
    referencePoint: "reference",
    next: "next",
    summary: "Provided",
    modules: ["cli"],
  });
});

test("remember retains prompted answers when absent CLI flags are explicitly undefined", async () => {
  const { prompts } = scriptedInputs(["reference", "Summary", "Next", "cli"]);
  const result = await promptForFrameData(
    {
      jira: undefined,
      referencePoint: undefined,
      summary: undefined,
      next: undefined,
      modules: undefined,
      blockers: undefined,
      interactive: false,
      json: false,
    },
    prompts
  );
  assert.deepEqual(result, {
    referencePoint: "reference",
    summary: "Summary",
    next: "Next",
    modules: ["cli"],
    interactive: false,
    json: false,
  });
});

test("remember preserves explicitly supplied empty values when merging answers", async () => {
  const { prompts } = scriptedInputs(["suggested reference", "suggested next"]);
  const result = await promptForFrameData(
    {
      summary: "Provided",
      modules: ["cli"],
      referencePoint: "",
      next: "",
      interactive: false,
    },
    prompts
  );
  assert.equal(result.referencePoint, "");
  assert.equal(result.next, "");
  assert.equal(result.interactive, false);
});

for (const name of ["ExitPromptError", "AbortPromptError", "Error"]) {
  test(`remember propagates ${name} without asking subsequent questions`, async () => {
    const failure = new Error("Prompt interrupted or input closed");
    failure.name = name;
    let count = 0;
    await assert.rejects(
      promptForFrameData(
        {},
        {
          input: async () => {
            count++;
            throw failure;
          },
        }
      ),
      (error) => error === failure
    );
    assert.equal(count, 1);
  });
}

/** Each integration probe is hard-bounded and mocks both packages before source import: no real TTY. */
function runPromptProbe(body: string): Record<string, unknown> {
  const source = `
    import { mock } from "node:test";
    import { mkdtempSync, rmSync } from "node:fs";
    import { join } from "node:path";
    import { tmpdir } from "node:os";
    let promptCalls = 0;
    const cancellation = new Error("User force closed the prompt");
    cancellation.name = "ExitPromptError";
    let inputAnswers;
    const inputPrompt = async () => {
      promptCalls++;
      if (inputAnswers?.length) return inputAnswers.shift();
      throw cancellation;
    };
    const unexpectedPrompt = async () => { promptCalls++; throw cancellation; };
    mock.module("@inquirer/input", { defaultExport: inputPrompt });
    mock.module("@inquirer/confirm", { defaultExport: unexpectedPrompt });
    const { remember } = await import("./src/shared/cli/remember.ts");
    const { init } = await import("./src/shared/cli/init.ts");
    const { createProgram } = await import("./src/shared/cli/index.ts");
    const { MemoryFrameStore } = await import("./src/memory/store/memory/index.ts");
    const errors = [];
    console.log = () => {};
    console.error = (...values) => errors.push(values.map(String).join(" "));
    const originalCwd = process.cwd();
    const directory = mkdtempSync(join(tmpdir(), "lex-prompt-probe-"));
    try {
      process.chdir(directory);
      ${body}
    } finally {
      process.chdir(originalCwd);
      rmSync(directory, { recursive: true, force: true });
      process.exitCode = 0;
    }
  `;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--import",
      "./test/helpers/setup.ts",
      "--input-type=module",
      "--eval",
      source,
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("interactive remember routes actual absent CLI flags into the collected frame", () => {
  const result = runPromptProbe(`
    inputAnswers = ["LEX-123", "reference", "Summary", "Next", "workspace/unscoped", "", ""];
    const store = new MemoryFrameStore();
    const program = createProgram({ frameStore: store });
    await program.parseAsync(["node", "lex", "remember", "--interactive", "--skip-policy"]);
    const frame = (await store.listFrames({ limit: 1 })).frames[0];
    process.stdout.write(JSON.stringify({ promptCalls, frames: store.size(), summary: frame?.summary_caption, modules: frame?.module_scope, next: frame?.status_snapshot.next_action, code: process.exitCode ?? null, errors }));
  `);
  const { errors, ...frameResult } = result;
  assert.match(JSON.stringify(errors), /Module validation skipped/);
  assert.deepEqual(frameResult, {
    promptCalls: 7,
    frames: 1,
    summary: "Summary",
    modules: ["workspace/unscoped"],
    next: "Next",
    code: null,
  });
});

test("remember --json --interactive stores complete flags without opening prompts", () => {
  const result = runPromptProbe(`
    const store = new MemoryFrameStore();
    await remember({ json: true, interactive: true, summary: "Summary", modules: ["workspace/unscoped"], noPolicy: true }, store);
    process.stdout.write(JSON.stringify({ promptCalls, frames: store.size(), code: process.exitCode ?? null, errors }));
  `);
  assert.deepEqual(result, { promptCalls: 0, frames: 1, code: null, errors: [] });
});

test("remember --json --interactive reports missing required flags without prompting or writing", () => {
  const result = runPromptProbe(`
    const store = new MemoryFrameStore();
    await remember({ json: true, interactive: true, noPolicy: true }, store);
    process.stdout.write(JSON.stringify({ promptCalls, frames: store.size(), code: process.exitCode, errors }));
  `);
  assert.equal(result.promptCalls, 0);
  assert.equal(result.frames, 0);
  assert.equal(result.code, 1);
  assert.match(JSON.stringify(result.errors), /MISSING_REQUIRED_PARAMS/);
});

test("remember cancellation preserves the existing error exit and writes no frame", () => {
  const result = runPromptProbe(`
    const store = new MemoryFrameStore();
    await remember({ interactive: true, noPolicy: true }, store);
    process.stdout.write(JSON.stringify({ promptCalls, frames: store.size(), code: process.exitCode, errors }));
  `);
  assert.equal(result.promptCalls, 1);
  assert.equal(result.frames, 0);
  assert.equal(result.code, 2);
  assert.match(JSON.stringify(result.errors), /User force closed the prompt/);
});

test("init keeps JSON and --yes noninteractive even with --interactive", () => {
  const result = runPromptProbe(`
    const jsonResult = await init({ interactive: true, json: true });
    const yesResult = await init({ interactive: true, yes: true });
    process.stdout.write(JSON.stringify({ promptCalls, jsonSuccess: jsonResult.success, yesSuccess: yesResult.success }));
  `);
  assert.deepEqual(result, { promptCalls: 0, jsonSuccess: true, yesSuccess: true });
});

test("init gracefully completes bootstrap after onboarding cancellation", () => {
  const result = runPromptProbe(`
    const initialized = await init({ interactive: true });
    process.stdout.write(JSON.stringify({ promptCalls, success: initialized.success }));
  `);
  assert.deepEqual(result, { promptCalls: 1, success: true });
});
