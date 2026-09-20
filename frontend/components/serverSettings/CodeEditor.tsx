import { memo, useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { useTheme } from '../../contexts/ThemeContext';
import './editor-session.css';

monaco.editor.defineTheme('panel-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0b1220',
    'editorGutter.background': '#0b1220',
    'editor.lineHighlightBackground': '#132137',
    'editor.selectionBackground': '#16405c',
    'editorWidget.background': '#111d30',
    'editorWidget.border': '#334155',
    'editorHoverWidget.background': '#111d30',
    'editorHoverWidget.border': '#334155',
    'input.background': '#0b1220',
    'input.border': '#334155',
    focusBorder: '#00c8df',
  },
});

// All workers are bundled locally; opening a config never contacts a public CDN.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker();
    if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
    if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker();
    if (['javascript', 'typescript'].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};

function detectLanguage(filename: string): string {
  if (filename.toLowerCase() === 'dockerfile') return 'dockerfile';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const languages: Record<string, string> = {
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    config: 'xml',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    markdown: 'markdown',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    properties: 'ini',
    sh: 'shell',
    bash: 'shell',
    lua: 'lua',
    py: 'python',
    sql: 'sql',
  };
  return languages[ext] ?? 'plaintext';
}

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  filename: string;
  readOnly?: boolean;
}

function CodeEditorImpl({ value, onChange, onSave, filename, readOnly = false }: CodeEditorProps) {
  const { theme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef({ value, onChange, onSave, readOnly });
  latest.current = { value, onChange, onSave, readOnly };

  useEffect(() => {
    if (!container.current) return;
    const overlays = document.createElement('div');
    overlays.className = 'gp-monaco-overlays';
    document.body.appendChild(overlays);
    // Each mounted file owns its model and undo stack; no filenames or contents in URLs.
    const model = monaco.editor.createModel(latest.current.value, detectLanguage(filename));
    const instance = monaco.editor.create(container.current, {
      model,
      automaticLayout: true,
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: overlays,
      readOnly: latest.current.readOnly,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 21,
      padding: { top: 12, bottom: 12 },
      minimap: { enabled: false },
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      bracketPairColorization: { enabled: true },
      folding: true,
      stickyScroll: { enabled: false },
      ariaLabel: `File editor: ${filename}`,
    });
    editor.current = instance;
    const changes = instance.onDidChangeModelContent(() =>
      latest.current.onChange?.(model.getValue())
    );
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (!latest.current.readOnly) latest.current.onSave?.();
    });
    return () => {
      changes.dispose();
      instance.dispose();
      model.dispose();
      overlays.remove();
      editor.current = null;
    };
  }, [filename]);

  useEffect(() => {
    const model = editor.current?.getModel();
    // Controlled updates must not reset selection, find widget or undo history.
    if (model && model.getValue() !== value) model.setValue(value);
  }, [value, filename]);
  useEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly, filename]);
  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'panel-dark' : 'vs');
  }, [theme, filename]);
  return <div ref={container} style={{ height: '100%', width: '100%', minHeight: 0 }} />;
}

export const CodeEditor = memo(CodeEditorImpl);
