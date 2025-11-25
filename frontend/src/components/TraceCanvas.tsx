import React from "react";

type Images = {
  original?: string | null;
  traced?: string | null;
  offset?: string | null;
};

export default function TraceCanvas({ images }: { images?: Images }) {
  return (
    <div className="trace-canvas" style={{ height: "100%" }}>
      <div className="image-pane">
        <div className="image-label">Original</div>
        <div className="image-placeholder">
          {images && images.original ? (
            <img src={`data:image/png;base64,${images.original}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ color: '#888' }}>[Original image]</div>
          )}
        </div>
      </div>
      <div className="image-pane">
        <div className="image-label">Traced</div>
        <div className="image-placeholder">
          {images && images.traced ? (
            <img src={`data:image/png;base64,${images.traced}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ color: '#888' }}>[Traced paths]</div>
          )}
        </div>
      </div>
      <div className="image-pane">
        <div className="image-label">Offset</div>
        <div className="image-placeholder">
          {images && images.offset ? (
            <img src={`data:image/png;base64,${images.offset}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ color: '#888' }}>[Offset paths]</div>
          )}
        </div>
      </div>
    </div>
  );
}
