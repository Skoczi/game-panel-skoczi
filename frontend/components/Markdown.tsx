import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

// Safe markdown renderer for remote content (e.g. GitHub release notes). By default it
// does NOT render raw HTML, so markup can't be injected, and its urlTransform strips
// dangerous URL protocols. Links open in a new tab. Styling lives in the `.gp-markdown`
// CSS class (theme-agnostic) so it works in light and dark.
export function Markdown({ children, className, allowSanitizedHtml = false }: {
  children: string;
  className?: string;
  allowSanitizedHtml?: boolean;
}) {
  return (
    <div className={`gp-markdown ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={allowSanitizedHtml ? [rehypeRaw, rehypeSanitize] : []}
        components={{
          a: ({ node, ...props }) => {
            void node;
            return <a {...props} target="_blank" rel="noopener noreferrer" />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
