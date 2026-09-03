// components/assistant/assistant-text.tsx
//
// Everything the agent says, and the only place that decides what agent
// prose may become on screen.
//
// IT IS THIS SIMPLE ON PURPOSE. Someone will want to improve it; read
// this first.
//
// Plain text. No markdown, no sanitiser, no library. React escapes
// interpolated text, so "no raw HTML" is a property of not writing
// dangerouslySetInnerHTML rather than something a sanitiser has to keep
// winning -- and every markdown renderer worth using linkifies, which is
// exactly the risk the M4 requirement forbids. Adding one would import
// the hazard and then ask a config flag to remove it again.
//
// This is the third layer of the same defence and the only one that
// faces the customer. The MCP server wraps admin-authored text in
// <untrusted-user-content>; the agent's system prompt forbids reproducing
// a URL found inside it, and redacts one if it does anyway. Here, a URL
// is inert characters no matter how it arrived.
//
// Rich output does not need this file. Product and order cards are built
// from TOOL RESULTS, which are structured data -- that is what the event
// contract is for. If a link is ever genuinely needed, it goes through
// one component with a storefront-domain allowlist, and this paragraph
// is what should be re-read before writing it.

export function AssistantText({ text }: { text: string }) {
  // An empty bubble is worse than no bubble.
  if (!text?.trim()) return null;

  // whitespace-pre-wrap keeps the agent's line breaks without parsing
  // anything; break-words stops a long unbroken string from widening the
  // panel.
  return <p className="whitespace-pre-wrap break-words">{text}</p>;
}
