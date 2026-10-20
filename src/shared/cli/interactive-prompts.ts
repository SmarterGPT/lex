/** Internal CLI prompt flows; prompt dependencies are injectable without opening a TTY in tests. */
import input from "@inquirer/input";
import confirm from "@inquirer/confirm";
import type { RememberOptions } from "./remember.js";

type InputPrompt = (configuration: Parameters<typeof input>[0]) => Promise<string>;
type ConfirmPrompt = (configuration: Parameters<typeof confirm>[0]) => Promise<boolean>;

export interface PromptDependencies {
  input: InputPrompt;
  confirm: ConfirmPrompt;
}

const defaultPrompts: PromptDependencies = { input, confirm };

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseOptionalCommaSeparated(value: string): string[] | undefined {
  return value.trim() ? parseCommaSeparated(value) : undefined;
}

/** Ask for the onboarding summary only after confirmation; callers retain their error handling. */
export async function promptForFirstFrameSummary(
  prompts: PromptDependencies = defaultPrompts
): Promise<string | undefined> {
  const createFirstFrame = await prompts.confirm({
    message: "Would you like to create your first Frame to test Lex?",
    default: false,
  });
  if (!createFirstFrame) return undefined;

  return prompts.input({
    message: "What are you working on?",
    validate: (value) => value.trim().length > 0 || "Please provide a summary",
  });
}

/** Prompt in the existing order, preserving explicit options and optional empty-field defaults. */
export async function promptForFrameData(
  options: RememberOptions,
  prompts: Pick<PromptDependencies, "input"> = defaultPrompts
): Promise<RememberOptions> {
  const answers: RememberOptions = {};
  const fullInteractive = options.interactive;

  if (fullInteractive && !options.jira) {
    answers.jira = await prompts.input({ message: "Jira ticket (optional):" });
  }
  if (!options.referencePoint) {
    answers.referencePoint = await prompts.input({
      message: "Reference point (memorable phrase, optional):",
      default: "",
    });
  }
  if (!options.summary) {
    answers.summary = await prompts.input({
      message: "Summary (one-line description):",
      validate: (value) => value.trim().length > 0 || "Summary is required",
    });
  }
  if (!options.next) {
    answers.next = await prompts.input({ message: "Next action (optional):", default: "" });
  }
  if (!options.modules) {
    const modules = await prompts.input({
      message: "Module scope (comma-separated):",
      validate: (value) =>
        parseCommaSeparated(value).length > 0 || "At least one module is required",
    });
    answers.modules = parseCommaSeparated(modules);
  }
  if (fullInteractive && !options.blockers) {
    answers.blockers = parseOptionalCommaSeparated(
      await prompts.input({ message: "Blockers (comma-separated, optional):" })
    );
  }
  if (fullInteractive && !options.mergeBlockers) {
    answers.mergeBlockers = parseOptionalCommaSeparated(
      await prompts.input({ message: "Merge blockers (comma-separated, optional):" })
    );
  }

  // Commander includes absent flags as explicit undefined properties. They are not supplied answers.
  const providedOptions = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  ) as RememberOptions;
  return { ...answers, ...providedOptions };
}
