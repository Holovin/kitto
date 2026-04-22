import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION_MODE_LAST_CHOICE_STATE } from '@features/builder/openui/library/components/shared';
import { ELEMENT_DEMO_DEFINITIONS } from '@pages/Elements/elementDemos';
import { createMutationRefreshHarness } from '@src/tests/testUtils/createMutationRefreshHarness';

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
    expect(harness.getCheckboxChecked(`toggle-${appendedItem?.id as string}`)).toBe(false);

    await harness.clickCheckbox(`toggle-${appendedItem?.id as string}`);

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
    expect(harness.getCheckboxChecked(`toggle-${appendedItem?.id as string}`)).toBe(true);
    expect(harness.getQueryResult('savedItems')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: appendedItem?.id,
          completed: true,
          label: 'Smoke row',
        }),
      ]),
    );
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

  it('processes 5 rapid action-mode checkbox clicks as 5 sequential actions without racing on $targetCheckboxItemId', async () => {
    const rowIds = ['checkbox-a', 'checkbox-b', 'checkbox-c', 'checkbox-d', 'checkbox-e'];
    const harness = await createMutationRefreshHarness(`$targetCheckboxItemId = ""

savedItems = Query("read_state", { path: "demo.checkboxItems" }, [])
clickLog = Query("read_state", { path: "demo.clickLog" }, [])
recordClick = Mutation("append_state", {
  path: "demo.clickLog",
  value: $targetCheckboxItemId
})
toggleSavedItem = Mutation("toggle_item_field", {
  path: "demo.checkboxItems",
  idField: "id",
  id: $targetCheckboxItemId,
  field: "completed"
})
savedRows = @Each(savedItems, "item", Group(null, "vertical", [
  Checkbox("toggle-" + item.id, item.label, item.completed, null, null, Action([@Set($targetCheckboxItemId, item.id), @Run(recordClick), @Run(toggleSavedItem), @Run(savedItems), @Run(clickLog)])),
  Text(item.completed ? "Done" : "Open", "muted", "start")
], "inline"))

root = AppShell([
  Screen("main", "Main", [
    Repeater(savedRows, "No persisted checkbox rows.")
  ])
])`, {
      demo: {
        checkboxItems: rowIds.map((rowId) => ({
          completed: false,
          id: rowId,
          label: rowId,
        })),
        clickLog: [],
      },
    });

    await Promise.all(rowIds.map((rowId) => harness.clickCheckbox(`toggle-${rowId}`)));

    expect(harness.getQueryResult('clickLog')).toEqual(rowIds);
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
        clickLog: rowIds,
      },
    });
    expect(rowIds.map((rowId) => harness.getCheckboxChecked(`toggle-${rowId}`))).toEqual([true, true, true, true, true]);
  });

  it('keeps the /elements RadioGroup demo in sync after an action-mode collection update fed by $lastChoice', async () => {
    const radioDemo = ELEMENT_DEMO_DEFINITIONS.RadioGroup;
    const harness = await createMutationRefreshHarness(radioDemo.source, radioDemo.initialDomainData);

    expect(harness.getQueryResult('savedPlans')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'radio-a',
          plan: 'pro',
        }),
      ]),
    );

    await harness.chooseRadioGroupValue('saved-plan-radio-a', 'enterprise');

    expect(harness.getBinding(ACTION_MODE_LAST_CHOICE_STATE)).toBe('enterprise');
    expect(harness.getDomainData()).toEqual({
      demo: {
        radioSettings: expect.arrayContaining([
          expect.objectContaining({
            id: 'radio-a',
            label: 'Workspace A',
            plan: 'enterprise',
          }),
        ]),
      },
    });
    expect(harness.getQueryResult('savedPlans')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'radio-a',
          label: 'Workspace A',
          plan: 'enterprise',
        }),
      ]),
    );
    expect(harness.getTextValues()).toContain('Persisted plan: enterprise');
  });

  it('keeps the /elements Select demo in sync after an action-mode collection update fed by $lastChoice', async () => {
    const selectDemo = ELEMENT_DEMO_DEFINITIONS.Select;
    const harness = await createMutationRefreshHarness(selectDemo.source, selectDemo.initialDomainData);

    expect(harness.getQueryResult('savedViews')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'select-a',
          filter: 'all',
        }),
      ]),
    );

    await harness.chooseSelectValue('saved-filter-select-a', 'completed');

    expect(harness.getBinding(ACTION_MODE_LAST_CHOICE_STATE)).toBe('completed');
    expect(harness.getDomainData()).toEqual({
      demo: {
        selectViews: expect.arrayContaining([
          expect.objectContaining({
            id: 'select-a',
            label: 'Inbox board',
            filter: 'completed',
          }),
        ]),
      },
    });
    expect(harness.getQueryResult('savedViews')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'select-a',
          label: 'Inbox board',
          filter: 'completed',
        }),
      ]),
    );
    expect(harness.getTextValues()).toContain('Persisted filter: completed');
    expect(harness.getTextValues()).toContain('Showing completed tasks');
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
