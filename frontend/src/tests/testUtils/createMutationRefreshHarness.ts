import { createQueryManager, createStore, evaluate, evaluateElementProps } from '@openuidev/lang-core';
import { createParser, type OpenUIError } from '@openuidev/react-lang';
import { expect } from 'vitest';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { ACTION_MODE_LAST_CHOICE_STATE } from '@features/builder/openui/library/components/shared';
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

type ActionPlan = { steps: ActionStep[] };

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

export async function createMutationRefreshHarness(source: string, initialDomainData: Record<string, unknown> = {}) {
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
    getBinding(name: string) {
      return unwrapFieldValue(store.get(name));
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
