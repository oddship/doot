import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: label, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ),
          img: ({ alt }) => <span className="markdown-image-blocked">[Image blocked: {alt || "remote image"}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
