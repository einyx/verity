import { type Config, usePuck } from '@puckeditor/core';
import { createContext, useContext } from 'react';

import {
  landingSectionComponentNames,
  type LandingSectionBlockProps,
} from './LandingSectionBlocks';
import styles from './index.module.scss';

export type EditorConfig = Config<{
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

export function useEditorNavigation() {
  const navigation = useContext(EditorNavigationContext);

  if (!navigation) {
    throw new Error('Landing page section navigation must be used inside its provider.');
  }

  return navigation;
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
