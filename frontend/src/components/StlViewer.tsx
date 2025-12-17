import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Edges } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

type Props = {
  projectName?: string;
  pollIntervalMs?: number;
};

function Scene({ geometry, userInteracted, justLoadedRef, controlsRef }: { geometry: THREE.BufferGeometry | null, userInteracted: boolean, justLoadedRef: React.MutableRefObject<boolean>, controlsRef: React.RefObject<any> }) {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const { camera, size } = useThree();

  useEffect(() => {
    if (!geometry || !camera) return;
    // if the user has already interacted (moved/zoomed), do not auto-fit camera
    if (userInteracted && !justLoadedRef.current) return;
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    if (!bbox) return;
    const dims = new THREE.Vector3();
    bbox.getSize(dims);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Top-down view: position camera along +Z above the object's center
    // Compute distances required to fit the object's X and Y extents into
    // the camera frustum (respecting aspect ratio) and pick the larger
    // distance so the whole object is visible.
    const vfovDeg = (camera as any).fov || 50;
    const vfov = THREE.MathUtils.degToRad(vfovDeg);
    const aspect = (size && size.width && size.height) ? (size.width / size.height) : 1;
    // horizontal fov derived from vertical fov and aspect
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);

    const halfHeight = dims.y / 2;
    const halfWidth = dims.x / 2;
    const distForHeight = halfHeight / Math.tan(vfov / 2);
    const distForWidth = halfWidth / Math.tan(hfov / 2);
    // choose the larger distance to ensure full visibility, add small margin
    const distance = Math.max(distForHeight, distForWidth) * 1.05;

    // enforce top view orientation
    camera.up.set(0, 1, 0);
    camera.position.set(center.x, center.y, center.z + distance);
    camera.lookAt(center);

    // Update OrbitControls target if available so controls orbit around center
    try {
      const ctrl = controlsRef && controlsRef.current;
      if (ctrl && ctrl.target) {
        ctrl.target.set(center.x, center.y, center.z);
        if (typeof ctrl.update === 'function') ctrl.update();
      }
    } catch (e) {
      // non-fatal
    }

    // clear the justLoaded flag after fitting so subsequent geometry loads don't
    // auto-fit unless explicitly set
    if (justLoadedRef.current) justLoadedRef.current = false;
  }, [geometry, camera, size, controlsRef]);

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial color={'#b0b0b0'} metalness={0.15} roughness={0.45} flatShading={true} />
      <Edges threshold={15} color={'#333'} />
    </mesh>
  );
}

export default React.forwardRef(function StlViewer({ projectName, pollIntervalMs = 0 }: Props, ref: React.Ref<{ reload: () => void }>) {
  // default: no automatic polling (0) — keeps viewer stable after initial load
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastSuccessTs, setLastSuccessTs] = useState<number | null>(null);
  const [activeProject, setActiveProject] = useState<string | undefined>(projectName);
  const loaderRef = useRef(new STLLoader());
  const mountedRef = useRef(true);
  const intervalRef = useRef<number | undefined>(undefined);
  const userInteractedRef = useRef(false);
  const prevPosCountRef = useRef<number | null>(null);
  const justLoadedRef = useRef(false);
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    mountedRef.current = true;
    const backendBase = 'http://localhost:5000';

    async function tryFetch() {
      if (!mountedRef.current) return;
      if (!activeProject) return;
      setLoading(true);
      try {
        const ts = Date.now();
        const url = `${backendBase}/api/render/output-stl?projectName=${encodeURIComponent(activeProject)}&ts=${ts}`;
        const resp = await fetch(url);
        if (!mountedRef.current) return;
        if (!resp.ok) {
          setLoading(false);
          return;
        }
        const buf = await resp.arrayBuffer();
        // parse with STLLoader
        const parsed = loaderRef.current.parse(buf) as THREE.BufferGeometry;
        if (parsed && mountedRef.current) {
          // avoid resetting geometry/camera if geometry appears identical
          const pos = (parsed.attributes && (parsed.attributes as any).position) || null;
          const count = pos ? pos.count : null;
          if (count !== null && prevPosCountRef.current === count) {
            // geometry likely unchanged; update timestamp but don't replace geometry
            setLastSuccessTs(ts);
          } else {
            prevPosCountRef.current = count;
            justLoadedRef.current = true;
            setGeometry(parsed);
            setLastSuccessTs(ts);
          }
        }
      } catch (e) {
        console.warn('STL fetch/parse failed', e);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    async function detectProject() {
      if (activeProject) return;
      try {
        const r = await fetch(`${backendBase}/api/render/projects`);
        if (!r.ok) return;
        const list = await r.json();
        if (Array.isArray(list) && list.length > 0) setActiveProject(list[0].name);
      } catch (e) {
        /* ignore */
      }
    }

    detectProject();
    // do NOT auto-fetch on a timer by default. Poll only if explicitly requested
    if (pollIntervalMs && pollIntervalMs > 0) {
      intervalRef.current = window.setInterval(tryFetch, pollIntervalMs);
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeProject, pollIntervalMs]);

  // `reload` fetches and parses the STL; useCallback keeps a stable ref
  const reload = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const backendBase = 'http://localhost:5000';
      const ts = Date.now();
      const url = `${backendBase}/api/render/output-stl?projectName=${encodeURIComponent(activeProject)}&ts=${ts}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        setLoading(false);
        return;
      }
      const buf = await resp.arrayBuffer();
      const parsed = loaderRef.current.parse(buf) as THREE.BufferGeometry;
      if (parsed) {
        const pos = (parsed.attributes && (parsed.attributes as any).position) || null;
        const count = pos ? pos.count : null;
        if (count !== null && prevPosCountRef.current === count) {
          setLastSuccessTs(ts);
        } else {
          prevPosCountRef.current = count;
          justLoadedRef.current = true;
          setGeometry(parsed);
          setLastSuccessTs(ts);
        }
      }
    } catch (e) {
      console.warn('manual reload failed', e);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  React.useImperativeHandle(ref, () => ({ reload }), [reload]);

  // Subscribe to server-sent events so the viewer only loads when the server
  // announces that an STL has been generated for a project. This makes the
  // viewer event-driven instead of timer-driven.
  useEffect(() => {
    const backendBase = 'http://localhost:5000';
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${backendBase}/api/render/events`);
      es.onopen = () => { console.debug('SSE connected'); };
      es.addEventListener('stl', (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data || '{}');
          const name = payload && payload.projectName;
          if (!name) return;
          // If viewer has no active project, pick this one. If it matches, reload.
          if (!activeProject) setActiveProject(name);
          if (name === activeProject) {
            // auto-load the fresh STL
            // ensure any errors inside reload are caught and logged
            void reload().catch((err) => console.error('reload failed from SSE', err));
          }
        } catch (e) { console.warn('bad sse payload', e); }
      });
      es.onerror = (e) => {
        console.warn('SSE error', e);
        // keep trying; EventSource will reconnect automatically in many browsers
      };
    } catch (e) {
      console.warn('Failed to open SSE', e);
    }
    return () => { if (es) es.close(); };
  }, [activeProject, reload]);

  // attempt to make wheel listener passive for the OrbitControls instance
  useMakeControlsWheelPassive(controlsRef);

  // reload is defined above via useCallback

  const showPlaceholder = !geometry && !loading;

  return (
    <div style={{ flex: 1, width: '100%', height: '100%', minHeight: 240, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px' }}>
        <div style={{ color: '#666', fontSize: 13 }}>
          {loading ? 'Loading STL...' : lastSuccessTs ? `Last updated ${new Date(lastSuccessTs).toLocaleTimeString()}` : 'No STL loaded'}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="action-text-button" onClick={reload} style={{ marginRight: 8 }}>Reload</button>
          <button className="action-text-button" onClick={async () => {
            if (!activeProject) return;
            try {
              const backendBase = 'http://localhost:5000';
              const url = `${backendBase}/api/render/output-stl?projectName=${encodeURIComponent(activeProject)}`;
              const resp = await fetch(url);
              if (!resp.ok) {
                console.warn('Failed to download STL, server returned', resp.status);
                return;
              }
              const blob = await resp.blob();
              const filename = `${activeProject || 'project'}.stl`;
              const urlBlob = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = urlBlob;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              a.remove();
              window.URL.revokeObjectURL(urlBlob);
            } catch (e) {
              console.warn('Download STL failed', e);
            }
          }} style={{ marginRight: 8 }}>Download STL</button>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        {showPlaceholder ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
            Render preview will appear here.
          </div>
        ) : (
          <Canvas style={{ position: 'absolute', inset: 0, touchAction: 'none' }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 10, 10]} intensity={0.8} />
            <Scene geometry={geometry} userInteracted={userInteractedRef.current} justLoadedRef={justLoadedRef} controlsRef={controlsRef} />
            <OrbitControls ref={controlsRef as any} enablePan enableZoom enableRotate onStart={() => { userInteractedRef.current = true; }} onChange={() => { userInteractedRef.current = true; }} />
          </Canvas>
        )}
      </div>
    </div>
  );
});

// Make OrbitControls wheel listener passive where possible to avoid console warnings
// and improve scroll responsiveness. We remove the existing listener and re-add
// with `{ passive: true }` where the underlying controls expose the handler.
// This is best-effort: if the underlying control implementation changes it's
// harmless (we catch errors).
function useMakeControlsWheelPassive(controlsRef: React.RefObject<any>) {
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    try {
      const dom = controls.domElement || (controls && controls.object && controls.object.domElement) || null;
      // Handler function name differs across three.js versions; try common names
      const handler = controls.onMouseWheel || controls.handleMouseWheel || controls.handleWheel;
      if (dom && handler) {
        try {
          dom.removeEventListener('wheel', handler as EventListener);
        } catch (e) { /* ignore */ }
        try {
          dom.addEventListener('wheel', handler as EventListener, { passive: true });
        } catch (e) {
          // Some browsers may throw if options object not supported; fall back
          try { dom.addEventListener('wheel', handler as EventListener, false); } catch (ee) { /* ignore */ }
        }
      }
    } catch (e) {
      // non-fatal
      // console.debug('Could not adjust wheel listener to passive', e);
    }
  }, [controlsRef.current]);
}

