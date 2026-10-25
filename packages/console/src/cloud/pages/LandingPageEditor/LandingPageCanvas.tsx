import { Puck, type Config, usePuck } from '@puckeditor/core';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from 'react';

import { isRecord } from './ContentEditor';
import {
  readAtPath,
  setAtPath,
  updateElementField,
  type ElementField,
  type LandingElementSelection,
} from './LandingElementModel';
import LandingElementProperties from './LandingElementProperties';
import {
  AddedSectionsPanel,
  EditorNavigationContext,
  SectionEntries,
  SectionLibraryPanel,
} from './LandingPageNavigation';
import LandingPreviewFrame from './LandingPreviewFrame';
import {
  landingPagePuckData,
  landingSectionComponentNames,
  puckContentToSections,
  type LandingSectionBlockProps,
  type LandingSectionType,
} from './LandingSectionBlocks';
import styles from './index.module.scss';

type PageProps = { readonly document: unknown };

type PreviewContextValue = {
  /** The document owned by the page, used to detect changes made outside the canvas. */
  readonly document: unknown;
  /** The last document this canvas emitted, so its own changes are not echoed back. */
  readonly lastEmitted: MutableRefObject<unknown>;
  readonly locale: string;
  readonly onEdit: (path: string, value: string) => void;
  readonly onSelectLink: (path: string) => void;
  readonly onMove: (id: string, x: number, y: number) => void;
};

export const PreviewContext = createContext<PreviewContextValue | undefined>(undefined);

const singletonTypes = new Set(['hero', 'closingCta']);

export function PageCanvas() {
  const [selection, setSelection] = useState<LandingElementSelection>();
  const [panel, setPanel] = useState<'preview' | 'sections' | 'properties'>('preview');
  const [showLibrary, setShowLibrary] = useState(false);
  const preview = useContext(PreviewContext);
  const navigation = useContext(EditorNavigationContext);
  const { appState, dispatch, history } =
    usePuck<Config<{ components: LandingSectionBlockProps; root: PageProps }>>();
  const currentDocument = useMemo(
    () => ({
      ...(isRecord(appState.data.root.props?.document) ? appState.data.root.props.document : {}),
      sections: puckContentToSections(appState.data.content),
    }),
    [appState.data]
  );
  const externalDocument = preview?.document;
  const lastEmitted = preview?.lastEmitted;

  useEffect(() => {
    if (!lastEmitted || externalDocument === lastEmitted.current) {
      return;
    }
    // Settings made outside the canvas join the same history, without echoing Puck's own updates back.
    // eslint-disable-next-line @silverhand/fp/no-mutation -- the ref records which document the canvas last emitted.
    lastEmitted.current = externalDocument;
    dispatch({
      type: 'setData',
      data: (previous) => puckData(externalDocument, previous.root.props),
      recordHistory: true,
    });
  }, [externalDocument, lastEmitted, dispatch]);

  if (!preview || !navigation) {
    return null;
  }

  const updateDocument = (next: unknown) => {
    if (next === currentDocument) {
      return;
    }
    dispatch({
      type: 'setData',
      data: (previous) => puckData(next, previous.root.props),
      recordHistory: true,
    });
  };

  const editElement = (target: LandingElementSelection, field: ElementField, value: unknown) => {
    updateDocument(updateElementField(currentDocument, target, field, value));
  };

  const selectElement = (next: LandingElementSelection) => {
    setSelection(next);
    setPanel(next.kind === 'image' ? 'preview' : 'properties');
    if (next.sectionId) {
      const index = currentDocument.sections.findIndex((section) => section.id === next.sectionId);
      if (index >= 0) {
        dispatch({
          type: 'setUi',
          ui: { itemSelector: { index, zone: 'root:default-zone' } },
          recordHistory: false,
        });
      }
    }
  };

  const sectionAction = (id: string, action: string) => {
    const index = currentDocument.sections.findIndex((section) => section.id === id);
    const section = currentDocument.sections[index];
    if (!section) {
      return;
    }

    if (action === 'edit') {
      showSectionProperties();
      dispatch({
        type: 'setUi',
        ui: { itemSelector: { index, zone: 'root:default-zone' } },
        recordHistory: false,
      });
      return;
    }

    if (action === 'duplicate') {
      if (singletonTypes.has(section.type) || currentDocument.sections.length >= 40) {
        return;
      }
      dispatch({ type: 'duplicate', sourceIndex: index, sourceZone: 'root:default-zone' });
      return;
    }

    if (action === 'delete') {
      if (singletonTypes.has(section.type)) {
        return;
      }
      dispatch({ type: 'remove', index, zone: 'root:default-zone' });
      setSelection(undefined);
      return;
    }

    if (action === 'up' || action === 'down') {
      const destinationIndex = index + (action === 'up' ? -1 : 1);
      if (destinationIndex >= 0 && destinationIndex < currentDocument.sections.length) {
        dispatch({
          type: 'reorder',
          sourceIndex: index,
          destinationIndex,
          destinationZone: 'root:default-zone',
        });
      }
    }
  };

  const addSection = (
    type: LandingSectionType,
    targetId?: string,
    position: 'before' | 'after' | 'end' = 'end'
  ) => {
    const { sections } = currentDocument;
    if (sections.length >= 40) {
      return;
    }
    if (
      singletonTypes.has(type) &&
      sections.some((section) => isRecord(section) && section.type === type)
    ) {
      return;
    }

    const targetIndex = targetId
      ? appState.data.content.findIndex((block) => block.props.id === targetId)
      : -1;
    const closingIndex = appState.data.content.findIndex(
      (block) => block.type === landingSectionComponentNames.closingCta
    );
    const destinationIndex =
      targetIndex >= 0
        ? targetIndex + (position === 'after' ? 1 : 0)
        : type === 'hero'
          ? 0
          : type === 'closingCta'
            ? appState.data.content.length
            : closingIndex < 0
              ? appState.data.content.length
              : closingIndex;

    showSectionProperties();
    dispatch({
      type: 'insert',
      componentType: landingSectionComponentNames[type],
      destinationIndex,
      destinationZone: 'root:default-zone',
    });
    dispatch({
      type: 'setUi',
      ui: { itemSelector: { index: destinationIndex, zone: 'root:default-zone' } },
      recordHistory: false,
    });
  };

  const showSectionProperties = () => {
    setSelection(undefined);
    setPanel('properties');
  };

  return (
    <div className={styles.editorWorkspace} data-panel={panel}>
      <div className={styles.editorPanelTabs} aria-label="Editor panels">
        {(['sections', 'preview', 'properties'] as const).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={panel === name}
            onClick={() => {
              setPanel(name);
            }}
          >
            {name === 'sections' ? 'Sections' : name === 'preview' ? 'Preview' : 'Properties'}
          </button>
        ))}
      </div>
      <aside className={styles.editorSections} aria-label="Page sections">
        <div className={styles.editorPaneHeading}>
          <h2>Sections</h2>
          <button
            type="button"
            aria-expanded={showLibrary}
            onClick={() => {
              setShowLibrary(!showLibrary);
            }}
          >
            {showLibrary ? 'Close library' : 'Add section'}
          </button>
        </div>
        {showLibrary && <SectionLibraryPanel onSelect={showSectionProperties} />}
        <SectionEntries onSelect={showSectionProperties} />
        <AddedSectionsPanel onSelect={showSectionProperties} />
      </aside>
      <section className={styles.liveCanvas} aria-label="Page preview">
        <div className={styles.liveCanvasToolbar}>
          <button type="button" disabled={!history.hasPast} onClick={history.back}>
            Undo
          </button>
          <button type="button" disabled={!history.hasFuture} onClick={history.forward}>
            Redo
          </button>
          <span>Click to edit · Right-click for actions</span>
        </div>
        <div className={styles.liveCanvasBody}>
          <LandingPreviewFrame
            draft={currentDocument}
            locale={preview.locale}
            activeSection={navigation.activeSection}
            onEdit={(path, value) => {
              // Accept only existing copy fields, never arbitrary message-supplied object paths.
              if (
                typeof readAtPath(currentDocument, path) === 'string' ||
                /^copy\.[\w-]+\.[a-z-]+$/.test(path)
              ) {
                updateDocument(setAtPath(currentDocument, path, value));
              }
            }}
            onSelectLink={preview.onSelectLink}
            onMove={(id, offsetX, offsetY) => {
              const target =
                selection?.id === id
                  ? selection
                  : { id, kind: 'image' as const, fields: {}, values: {} };
              const next = updateElementField(currentDocument, target, 'x', offsetX);
              updateDocument(updateElementField(next, target, 'y', offsetY));
            }}
            onAddSection={addSection}
            onSelectElement={selectElement}
            onElementEdit={editElement}
            onSectionAction={sectionAction}
          />
        </div>
      </section>
      <aside className={styles.editorInspector} aria-label="Properties">
        {selection ? (
          <LandingElementProperties
            key={selection.id}
            selection={selection}
            document={currentDocument}
            onChange={(field, value) => {
              editElement(selection, field, value);
            }}
            onClose={() => {
              setSelection(undefined);
              setPanel('preview');
            }}
          />
        ) : (
          <>
            <div className={styles.editorPaneHeading}>
              <h2>Section properties</h2>
            </div>
            {appState.ui.itemSelector ? (
              <Puck.Fields />
            ) : (
              <p className={styles.editorEmpty}>
                Select a section or click an element in the preview to edit it.
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

const puckData = (document: unknown, rootProps: { title?: string } | undefined) => {
  const data = landingPagePuckData(document);
  return { content: data.content, root: { props: { ...rootProps, ...data.root.props } } };
};
