// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DraggableNode } from '../../../ui/sidebar/nodes/draggable-node';

describe('DraggableNode', () => {
  it('stores the node type in drag data and sets drag effect on drag start', () => {
    render(<DraggableNode description="Adds two numbers" displayName="Add" type="add" />);

    const trigger = screen.getByRole('button');
    const setData = vi.fn();
    const dataTransfer = {
      effectAllowed: '',
      setData,
    } as unknown as DataTransfer;
    fireEvent.dragStart(trigger, { dataTransfer });

    expect(setData).toHaveBeenCalledWith('application/x-fluxery-node-type', 'add');
    expect(setData).toHaveBeenCalledWith('text/plain', 'add');
    expect(dataTransfer.effectAllowed).toBe('move');
  });
});
