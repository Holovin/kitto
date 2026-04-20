import { describe, expect, it } from 'vitest';
import {
  ACTION_REFERENCE_GROUPS,
  ACTION_REFERENCE_ITEMS,
  ELEMENT_REFERENCE_GROUPS,
  ELEMENT_REFERENCE_ITEMS,
  createReferenceAnchorId,
  resolveReferenceTargetFromHash,
} from '@pages/Elements/referenceNavigation';

describe('referenceNavigation', () => {
  it('creates stable anchor ids for components and actions', () => {
    expect(createReferenceAnchorId('Button')).toBe('button');
    expect(createReferenceAnchorId('TextArea')).toBe('text-area');
    expect(createReferenceAnchorId('read_state')).toBe('read_state');
  });

  it('keeps the current element and action ordering in the table of contents', () => {
    expect(ELEMENT_REFERENCE_ITEMS.map(({ label }) => label)).toEqual([
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
    ]);

    expect(ACTION_REFERENCE_ITEMS.at(0)).toMatchObject({
      id: 'read_state',
      label: 'read_state',
      tab: 'actions',
    });
  });

  it('groups references into logical blocks for elements and actions', () => {
    expect(ELEMENT_REFERENCE_GROUPS.map(({ label }) => label)).toEqual(['Containers', 'Inputs', 'Actions']);
    expect(ELEMENT_REFERENCE_GROUPS[0]?.items.map(({ label }) => label)).toEqual(['AppShell', 'Screen', 'Group', 'Repeater', 'Text']);

    expect(ACTION_REFERENCE_GROUPS.map(({ label }) => label)).toEqual(['Read & Compute', 'State Paths', 'Collections']);
    expect(ACTION_REFERENCE_GROUPS[0]?.items.map(({ label }) => label)).toEqual([
      'read_state',
      'compute_value',
      'write_computed_state',
    ]);
    expect(ACTION_REFERENCE_GROUPS[2]?.items.map(({ label }) => label)).toEqual([
      'append_state',
      'append_item',
      'toggle_item_field',
      'update_item_field',
      'remove_item',
    ]);
  });

  it('resolves direct hashes to the right tab and canonical anchor id', () => {
    expect(resolveReferenceTargetFromHash('#button')).toEqual({
      id: 'button',
      label: 'Button',
      tab: 'elements',
    });

    expect(resolveReferenceTargetFromHash('#textarea')).toEqual({
      id: 'text-area',
      label: 'TextArea',
      tab: 'elements',
    });

    expect(resolveReferenceTargetFromHash('#read-state')).toEqual({
      id: 'read_state',
      label: 'read_state',
      tab: 'actions',
    });
  });
});
