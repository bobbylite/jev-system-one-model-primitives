type Listener = () => void;

let reauth: Listener | null = null;
let blocked: Listener | null = null;

export function onReauth(listener: Listener): () => void {
  reauth = listener;
  return () => {
    if (reauth === listener) reauth = null;
  };
}

export function notifyReauth(): void {
  reauth?.();
}

export function onBlocked(listener: Listener): () => void {
  blocked = listener;
  return () => {
    if (blocked === listener) blocked = null;
  };
}

export function notifyBlocked(): void {
  blocked?.();
}
