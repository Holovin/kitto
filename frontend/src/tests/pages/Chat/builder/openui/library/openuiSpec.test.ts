import { describe, expect, it } from 'vitest';
import { builderOpenUiLibrary, getBuilderOpenUiSpec } from '@pages/Chat/builder/openui/library';

describe('builder OpenUI prompt spec', () => {
  it('derives action-mode literal value signatures from component schemas', () => {
    const baseSpec = builderOpenUiLibrary.toSpec();
    const promptSpec = getBuilderOpenUiSpec();

    expect(baseSpec.components.Checkbox.signature).toContain('checked?: $binding<boolean>');
    expect(baseSpec.components.Checkbox.signature).not.toContain('checked?: $binding<boolean> | boolean');
    expect(promptSpec.components.Checkbox.signature).toContain('checked?: $binding<boolean> | boolean');

    expect(baseSpec.components.RadioGroup.signature).toContain('value?: $binding<string>');
    expect(baseSpec.components.RadioGroup.signature).not.toContain('value?: $binding<string> | string');
    expect(promptSpec.components.RadioGroup.signature).toContain('value?: $binding<string> | string');

    expect(baseSpec.components.Select.signature).toContain('value?: $binding<string>');
    expect(baseSpec.components.Select.signature).not.toContain('value?: $binding<string> | string');
    expect(promptSpec.components.Select.signature).toContain('value?: $binding<string> | string');
  });

  it('keeps normal reactive-only control signatures unchanged', () => {
    const promptSpec = getBuilderOpenUiSpec();

    expect(promptSpec.components.Input.signature).toContain('value?: $binding<string>');
    expect(promptSpec.components.Input.signature).not.toContain('value?: $binding<string> | string');
    expect(promptSpec.components.TextArea.signature).toContain('value?: $binding<string>');
    expect(promptSpec.components.TextArea.signature).not.toContain('value?: $binding<string> | string');
    expect(promptSpec.components.Button.signature).toContain('disabled?: $binding<boolean>');
    expect(promptSpec.components.Button.signature).not.toContain('disabled?: $binding<boolean> | boolean');
  });

  it('keeps generated prompt signatures free of any types', () => {
    const promptSpec = getBuilderOpenUiSpec();
    const signatures = Object.values(promptSpec.components).map((component) => component.signature);

    expect(signatures).not.toEqual(expect.arrayContaining([expect.stringMatching(/\bany\b/)]));
    expect(promptSpec.components.AppShell.signature).toContain('children?: OpenUiNode[]');
    expect(promptSpec.components.Text.signature).toContain('value?: string | number | boolean | null');
    expect(promptSpec.components.Button.signature).toContain('action?: Action');
    expect(promptSpec.components.Input.signature).toContain('helper?: string | null');
  });
});
