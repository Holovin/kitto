import { createQueryManager, createStore, evaluate, evaluateElementProps } from '@openuidev/lang-core';
import { createParser, type OpenUIError } from '@openuidev/react-lang';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { createDomainToolProvider } from '@features/builder/openui/runtime/createDomainToolProvider';
import { mapOpenUiErrorsToIssues } from '@features/builder/openui/runtime/issues';

type OpenUiElementNode = {
  props: Record<string, unknown>;
  type: 'element';
  typeName: string;
};

type ActionStep =
  | {
      refType: 'mutation' | 'query';
      statementId: string;
      type: 'run';
    }
  | {
      target: string;
      type: 'set';
      valueAST: unknown;
    }
  | {
      targets: string[];
      type: 'reset';
    };

const parser = createParser(builderOpenUiLibrary.toJSONSchema());

function unwrapFieldValue(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    return (value as { value: unknown }).value;
  }

  return value;
}

function isElementNode(value: unknown): value is OpenUiElementNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'element' &&
    'typeName' in value &&
    typeof value.typeName === 'string' &&
    'props' in value &&
    typeof value.props === 'object' &&
    value.props !== null
  );
}

function visitElements(value: unknown, callback: (node: OpenUiElementNode) => void) {
  if (Array.isArray(value)) {
    value.forEach((entry) => visitElements(entry, callback));
    return;
  }

  if (isElementNode(value)) {
    callback(value);
    Object.values(value.props).forEach((entry) => visitElements(entry, callback));
    return;
  }

  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((entry) => visitElements(entry, callback));
  }
}

async function waitForQuerySettles(queryManager: ReturnType<typeof createQueryManager>) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));

    if ((queryManager.getSnapshot().__openui_loading as string[]).length === 0) {
      return;
    }
  }

  throw new Error('Timed out waiting for query refresh.');
}

async function createMutationRefreshHarness(source: string, initialDomainData: Record<string, unknown> = {}) {
  const parseResult = parser.parse(source);

  expect(parseResult.meta.errors).toEqual([]);
  expect(parseResult.root).toBeTruthy();

  let domainData = structuredClone(initialDomainData);
  const store = createStore();
  const toolProviderMap = createDomainToolProvider({
    readDomainData: () => domainData,
    replaceDomainData: (nextData) => {
      domainData = structuredClone(nextData);
    },
  });
  const queryManager = createQueryManager({
    callTool: async (toolName: string, args: Record<string, unknown>) => {
      const tool = toolProviderMap[toolName as keyof typeof toolProviderMap];

      if (!tool) {
        throw new Error(`Unknown tool "${toolName}".`);
      }

      return tool(args);
    },
  });
  const evaluationContext = {
    getState: (name: string) => unwrapFieldValue(store.get(name)),
    resolveRef: (name: string) => queryManager.getMutationResult(name) ?? queryManager.getResult(name),
  };

  store.initialize(parseResult.stateDeclarations ?? {}, {});
  queryManager.activate();
  queryManager.evaluateQueries(
    parseResult.queryStatements.map((query) => ({
      statementId: query.statementId,
      toolName: query.toolAST ? (evaluate(query.toolAST, evaluationContext) as string) : '',
      args: query.argsAST ? evaluate(query.argsAST, evaluationContext) : null,
      defaults: query.defaultsAST ? evaluate(query.defaultsAST, evaluationContext) : null,
      refreshInterval: query.refreshAST ? (evaluate(query.refreshAST, evaluationContext) as number) : undefined,
      complete: query.complete,
      deps: undefined,
    })),
  );
  queryManager.registerMutations(
    parseResult.mutationStatements.map((mutation) => ({
      statementId: mutation.statementId,
      toolName: mutation.toolAST ? (evaluate(mutation.toolAST, evaluationContext) as string) : '',
    })),
  );
  await waitForQuerySettles(queryManager);

  function getEvaluatedRoot() {
    const errors: OpenUIError[] = [];
    const evaluatedRoot = evaluateElementProps(parseResult.root as never, {
      ctx: evaluationContext,
      library: builderOpenUiLibrary,
      store,
      errors,
    });

    expect(errors).toEqual([]);
    return evaluatedRoot;
  }

  function getButtonAction(buttonId: string): { steps: ActionStep[] } {
    let action: { steps: ActionStep[] } | null = null;

    visitElements(getEvaluatedRoot(), (node) => {
      if (node.typeName === 'Button' && node.props.id === buttonId && node.props.action && typeof node.props.action === 'object') {
        action = node.props.action as { steps: ActionStep[] };
      }
    });

    expect(action).not.toBeNull();
    if (!action) {
      throw new Error(`Button "${buttonId}" action was not found.`);
    }

    return action;
  }

  return {
    async clickButton(buttonId: string) {
      const action = getButtonAction(buttonId);

      for (const step of action.steps) {
        if (step.type === 'run') {
          if (step.refType === 'mutation') {
            const mutation = parseResult.mutationStatements.find((entry) => entry.statementId === step.statementId);
            const evaluatedArgs = mutation?.argsAST ? (evaluate(mutation.argsAST, evaluationContext) as Record<string, unknown>) : {};
            const didSucceed = await queryManager.fireMutation(step.statementId, evaluatedArgs);

            if (!didSucceed) {
              return;
            }

            continue;
          }

          queryManager.invalidate([step.statementId]);
          continue;
        }

        if (step.type === 'set') {
          store.set(step.target, evaluate(step.valueAST as never, evaluationContext));
          continue;
        }

        if (step.type === 'reset') {
          for (const target of step.targets) {
            store.set(target, parseResult.stateDeclarations?.[target] ?? null);
          }
        }
      }

      await waitForQuerySettles(queryManager);
    },
    getCheckboxLabels() {
      const labels: string[] = [];

      visitElements(getEvaluatedRoot(), (node) => {
        if (node.typeName === 'Checkbox' && typeof node.props.label === 'string') {
          labels.push(node.props.label);
        }
      });

      return labels;
    },
    getDomainData() {
      return structuredClone(domainData);
    },
    getQueryResult(statementId: string) {
      return queryManager.getResult(statementId);
    },
    getRuntimeIssues() {
      return mapOpenUiErrorsToIssues(queryManager.getSnapshot().__openui_errors);
    },
    getTextValues() {
      const values: Array<string | number | boolean | null | undefined> = [];

      visitElements(getEvaluatedRoot(), (node) => {
        if (node.typeName === 'Text') {
          values.push(node.props.value as string | number | boolean | null | undefined);
        }
      });

      return values;
    },
    setBinding(name: string, value: unknown) {
      store.set(name, value);
    },
  };
}

describe('mutation to query refresh behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates a visible repeater after append_state reruns the matching read_state query', async () => {
    const harness = await createMutationRefreshHarness(`$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Input("draft", "Task", $draft, "New task"),
    Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == ""),
    Repeater(rows, "No items yet.")
  ])
])`);

    harness.setBinding('$draft', 'Ship fix');
    await harness.clickButton('add-task');

    expect(harness.getDomainData()).toEqual({
      app: {
        items: [{ title: 'Ship fix', completed: false }],
      },
    });
    expect(harness.getQueryResult('items')).toEqual([{ title: 'Ship fix', completed: false }]);
    expect(harness.getTextValues()).toContain('Ship fix');
    expect(harness.getTextValues()).toContain('Open');
  });

  it('updates a visible text after write_computed_state reruns the matching read_state query', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.49);

    const harness = await createMutationRefreshHarness(`rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 100 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

root = AppShell([
  Screen("main", "Dice", [
    Button("roll-button", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false),
    Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
  ])
])`);

    await harness.clickButton('roll-button');

    expect(harness.getDomainData()).toEqual({
      app: {
        roll: 50,
      },
    });
    expect(harness.getQueryResult('rollValue')).toBe(50);
    expect(harness.getTextValues()).toContain('Rolled: 50');
  });

  it('reproduces stale UI when the mutation runs without rerunning the matching read_state query', async () => {
    const harness = await createMutationRefreshHarness(`$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Input("draft", "Task", $draft, "New task"),
    Button("add-task", "Add", "default", Action([@Run(addItem), @Reset($draft)]), $draft == ""),
    Repeater(rows, "No items yet.")
  ])
])`);

    harness.setBinding('$draft', 'Stale item');
    await harness.clickButton('add-task');

    expect(harness.getDomainData()).toEqual({
      app: {
        items: [{ title: 'Stale item', completed: false }],
      },
    });
    expect(harness.getQueryResult('items')).not.toEqual([{ title: 'Stale item', completed: false }]);
    expect(harness.getTextValues()).not.toContain('Stale item');
  });

  it('surfaces mutation tool failures as runtime issues', async () => {
    const harness = await createMutationRefreshHarness(`items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "   ",
  value: { title: "Broken", completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items)]), false),
    Repeater(rows, "No items yet.")
  ])
])`);

    await harness.clickButton('add-task');

    expect(harness.getRuntimeIssues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'tool-error',
          message: 'Mutation "append_state" failed: append_state: State path must be a non-empty dot-path.',
          source: 'mutation',
          statementId: 'addItem',
        }),
      ]),
    );
  });
});
