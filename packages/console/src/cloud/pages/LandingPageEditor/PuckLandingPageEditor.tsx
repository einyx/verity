import { landingPageSectionGuard } from '@logto/schemas';
import { Puck, type Config } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { useCallback, useMemo, useRef, useState } from 'react';

import { isRecord } from './ContentEditor';
import { PageCanvas, PreviewContext } from './LandingPageCanvas';
import { EditorNavigationContext, type EditorNavigation } from './LandingPageNavigation';
import {
  landingPagePuckData,
  landingSectionConfig,
  puckContentToSections,
  type LandingSectionBlockProps,
} from './LandingSectionBlocks';
import styles from './index.module.scss';

type PageProps = { readonly document: unknown };

const config: Config<{ components: LandingSectionBlockProps; root: PageProps }> = {
  ...landingSectionConfig,
  root: {
    ...landingSectionConfig.root,
    fields: { document: { type: 'custom', label: 'Page', render: () => <div /> } },
    render: () => <PageCanvas />,
  },
};

const previewLocales: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fa-ir', label: 'فارسی' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'pl-pl', label: 'Polski' },
  { value: 'pt-br', label: 'Português (Brasil)' },
  { value: 'pt-pt', label: 'Português (Portugal)' },
  { value: 'ru', label: 'Русский' },
  { value: 'th', label: 'ไทย' },
  { value: 'tr-tr', label: 'Türkçe' },
  { value: 'zh-cn', label: '简体中文' },
  { value: 'zh-hk', label: '繁體中文（香港）' },
  { value: 'zh-tw', label: '繁體中文（台灣）' },
];

type Props = {
  readonly document: unknown;
  readonly locale: string;
  readonly onLocaleChange: (locale: string) => void;
  readonly onChange: (document: unknown) => void;
  readonly onEdit: (path: string, value: string) => void;
  readonly onMove: (id: string, x: number, y: number) => void;
};

function PuckLandingPageEditor({
  document,
  locale,
  onLocaleChange,
  onChange,
  onEdit,
  onMove,
}: Props) {
  const lastEmitted = useRef(document);
  const [activeSection, setActiveSection] = useState('hero');
  const selectSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
  }, []);
  const selectLink = useCallback(
    (path: string) => {
      const match = /^sections\.(\d+)/.exec(path);
      const index = match?.[1] ? Number(match[1]) : -1;
      const sections =
        isRecord(document) && Array.isArray(document.sections) ? document.sections : [];
      const section: unknown = sections[index];
      if (isRecord(section) && typeof section.id === 'string') {
        setActiveSection(section.id);
      }
    },
    [document]
  );
  const navigation = useMemo<EditorNavigation>(
    () => ({
      activeSection,
      selectSection,
      selectLink: () => {
        // Outline navigation does not track link selection; the preview handles it separately.
      },
    }),
    [activeSection, selectSection]
  );
  const preview = useMemo(
    () => ({ document, lastEmitted, locale, onEdit, onMove, onSelectLink: selectLink }),
    [document, locale, onEdit, onMove, selectLink]
  );
  const data = useMemo(() => landingPagePuckData(document), [document]);

  return (
    <PreviewContext.Provider value={preview}>
      <EditorNavigationContext.Provider value={navigation}>
        <div className={styles.puckEditor}>
          <div className={styles.puckEditorToolbar}>
            <span>Page canvas</span>
            <label className={styles.previewLocale}>
              Preview language
              <select
                value={locale}
                onChange={(event) => {
                  onLocaleChange(event.target.value);
                }}
              >
                {previewLocales.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Puck
            config={config}
            data={data}
            permissions={{ drag: true, duplicate: true, delete: true, edit: true, insert: true }}
            headerTitle="Landing page"
            iframe={{ enabled: false }}
            onChange={(next) => {
              const rootDocument = next.root.props?.document;
              const priorSections =
                isRecord(rootDocument) && Array.isArray(rootDocument.sections)
                  ? rootDocument.sections.flatMap((section) => {
                      const parsed = landingPageSectionGuard.safeParse(section);
                      return parsed.success ? [parsed.data] : [];
                    })
                  : [];
              const sections = puckContentToSections(next.content, priorSections);
              if (isRecord(rootDocument)) {
                const updated = { ...rootDocument, sections };
                // eslint-disable-next-line @silverhand/fp/no-mutation -- the ref records the document the canvas last emitted.
                lastEmitted.current = updated;
                onChange(updated);
              }
            }}
          >
            <PageCanvas />
          </Puck>
        </div>
      </EditorNavigationContext.Provider>
    </PreviewContext.Provider>
  );
}

export default PuckLandingPageEditor;
