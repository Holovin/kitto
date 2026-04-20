import { createQueryManager, createStore, evaluate, evaluateElementProps } from '@openuidev/lang-core';
import { createParser, type OpenUIError } from '@openuidev/react-lang';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { ACTION_MODE_LAST_CHOICE_STATE } from '@features/builder/openui/library/components/shared';
import { createDomainToolProvider } from '@features/builder/openui/runtime/createDomainToolProvider';
import { mapOpenUiErrorsToIssues } from '@features/builder/openui/runtime/issues';
import { ELEMENT_DEMO_DEFINITIONS } from '@pages/Elements/elementDemos';

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
type ActionPlan = { steps: ActionStep[] };

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

  function getElementAction(
    typeName: OpenUiElementNode['typeName'],
    predicate: (node: OpenUiElementNode) => boolean,
    missingActionMessage: string,
  ): ActionPlan {
    let action: ActionPlan | null = null;

    visitElements(getEvaluatedRoot(), (node) => {
      if (node.typeName === typeName && predicate(node) && node.props.action && typeof node.props.action === 'object') {
        action = node.props.action as ActionPlan;
      }
    });

    expect(action).not.toBeNull();
    if (!action) {
      throw new Error(missingActionMessage);
    }

    return action;
  }

  async function runAction(action: ActionPlan) {
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
  }

  let checkboxActionQueue: Promise<void> = Promise.resolve();
  let choiceActionQueue: Promise<void> = Promise.resolve();

  return {
    async clickButton(buttonId: string) {
      await runAction(
        getElementAction('Button', (node) => node.props.id === buttonId, `Button "${buttonId}" action was not found.`),
      );
    },
    async clickCheckbox(checkboxName: string) {
      const action = getElementAction(
        'Checkbox',
        (node) => node.props.name === checkboxName,
        `Checkbox "${checkboxName}" action was not found.`,
      );
      const nextAction = checkboxActionQueue.then(() => runAction(action), () => runAction(action));

      checkboxActionQueue = nextAction.catch(() => undefined);
      await nextAction;
    },
    async chooseRadioGroupValue(radioGroupName: string, nextValue: string) {
      const action = getElementAction(
        'RadioGroup',
        (node) => node.props.name === radioGroupName,
        `RadioGroup "${radioGroupName}" action was not found.`,
      );
      const nextAction = choiceActionQueue.then(
        () => {
          store.set(ACTION_MODE_LAST_CHOICE_STATE, nextValue);
          return runAction(action);
        },
        () => {
          store.set(ACTION_MODE_LAST_CHOICE_STATE, nextValue);
          return runAction(action);
        },
      );

      choiceActionQueue = nextAction.catch(() => undefined);
      await nextAction;
    },
    async chooseSelectValue(selectName: string, nextValue: string) {
      const action = getElementAction(
        'Select',
        (node) => node.props.name === selectName,
        `Select "${selectName}" action was not found.`,
      );
      const nextAction = choiceActionQueue.then(
        () => {
          store.set(ACTION_MODE_LAST_CHOICE_STATE, nextValue);
          return runAction(action);
        },
        () => {
          store.set(ACTION_MODE_LAST_CHOICE_STATE, nextValue);
          return runAction(action);
        },
      );

      choiceActionQueue = nextAction.catch(() => undefined);
      await nextAction;
    },
    getBinding(name: string) {
      return unwrapFieldValue(store.get(name));
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
    getCheckboxChecked(checkboxName: string) {
      let checkedValue: boolean | undefined;

      visitElements(getEvaluatedRoot(), (node) => {
        if (node.typeName === 'Checkbox' && node.props.name === checkboxName && typeof node.props.checked === 'boolean') {
          checkedValue = node.props.checked;
        }
      });

      if (typeof checkedValue !== 'boolean') {
        throw new Error(`Checkbox "${checkboxName}" checked state was not found.`);
      }

      return checkedValue;
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

  it('keeps the /elements Repeater demo in sync after append_item then toggle_item_field', async () => {
    const repeaterDemo = ELEMENT_DEMO_DEFINITIONS.Repeater;
    const harness = await createMutationRefreshHarness(repeaterDemo.source, repeaterDemo.initialDomainData);

    harness.setBinding('$draft', 'Smoke row');
    await harness.clickButton('append-item');

    const savedItemsAfterAppend = harness.getQueryResult('savedItems') as Array<Record<string, unknown>>;
    const appendedItem = savedItemsAfterAppend.find((item) => item.label === 'Smoke row');

    expect(appendedItem).toBeDefined();
    expect(appendedItem).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        completed: false,
        label: 'Smoke row',
      }),
    );
    expect(harness.getTextValues()).toContain('Smoke row');
    expect(harness.getTextValues().filter((value) => value === 'Done')).toHaveLength(1);

    await harness.clickButton(`toggle-${appendedItem?.id as string}`);

    expect(harness.getDomainData()).toEqual({
      demo: {
        savedItems: expect.arrayContaining([
          expect.objectContaining({
            id: appendedItem?.id,
            completed: true,
            label: 'Smoke row',
          }),
        ]),
      },
    });
    expect(harness.getQueryResult('savedItems')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: appendedItem?.id,
          completed: true,
          label: 'Smoke row',
        }),
      ]),
    );
    expect(harness.getTextValues().filter((value) => value === 'Done')).toHaveLength(2);
  });

  it('keeps the /elements Checkbox demo in sync after an action-mode toggle_item_field mutation', async () => {
    const checkboxDemo = ELEMENT_DEMO_DEFINITIONS.Checkbox;
    const harness = await createMutationRefreshHarness(checkboxDemo.source, checkboxDemo.initialDomainData);

    expect(harness.getCheckboxChecked('toggle-checkbox-a')).toBe(false);

    await harness.clickCheckbox('toggle-checkbox-a');

    expect(harness.getDomainData()).toEqual({
      demo: {
        checkboxItems: expect.arrayContaining([
          expect.objectContaining({
            id: 'checkbox-a',
            completed: true,
            label: 'Draft tests',
          }),
        ]),
      },
    });
    expect(harness.getQueryResult('savedItems')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'checkbox-a',
          completed: true,
          label: 'Draft tests',
        }),
      ]),
    );
    expect(harness.getCheckboxChecked('toggle-checkbox-a')).toBe(true);
    expect(harness.getTextValues().filter((value) => value === 'Done')).toHaveLength(1);
  });

  it('keeps checkbox row toggles isolated across rapid action-mode clicks on different rows', async () => {
    const checkboxDemo = ELEMENT_DEMO_DEFINITIONS.Checkbox;
    const harness = await createMutationRefreshHarness(checkboxDemo.source, checkboxDemo.initialDomainData);
    const rowIds = ['checkbox-a', 'checkbox-b', 'checkbox-c', 'checkbox-d', 'checkbox-e'];

    await Promise.all(rowIds.map((rowId) => harness.clickCheckbox(`toggle-${rowId}`)));

    expect(harness.getQueryResult('savedItems')).toEqual(
      expect.arrayContaining(
        rowIds.map((rowId) =>
          expect.objectContaining({
            id: rowId,
            completed: true,
          }),
        ),
      ),
    );
    expect(harness.getDomainData()).toEqual({
      demo: {
        checkboxItems: expect.arrayContaining(
          rowIds.map((rowId) =>
            expect.objectContaining({
              id: rowId,
              completed: true,
            }),
          ),
        ),
      },
    });
    expect(rowIds.map((rowId) => harness.getCheckboxChecked(`toggle-${rowId}`))).toEqual([true, true, true, true, true]);
  });

  it('keeps the /elements Select demo in sync after an action-mode write_state mutation fed by $lastChoice', async () => {
    const selectDemo = ELEMENT_DEMO_DEFINITIONS.Select;
    const harness = await createMutationRefreshHarness(selectDemo.source, selectDemo.initialDomainData);

    expect(harness.getQueryResult('savedFilter')).toBe('all');

    await harness.chooseSelectValue('saved-filter', 'completed');

    expect(harness.getBinding(ACTION_MODE_LAST_CHOICE_STATE)).toBe('completed');
    expect(harness.getDomainData()).toEqual({
      demo: {
        selectUi: {
          filter: 'completed',
        },
      },
    });
    expect(harness.getQueryResult('savedFilter')).toBe('completed');
    expect(harness.getTextValues()).toContain('Persisted filter: completed');
    expect(harness.getTextValues()).toContain('Run tests');
    expect(harness.getTextValues()).not.toContain('Draft spec');
    expect(harness.getTextValues()).not.toContain('Update docs');
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
