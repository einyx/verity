import { isRecord } from './ContentEditor';
import {
  elementSelectionGuard,
  type ElementField,
  type LandingElementSelection,
} from './LandingElementModel';
import { isLandingSectionType, type LandingSectionType } from './LandingSectionTypes';

type PreviewMessageHandlers = {
  readonly onReady: () => void;
  readonly onEdit: (path: string, value: string) => void;
  readonly onSelectLink: (path: string) => void;
  readonly onSelectElement: (selection: LandingElementSelection) => void;
  readonly onElementEdit: (
    selection: LandingElementSelection,
    field: ElementField,
    value: unknown
  ) => void;
  readonly onSectionAction: (sectionId: string, action: string) => void;
  readonly onAddSection: (
    type: LandingSectionType,
    targetSectionId?: string,
    position?: 'before' | 'after' | 'end'
  ) => void;
  readonly onMove: (id: string, x: number, y: number) => void;
};

const sectionActions = new Set(['edit', 'up', 'down', 'duplicate', 'delete']);

/** The offset range the document schema accepts, so a bad message cannot save an invalid layout. */
const clamp = (value: number) => Math.min(400, Math.max(-400, Math.round(value)));

const handleEdit = (data: Record<string, unknown>, handlers: PreviewMessageHandlers): void => {
  if (typeof data.path === 'string') {
    handlers.onEdit(data.path, typeof data.value === 'string' ? data.value : '');
  }
};

const handleSelectLink = (
  data: Record<string, unknown>,
  handlers: PreviewMessageHandlers
): void => {
  if (typeof data.path === 'string') {
    handlers.onSelectLink(data.path);
  }
};

const handleSelectElement = (
  data: Record<string, unknown>,
  handlers: PreviewMessageHandlers
): void => {
  const selection = elementSelectionGuard.safeParse(data.selection);
  if (selection.success) {
    handlers.onSelectElement(selection.data);
  }
};

const handleElementEdit = (
  data: Record<string, unknown>,
  handlers: PreviewMessageHandlers
): void => {
  const selection = elementSelectionGuard.safeParse(data.selection);
  if (selection.success && data.field === 'text') {
    handlers.onElementEdit(selection.data, 'text', data.value);
  }
};

const handleSectionAction = (
  data: Record<string, unknown>,
  handlers: PreviewMessageHandlers
): void => {
  if (
    typeof data.sectionId === 'string' &&
    typeof data.action === 'string' &&
    sectionActions.has(data.action)
  ) {
    handlers.onSectionAction(data.sectionId, data.action);
  }
};

const handleAddSection = (
  data: Record<string, unknown>,
  handlers: PreviewMessageHandlers
): void => {
  if (!isLandingSectionType(data.sectionType)) {
    return;
  }

  const position = data.position === 'before' || data.position === 'after' ? data.position : 'end';
  handlers.onAddSection(
    data.sectionType,
    typeof data.targetSectionId === 'string' ? data.targetSectionId : undefined,
    position
  );
};

const handleMove = (data: Record<string, unknown>, handlers: PreviewMessageHandlers): void => {
  if (typeof data.id === 'string' && typeof data.x === 'number' && typeof data.y === 'number') {
    handlers.onMove(data.id, clamp(data.x), clamp(data.y));
  }
};

/**
 * Handles one message from the preview. Every field is validated before it reaches the editor, so a
 * message from the page can only request a known action on a known element.
 */
export const handlePreviewMessage = (data: unknown, handlers: PreviewMessageHandlers): void => {
  if (!isRecord(data)) {
    return;
  }

  // Simple protocol version check for future hardening (v1 for now).
  if (data.protocol && data.protocol !== 'v1') {
    console.warn('Unknown cms protocol version', data.protocol);
    return;
  }

  switch (data.type) {
    case 'meshx-cms-ready': {
      handlers.onReady();
      break;
    }
    case 'meshx-cms-edit': {
      handleEdit(data, handlers);
      break;
    }
    case 'meshx-cms-select-link': {
      handleSelectLink(data, handlers);
      break;
    }
    case 'meshx-cms-select-element': {
      handleSelectElement(data, handlers);
      break;
    }
    case 'meshx-cms-element-edit': {
      handleElementEdit(data, handlers);
      break;
    }
    case 'meshx-cms-section-action': {
      handleSectionAction(data, handlers);
      break;
    }
    case 'meshx-cms-add-section': {
      handleAddSection(data, handlers);
      break;
    }
    case 'meshx-cms-move': {
      handleMove(data, handlers);
      break;
    }
    default: {
      break;
    }
  }
};
