import { FileText } from 'lucide-react';
import './editor-loading.css';

export function EditorLoadingState({ filename, phase = 'file' }: {
  filename?: string;
  phase?: 'file' | 'editor';
}) {
  return <div className="gp-editor-loading" role="status" aria-live="polite" aria-busy="true">
    <div className="gp-editor-loading-content">
      <div className="gp-editor-loading-icon" aria-hidden="true"><FileText size={25} /></div>
      <div className="gp-editor-loading-title">{phase === 'editor' ? 'Preparing your editor' : 'Opening your file'}</div>
      {filename && <div className="gp-editor-loading-filename">{filename}</div>}
      <div className="gp-editor-loading-preview" aria-hidden="true">
        {[72, 48, 86, 62, 40].map((width, index) => <div className="gp-editor-loading-line" key={index}>
          <span>{index + 1}</span><i style={{ width: `${width}%` }} />
        </div>)}
      </div>
    </div>
  </div>;
}
