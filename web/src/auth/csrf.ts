let csrf: string | null = null;

export function setCsrf(token: string | null): void {
  csrf = token;
}

export function getCsrf(): string | null {
  return csrf;
}
