 
type Props = {
  projectName?: string;
};

import StlViewer from './StlViewer';

export default function RenderCanvas({ projectName }: Props) {
  // RenderCanvas intentionally minimal: place the STL viewer to fill available center area.
  return (
    <div style={{ flex: 1, height: '100%', boxSizing: 'border-box', position: 'relative' }}>
      <StlViewer projectName={projectName} />
    </div>
  );
}
