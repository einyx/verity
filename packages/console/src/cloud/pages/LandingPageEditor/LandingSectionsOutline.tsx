import { usePuck } from '@puckeditor/core';
import { useId, useState } from 'react';

import { useConfirmModal } from '@/hooks/use-confirm-modal';

import { useEditorNavigation, type EditorConfig } from './LandingPageNavigation';
import {
  isCustomLandingSectionComponent,
  landingSectionComponentNames,
  puckSectionHeading,
} from './LandingSectionBlocks';
import { sectionDescriptions, sectionKeys, sectionLabels } from './LandingSectionCatalog';
import styles from './index.module.scss';

const sectionDragType = 'application/x-meshx-landing-section';
const zone = 'root:default-zone';

export default function LandingSectionsOutline({ onSelect }: { readonly onSelect?: () => void }) {
  const { activeSection, selectSection } = useEditorNavigation();
  const { appState, dispatch, getPermissions } = usePuck<EditorConfig>();
  const { show } = useConfirmModal();
  const [draggedId, setDraggedId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: 'before' | 'after' }>();
  const [announcement, setAnnouncement] = useState('');
  const hintId = useId();
  const { content } = appState.data;

  const selectBlock = (index: number) => {
    const block = content[index];
    if (!block) {
      return;
    }
    selectSection(block.props.id);
    dispatch({ type: 'setUi', ui: { itemSelector: { index, zone } }, recordHistory: false });
  };

  const moveBlock = (sourceIndex: number, destinationIndex: number, title: string) => {
    const block = content[sourceIndex];
    if (
      !block ||
      sourceIndex === destinationIndex ||
      destinationIndex < 0 ||
      destinationIndex >= content.length
    ) {
      return;
    }
    const permissions = getPermissions({ item: block });
    if (!permissions.edit || !permissions.drag) {
      return;
    }
    dispatch({ type: 'reorder', sourceIndex, destinationIndex, destinationZone: zone });
    selectSection(block.props.id);
    dispatch({
      type: 'setUi',
      ui: { itemSelector: { index: destinationIndex, zone } },
      recordHistory: false,
    });
    setAnnouncement(`${title} moved to position ${destinationIndex + 1} of ${content.length}.`);
  };

  return (
    <div className={styles.unifiedSections}>
      <p className={styles.puckPluginHint}>Drag any section to change its position.</p>
      <span id={hintId} className={styles.sectionReorderStatus}>
        Use the arrow buttons, or focus a drag handle and use arrow keys, Home, or End.
      </span>
      <ol className={styles.sectionOrderList} aria-label="Page section order">
        {content.map((block, index) => {
          const key = sectionKeys.find(
            (candidate) => landingSectionComponentNames[candidate] === block.type
          );
          const custom = isCustomLandingSectionComponent(block.type);
          const title =
            key && !custom ? sectionLabels[key] : puckSectionHeading(block) || 'Untitled section';
          const description = key
            ? sectionDescriptions[key]
            : block.type === 'CtaSection'
              ? 'Call to action'
              : block.type.replace('Section', ' section');
          const permissions = getPermissions({ item: block });
          const canMove = permissions.edit && permissions.drag;
          const canRemove =
            permissions.edit &&
            permissions.delete &&
            !['hero', 'closingCta'].includes(block.props.section.type);
          const selected = appState.ui.itemSelector
            ? appState.ui.itemSelector.zone === zone && appState.ui.itemSelector.index === index
            : activeSection === block.props.id;

          return (
            <li
              key={block.props.id}
              className={`${styles.puckSectionEntry} ${styles.unifiedSectionRow} ${selected ? styles.puckSectionEntryActive : ''}`}
              data-dragging={draggedId === block.props.id || undefined}
              data-drop-target={dropTarget?.id === block.props.id ? dropTarget.edge : undefined}
              onDragOver={(event) => {
                if (canMove && draggedId && draggedId !== block.props.id) {
                  event.preventDefault();
                  // eslint-disable-next-line @silverhand/fp/no-mutation -- The browser requires setting the native drag operation.
                  event.dataTransfer.dropEffect = 'move';
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const edge = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
                  setDropTarget({ id: block.props.id, edge });
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData(sectionDragType);
                if (canMove && draggedId && sourceId === draggedId) {
                  const sourceIndex = content.findIndex(
                    (candidate) => candidate.props.id === sourceId
                  );
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const insertAt = index + (event.clientY < bounds.top + bounds.height / 2 ? 0 : 1);
                  const destination = insertAt - (sourceIndex < insertAt ? 1 : 0);
                  moveBlock(sourceIndex, destination, puckSectionHeading(content[sourceIndex]));
                }
                setDraggedId(undefined);
                setDropTarget(undefined);
              }}
            >
              <button
                type="button"
                className={styles.sectionDragHandle}
                aria-label={`Reorder ${title}`}
                aria-describedby={hintId}
                disabled={!canMove}
                draggable={canMove}
                onDragStart={(event) => {
                  event.dataTransfer.setData(sectionDragType, block.props.id);
                  // eslint-disable-next-line @silverhand/fp/no-mutation -- The browser requires setting the native drag operation.
                  event.dataTransfer.effectAllowed = 'move';
                  setDraggedId(block.props.id);
                }}
                onDragEnd={() => {
                  setDraggedId(undefined);
                  setDropTarget(undefined);
                }}
                onKeyDown={(event) => {
                  const destinations: Record<string, number> = {
                    ArrowUp: index - 1,
                    ArrowDown: index + 1,
                    Home: 0,
                    End: content.length - 1,
                  };
                  const destination = destinations[event.key];
                  if (destination !== undefined) {
                    event.preventDefault();
                    moveBlock(index, destination, title);
                  }
                }}
              >
                <span aria-hidden="true">⋮⋮</span>
              </button>
              <button
                type="button"
                className={styles.puckOutlineSelect}
                aria-label={`Edit ${title}`}
                aria-current={selected ? 'location' : undefined}
                title={description}
                onClick={() => {
                  selectBlock(index);
                  onSelect?.();
                }}
              >
                <span className={styles.puckSectionEntryCopy}>
                  <span className={styles.puckSectionEntryTitle}>{title}</span>
                  <span className={styles.puckSectionEntryDescription}>{description}</span>
                </span>
              </button>
              <div className={`${styles.puckOutlineActions} ${styles.unifiedSectionActions}`}>
                <button
                  type="button"
                  aria-label={`Move ${title} up`}
                  disabled={!canMove || index === 0}
                  onClick={() => {
                    moveBlock(index, index - 1, title);
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${title} down`}
                  disabled={!canMove || index === content.length - 1}
                  onClick={() => {
                    moveBlock(index, index + 1, title);
                  }}
                >
                  ↓
                </button>
                {canRemove && (
                  <button
                    type="button"
                    aria-label={`Remove ${title}`}
                    onClick={async () => {
                      const [confirmed] = await show({
                        ModalContent: `Remove “${title}” from the page?`,
                      });
                      if (confirmed) {
                        const selectedIndex = appState.ui.itemSelector?.index;
                        const selectedId =
                          selectedIndex === undefined
                            ? undefined
                            : content[selectedIndex]?.props.id;
                        const remaining = content.filter(
                          (candidate) => candidate.props.id !== block.props.id
                        );
                        const nextIndex =
                          selectedId === block.props.id
                            ? Math.min(index, remaining.length - 1)
                            : remaining.findIndex((candidate) => candidate.props.id === selectedId);
                        dispatch({ type: 'remove', index, zone });
                        const next = remaining[nextIndex];
                        if (next) {
                          selectSection(next.props.id);
                          dispatch({
                            type: 'setUi',
                            ui: { itemSelector: { index: nextIndex, zone } },
                            recordHistory: false,
                          });
                        }
                      }
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <span className={styles.sectionReorderStatus} role="status">
        {announcement}
      </span>
    </div>
  );
}
