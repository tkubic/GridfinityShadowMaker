import React from 'react';

type Props = {
  projectName?: string;
};

import StlViewer from './StlViewer';

export default function RenderCanvas({ projectName }: Props) {
  // RenderCanvas intentionally minimal: place the STL viewer to fill available center area.
  // Register a global hook so tab click can trigger a reload.
  const viewerRef = React.useRef<{ reload?: () => void } | null>(null);
  React.useEffect(() => {
    (window as any).__gsmReload3d = () => {
      try { viewerRef.current?.reload?.(); } catch { /* ignore */ }
    };
    const onEvent = () => {
      try { viewerRef.current?.reload?.(); } catch { /* ignore */ }
    };
    window.addEventListener('gsm-reload-3d', onEvent);
    return () => {
      if ((window as any).__gsmReload3d) delete (window as any).__gsmReload3d;
      window.removeEventListener('gsm-reload-3d', onEvent);
    };
  }, []);
  return (
    <div style={{ flex: 1, height: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <StlViewer projectName={projectName} ref={viewerRef as any} />
    </div>
  );
}
