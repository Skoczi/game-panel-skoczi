import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CodeEditor } from '../components/serverSettings/CodeEditor';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
function Fixture() {
  const [value, setValue] = useState('hostname "Test server"\nsv_password ""\n');
  const [file, setFile] = useState('server.cfg');
  const [readOnly, setReadOnly] = useState(false);
  const [saves, setSaves] = useState(0);
  const [shown, setShown] = useState(true);
  const { toggleTheme } = useTheme();
  return (
    <>
      <button onClick={toggleTheme}>Theme</button>
      <button onClick={() => setReadOnly(!readOnly)}>Read only</button>
      <button
        onClick={() => {
          setFile('settings.json');
          setValue('{"port":27015}');
        }}
      >
        Other file
      </button>
      <button onClick={() => setShown(!shown)}>Toggle editor</button>
      <output data-testid="value">{value}</output>
      <output data-testid="saves">{saves}</output>
      <div style={{ height: 500 }}>
        {shown && (
          <CodeEditor
            key={file}
            value={value}
            filename={file}
            readOnly={readOnly}
            onChange={setValue}
            onSave={() => setSaves((n) => n + 1)}
          />
        )}
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Fixture />
    </ThemeProvider>
  </StrictMode>
);
