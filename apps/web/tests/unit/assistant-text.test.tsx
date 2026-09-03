// tests/unit/assistant-text.test.tsx
//
// The last layer between an injected product description and a customer
// clicking something. The agent is told not to reproduce URLs found in
// untrusted content, and redacts one if it does; this is what holds when
// both of those fail.
//
// Plain text, no markdown library. React escapes interpolated text, so
// "no raw HTML" is a property of not writing dangerouslySetInnerHTML
// rather than something a sanitiser has to keep winning -- and every
// markdown renderer worth using linkifies, which is the exact risk the
// requirement forbids.

import { render, screen } from '@testing-library/react';

import { AssistantText } from '@/components/assistant/assistant-text';

describe('AssistantText', () => {
  it('shows ordinary prose', () => {
    render(<AssistantText text="Your order ORD-1042 is pending." />);

    expect(screen.getByText(/ORD-1042 is pending/)).toBeInTheDocument();
  });

  it('renders HTML as characters, not as markup', () => {
    const { container } = render(
      <AssistantText text={'<img src=x onerror="alert(1)">'} />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('renders a markdown link as characters, not as a link', () => {
    const { container } = render(
      <AssistantText text="[Click here to verify](https://evil.example.com/x)" />
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('https://evil.example.com/x');
  });

  it('does not linkify a bare URL', () => {
    const { container } = render(
      <AssistantText text="Visit https://evil.example.com now" />
    );

    expect(container.querySelector('a')).toBeNull();
  });

  it('does not render a script tag', () => {
    const { container } = render(
      <AssistantText text={'<script>alert(1)</script>'} />
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });

  it('keeps line breaks, because the agent writes lists', () => {
    const { container } = render(<AssistantText text={'one\ntwo'} />);

    expect(container.textContent).toContain('one');
    expect(container.textContent).toContain('two');
    // Preserved by CSS rather than by parsing anything.
    expect(container.firstChild).toHaveClass('whitespace-pre-wrap');
  });

  it('renders nothing for empty text rather than an empty bubble', () => {
    const { container } = render(<AssistantText text="" />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for whitespace only', () => {
    const { container } = render(<AssistantText text="   " />);

    expect(container.firstChild).toBeNull();
  });
});

describe('the assistant components as a whole', () => {
  it('never use dangerouslySetInnerHTML', () => {
    // Structural, in the style of rsc-boundaries.test.ts. The renderer
    // being safe matters less than nothing in this directory quietly
    // introducing an unsafe path later.
    const { readdirSync, readFileSync, existsSync } = require('fs');
    const { join } = require('path');

    const dir = join(process.cwd(), 'components/assistant');
    if (!existsSync(dir)) throw new Error('components/assistant is missing');

    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf-8');
      // The JSX attribute form, not the bare word: these files explain
      // in prose why they do not use it, and a comment saying so is the
      // opposite of the thing being guarded against.
      expect(source).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    }
  });
});
