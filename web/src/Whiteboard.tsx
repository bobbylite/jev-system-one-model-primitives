import { useEffect, useRef } from "react";
import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";

const licenseKey: string | undefined = import.meta.env["VITE_TLDRAW_LICENSE_KEY"];

/** A tldraw whiteboard in a native <dialog>. Drawings persist in IndexedDB. */
export default function Whiteboard({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el?.open) el?.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="wb"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()} // backdrop click
    >
      <div className="wb-bar">
        <span className="eyebrow">Whiteboard · sketch your decision flow</span>
        <button className="icon-btn" onClick={() => dialog.current?.close()} aria-label="Close whiteboard" title="Close (Esc)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="wb-canvas">
        <Tldraw
          persistenceKey="jev-whiteboard"
          onMount={(editor) => editor.user.updateUserPreferences({ colorScheme: "dark" })}
          {...(licenseKey ? { licenseKey } : {})}
        />
      </div>
    </dialog>
  );
}
