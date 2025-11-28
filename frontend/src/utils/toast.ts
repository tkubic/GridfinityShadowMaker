export function showToast(message: string, duration = 4000) {
  try {
    const containerId = 'gsm-toast-container';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      Object.assign(container.style, {
        position: 'fixed',
        right: '16px',
        top: '16px',
        zIndex: '9999',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none'
      });
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
      background: 'rgba(0,0,0,0.8)',
      color: 'white',
      padding: '8px 12px',
      borderRadius: '6px',
      maxWidth: '360px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      opacity: '0',
      transform: 'translateY(-8px)',
      transition: 'opacity 220ms ease, transform 220ms ease',
      pointerEvents: 'auto',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial'
    });

    // click to dismiss
    toast.addEventListener('click', () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      setTimeout(() => { try { toast.remove(); } catch (e) {} }, 220);
    });

    container.appendChild(toast);

    // trigger enter
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // auto-dismiss
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      setTimeout(() => { try { toast.remove(); } catch (e) {} }, 220);
    }, duration);
  } catch (e) {
    // If something unexpected happens, log instead of blocking the UI.
    try { console.warn('toast failed', e, message); } catch (ee) { /* ignore */ }
  }
}

export default showToast;
