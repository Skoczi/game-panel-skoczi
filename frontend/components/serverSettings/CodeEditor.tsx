import { memo, useCallback, useMemo, useRef } from 'react';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { Prec, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import ReactCodeMirror from '@uiw/react-codemirror';

function detectLanguage(filename: string): Extension | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'json':               return json();
    case 'yaml': case 'yml':   return yaml();
    case 'xml':  case 'config':return xml();
    case 'js':   case 'mjs':   return javascript();
    case 'ts':                 return javascript({ typescript: true });
    case 'css':                return css();
    case 'html': case 'htm':   return html();
    case 'md':   case 'markdown': return markdown();
    // .toml / .ini / .cfg / .conf / .properties → plain text (no package)
    default:                   return null;
  }
}

const baseTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
    fontSize: '13px',
    overflow: 'auto',
  },
  '&.cm-focused': { outline: 'none' },

  // oneDark themes the panel background but leaves its controls native, which read as light
  // boxes on the dark editor.
  '.cm-panels': { borderColor: '#334155' },
  // Native checkboxes ignore accent-color while unchecked; color-scheme makes the browser
  // render its own controls dark instead.
  '.cm-panel.cm-search': { padding: '8px 10px', colorScheme: 'dark' },
  '.cm-panel.cm-search .cm-textfield': {
    backgroundColor: '#0b1220',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: '#e6edf7',
    padding: '4px 8px',
  },
  '.cm-panel.cm-search .cm-textfield:focus-visible': {
    outline: 'none',
    borderColor: 'var(--color-cyan-400)',
  },
  '.cm-panel.cm-search .cm-button': {
    backgroundImage: 'none',
    backgroundColor: '#1f2937',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: '#e6edf7',
    padding: '4px 10px',
  },
  '.cm-panel.cm-search .cm-button:hover': { backgroundColor: '#27364d' },
  '.cm-panel.cm-search .cm-button:active': { backgroundColor: '#0f172a' },
  '.cm-panel.cm-search label': { color: '#94a3b8', fontSize: '12px' },
  '.cm-panel.cm-search input[type=checkbox]': {
    accentColor: 'var(--gp-ods-accent-primary)',
    verticalAlign: 'middle',
  },
  '.cm-panel.cm-search [name=close]': { color: '#94a3b8', cursor: 'pointer' },
  '.cm-panel.cm-search [name=close]:hover': { color: '#e6edf7' },
});

// searchKeymap binds Escape to closeSearchPanel. Taking the key first while the panel is
// open leaves the close button as the only way out; with no panel the binding declines and
// Escape keeps its usual meaning in the editor.
const keepSearchPanelOpen = Prec.highest(
  keymap.of([
    {
      key: 'Escape',
      run: (view) => Boolean(view.dom.querySelector('.cm-panel.cm-search')),
    },
  ])
);

const editorStyle = { height: '100%' } as const;

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  filename: string;
  readOnly?: boolean;
}

function CodeEditorImpl({ value, onChange, filename, readOnly = false }: CodeEditorProps) {
  // ReactCodeMirror reconfigures the whole editor whenever one of these identities changes,
  // and a reconfigure discards the search panel, which CodeMirror injects through
  // appendConfig rather than as a declared extension.
  const extensions = useMemo(() => {
    const langExt = detectLanguage(filename);
    return [baseTheme, keepSearchPanelOpen, EditorView.lineWrapping, ...(langExt ? [langExt] : [])];
  }, [filename]);

  const basicSetup = useMemo(
    () => ({
      lineNumbers: true,
      foldGutter: true,
      highlightActiveLine: true,
      highlightSelectionMatches: true,
      bracketMatching: true,
      closeBrackets: !readOnly,
      autocompletion: false,
      indentOnInput: true,
    }),
    [readOnly]
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handleChange = useCallback((next: string) => onChangeRef.current?.(next), []);

  return (
    <ReactCodeMirror
      value={value}
      onChange={handleChange}
      theme={oneDark}
      extensions={extensions}
      height="100%"
      editable={!readOnly}
      basicSetup={basicSetup}
      style={editorStyle}
    />
  );
}

export const CodeEditor = memo(CodeEditorImpl);
