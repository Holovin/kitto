import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenUiSystemPrompt, buildOpenUiUserPrompt } from '../../prompts/openui.js';

interface ComponentSpec {
  components: Record<
    string,
    {
      description: string;
      signature: string;
    }
  >;
}

const componentSpecPath = new URL('../../../../shared/openui/component-spec.json', import.meta.url);
const componentSpec = JSON.parse(fs.readFileSync(componentSpecPath, 'utf8')) as ComponentSpec;
const supportedToolNames = ['read_state', 'write_state', 'merge_state', 'append_state', 'remove_state'];

describe('openui prompts', () => {
  it('keeps the generated component spec artifact committed in the repository', () => {
    expect(fs.existsSync(componentSpecPath)).toBe(true);
  });

  it('uses the current Screen and Button signatures and current screen-state navigation guidance', () => {
    const prompt = buildOpenUiSystemPrompt();

    expect(prompt).toContain('Screen(id: string, title: string, children?: any[], isActive?: boolean)');
    expect(prompt).toContain(
      'Button(id: string, label: string, variant?: "default" | "secondary" | "destructive", action?: any, disabled?: $binding<boolean>)',
    );
    expect(prompt).toContain('$currentScreen');
    expect(prompt).toContain('@Set($currentScreen');
  });

  it('guides Repeater toward dynamic collections built from @Each and state-driven data', () => {
    const prompt = buildOpenUiSystemPrompt();

    expect(prompt).toContain('Use Repeater only for dynamic or generated collections.');
    expect(prompt).toContain('Build those rows with `@Each(collection, "item", rowNode)` before passing them to Repeater.');
    expect(prompt).toContain('Do not hardcode answer rows, card rows, or summary lines when the list should reflect dynamic data.');
    expect(prompt).toContain('savedCards = Query("read_state", { path: "app.savedCards" }, [])');
    expect(prompt).toContain('selectedAnswers = [');
  });

  it('keeps the generated system prompt aligned with the committed component spec', () => {
    const prompt = buildOpenUiSystemPrompt();

    for (const component of Object.values(componentSpec.components)) {
      expect(prompt).toContain(component.signature);
      expect(prompt).toContain(component.description);
    }
  });

  it('keeps the generated system prompt aligned with the supported tool list', () => {
    const prompt = buildOpenUiSystemPrompt();

    for (const toolName of supportedToolNames) {
      expect(prompt).toContain(`- ${toolName}(`);
    }

    expect(prompt).toContain('Use ONLY the tools listed above');
    expect(prompt).toContain('Do NOT invent or guess tool names');
    expect(prompt).not.toContain('navigate_screen');
  });

  it('keeps the generated component spec aligned with the supported component list', () => {
    expect(Object.keys(componentSpec.components)).toEqual(
      expect.arrayContaining([
        'AppShell',
        'Screen',
        'Group',
        'Repeater',
        'Text',
        'Input',
        'TextArea',
        'Checkbox',
        'RadioGroup',
        'Select',
        'Button',
        'Link',
      ]),
    );
  });

  it('builds user prompts from the latest request and recent chat context only', () => {
    const prompt = buildOpenUiUserPrompt(
      {
        prompt: 'make a todo app',
        currentSource: '',
        chatHistory: [
          { role: 'system', content: 'ignore this older system note' },
          { role: 'user', content: 'first user turn' },
          { role: 'assistant', content: 'latest assistant turn' },
        ],
      },
      { chatHistoryMaxItems: 2 },
    );

    expect(prompt).toContain('Latest user request:\nmake a todo app');
    expect(prompt).toContain('Current full OpenUI source:\n(blank canvas, no current OpenUI source yet)');
    expect(prompt).toContain('Recent chat context:\nUSER: first user turn\nASSISTANT: latest assistant turn');
    expect(prompt).not.toContain('ignore this older system note');
  });
});
