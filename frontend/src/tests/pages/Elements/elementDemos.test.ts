import { describe, expect, it } from 'vitest';
import { ACTION_MODE_LAST_CHOICE_STATE } from '@pages/Chat/builder/openui/library/components/shared';
import { ELEMENT_DEMO_DEFINITIONS } from '@pages/Elements/elementDemos';
import { createMutationRefreshHarness } from '@src/tests/testUtils/createMutationRefreshHarness';

describe('element demos', () => {
  it('keeps Checkbox repeater rows in sync through action-mode persisted toggles', async () => {
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
    expect(harness.getTextValues()).toContain('Done');
  });

  it('keeps RadioGroup repeater rows in sync through action-mode collection updates', async () => {
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

  it('keeps Select repeater rows in sync through action-mode collection updates', async () => {
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
});
