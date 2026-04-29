export const allowedUrlCases = [
  { label: 'https URLs', value: 'https://example.com' },
  { label: 'https URLs with path, query, and hash', value: 'https://example.com/path?x=1#section' },
  { label: 'http localhost URLs', value: 'http://localhost:3000' },
] satisfies ReadonlyArray<{ label: string; value: unknown }>;

export const rejectedUrlCases = [
  { label: 'mailto URLs', value: 'mailto:test@example.com' },
  { label: 'tel URLs', value: 'tel:+491234' },
  { label: 'root-relative app URLs', value: '/chat' },
  { label: 'other app-relative routes', value: '/about' },
  { label: 'hash URLs', value: '#section' },
  { label: 'help hash URLs', value: '#help' },
  { label: 'javascript URLs', value: 'javascript:alert(1)' },
  { label: 'data URLs', value: 'data:text/html,<script>alert(1)</script>' },
  { label: 'base64 data URLs', value: 'data:text/html;base64,PGgxPkJhZDwvaDE+' },
  { label: 'blob URLs', value: 'blob:https://example.com/id' },
  { label: 'protocol-relative URLs', value: '//evil.com' },
  { label: 'leading-whitespace URLs', value: ' https://example.com' },
  { label: 'internal-whitespace URLs', value: 'https://exa mple.com' },
  { label: 'path-whitespace URLs', value: 'https://example.com/foo bar' },
  { label: 'empty strings', value: '' },
  { label: 'non-string values', value: 1234 },
  { label: 'file URLs', value: 'file:///tmp/test.html' },
] satisfies ReadonlyArray<{ label: string; value: unknown }>;

export const fileRuntimeRejectedUrlCases = [
  { label: 'root-relative app URLs in file runtimes', value: '/chat' },
  { label: 'hash URLs in file runtimes', value: '#section' },
] satisfies ReadonlyArray<{ label: string; value: unknown }>;
