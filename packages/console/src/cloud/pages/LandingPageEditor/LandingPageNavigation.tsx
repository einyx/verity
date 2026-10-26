import { type Config, usePuck } from '@puckeditor/core';
import { createContext, useContext } from 'react';

import { useConfirmModal } from '@/hooks/use-confirm-modal';

import {
  isCustomLandingSectionComponent,
  landingSectionComponentNames,
  puckSectionHeading,
  type LandingSectionBlockProps,
} from './LandingSectionBlocks';
import { sectionDescriptions, sectionKeys, sectionLabels } from './LandingSectionCatalog';
import styles from './index.module.scss';

type EditorConfig = Config<{
  components: LandingSectionBlockProps;
  root: { readonly document: unknown };
}>;

export type EditorNavigation = {
  readonly activeSection: string;
  readonly selectSection: (section: string) => void;
  readonly selectedLinkPath?: string;
  readonly selectLink: (path?: string) => void;
};

export const EditorNavigationContext = createContext<EditorNavigation | undefined>(undefined);

function useEditorNavigation() {
  const navigation = useContext(EditorNavigationContext);

  if (!navigation) {
    throw new Error('Landing page section navigation must be used inside its provider.');
  }

  return navigation;
}

export function SectionEntries({ onSelect }: { readonly onSelect?: () => void }) {
  const { activeSection, selectSection } = useEditorNavigation();
  const { appState, dispatch } = usePuck<EditorConfig>();

  return (
    <div className={styles.puckComponentList}>
      {sectionKeys.map((key) => (
        <button
          key={key}
          type="button"
          className={`${styles.puckSectionEntry} ${activeSection === key ? styles.puckSectionEntryActive : ''}`}
          aria-current={activeSection === key ? 'location' : undefined}
          onClick={() => {
            selectSection(key);
            onSelect?.();
            const index = appState.data.content.findIndex(
              (block) => block.type === landingSectionComponentNames[key]
            );
            if (index >= 0) {
              dispatch({
                type: 'setUi',
                ui: { itemSelector: { index, zone: 'root:default-zone' } },
              });
            }
          }}
        >
          <span className={styles.puckSectionEntryCopy}>
            <span className={styles.puckSectionEntryTitle}>{sectionLabels[key]}</span>
            <span className={styles.puckSectionEntryDescription}>{sectionDescriptions[key]}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function SectionLibraryPanel({ onSelect }: { readonly onSelect?: () => void }) {
  const { appState, dispatch, getPermissions } = usePuck<EditorConfig>();
  const { content } = appState.data;
  const canAdd = getPermissions().insert && content.length < 40;
  const blocks = [
    { type: 'TextSection', title: 'Text section', description: 'A heading with supporting copy.' },
    {
      type: 'ImageSection',
      title: 'Image section',
      description: 'An uploaded image with alt text and caption.',
    },
    {
      type: 'CtaSection',
      title: 'Call to action',
      description: 'A heading, message, and destination button.',
    },
  ] as const;

  return (
    <div className={styles.puckPluginContent}>
      <div className={styles.puckPluginHeading}>
        <h2>Components</h2>
        <span>{content.length}/40 sections</span>
      </div>
      <p className={styles.puckPluginHint}>
        Add a supported section to the page. New sections appear before the closing call to action.
      </p>
      <div className={styles.puckComponentList}>
        {blocks.map(({ type, title, description }) => (
          <button
            key={type}
            type="button"
            className={styles.puckComponentCard}
            disabled={!canAdd}
            onClick={() => {
              onSelect?.();
              dispatch({
                type: 'insert',
                componentType: type,
                destinationIndex: (() => {
                  const closingIndex = content.findIndex(
                    (block) => block.type === landingSectionComponentNames.closingCta
                  );
                  return closingIndex < 0 ? content.length : closingIndex;
                })(),
                destinationZone: 'root:default-zone',
              });
              dispatch({
                type: 'setUi',
                ui: {
                  itemSelector: {
                    index: Math.max(
                      0,
                      content.findIndex(
                        (block) => block.type === landingSectionComponentNames.closingCta
                      )
                    ),
                    zone: 'root:default-zone',
                  },
                },
              });
            }}
          >
            <span className={styles.puckComponentCardTitle}>{title}</span>
            <span className={styles.puckSectionEntryDescription}>{description}</span>
            <span className={styles.puckComponentCardAdd} aria-hidden="true">
              +
            </span>
          </button>
        ))}
      </div>
      {!canAdd && <p className={styles.puckPluginHint}>The section limit has been reached.</p>}
    </div>
  );
}

export function AddedSectionsPanel({ onSelect }: { readonly onSelect?: () => void }) {
  const { appState, dispatch, getPermissions } = usePuck<EditorConfig>();
  const { show } = useConfirmModal();
  const customSections = appState.data.content.flatMap((block, index) =>
    isCustomLandingSectionComponent(block.type) ? [{ block, index }] : []
  );
  const canEdit = getPermissions().edit;
  const selectBlock = (index: number) => {
    onSelect?.();
    dispatch({ type: 'setUi', ui: { itemSelector: { index, zone: 'root:default-zone' } } });
  };

  return (
    <div className={styles.puckPluginContent}>
      <div className={styles.puckPluginHeading}>
        <h2>Added sections</h2>
        <span>{customSections.length}</span>
      </div>
      <p className={styles.puckPluginHint}>
        Select, move, or remove custom sections. Reorder any section on the page: right-click it
        and choose Move section up or down.
      </p>
      <div className={styles.puckOutlineList}>
        {customSections.length === 0 ? (
          <p className={styles.puckOutlineEmpty}>
            No custom sections yet. Add one from Components.
          </p>
        ) : (
          customSections.map(({ block, index }, customIndex) => {
            const title = puckSectionHeading(block);
            const selected =
              appState.ui.itemSelector?.index === index &&
              appState.ui.itemSelector.zone === 'root:default-zone';
            return (
              <div
                key={block.props.id}
                className={`${styles.puckSectionEntry} ${styles.puckOutlineEntry} ${selected ? styles.puckSectionEntryActive : ''}`}
              >
                <button
                  type="button"
                  className={styles.puckOutlineSelect}
                  onClick={() => {
                    selectBlock(index);
                  }}
                >
                  <span className={styles.puckSectionNumber}>
                    {String(customIndex + 1).padStart(2, '0')}
                  </span>
                  <span className={styles.puckSectionEntryCopy}>
                    <span className={styles.puckSectionEntryTitle}>
                      {title || 'Untitled section'}
                    </span>
                    <span className={styles.puckSectionEntryDescription}>
                      {block.type.replace('Section', ' section')}
                    </span>
                  </span>
                </button>
                <div className={styles.puckOutlineActions}>
                  <button
                    type="button"
                    aria-label={`Move ${title} up`}
                    disabled={!canEdit || customIndex === 0}
                    onClick={() => {
                      dispatch({
                        type: 'reorder',
                        sourceIndex: index,
                        destinationIndex: customSections[customIndex - 1]?.index ?? index,
                        destinationZone: 'root:default-zone',
                      });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${title} down`}
                    disabled={!canEdit || customIndex === customSections.length - 1}
                    onClick={() => {
                      dispatch({
                        type: 'reorder',
                        sourceIndex: index,
                        destinationIndex: customSections[customIndex + 1]?.index ?? index,
                        destinationZone: 'root:default-zone',
                      });
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${title}`}
                    disabled={!canEdit}
                    onClick={async () => {
                      const [confirmed] = await show({
                        ModalContent: `Remove “${title}” from the page?`,
                      });

                      if (confirmed) {
                        dispatch({ type: 'remove', index, zone: 'root:default-zone' });
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
