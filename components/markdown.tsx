"use client";

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useRouter } from "next/navigation";
import { preprocessWikilinks, remarkCallouts, wikilinkStem } from "@/lib/markdown";

/**
 * Note bodies are rendered with rehypeRaw so Obsidian notes keep their inline HTML. That means
 * whatever is in a note reaches the DOM — and notes are written by agents and teammates, not
 * only by you. Without a sanitizer, anyone who can write a note can land `<script>` or
 * `<img onerror=...>` in every reader's browser. Stored XSS, delivered by your own vault.
 *
 * So: rehypeRaw parses the HTML, then rehypeSanitize strips anything dangerous. Order matters —
 * sanitize has to run after raw, or it inspects a tree that doesn't contain the HTML yet.
 *
 * The schema is the library default plus exactly what this renderer needs:
 *  - `className` / `data-callout` on the elements remarkCallouts emits, so callouts still style
 *  - the `wikilink:` href protocol, which the custom `a` component below resolves
 */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), "className", "dataCallout"],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "className", "dataCallout"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
    p: [...(defaultSchema.attributes?.p ?? []), "className"],
    a: [...(defaultSchema.attributes?.a ?? []), "className"],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "wikilink"],
  },
};

/**
 * Let `wikilink:` through; defer to react-markdown for everything else.
 *
 * react-markdown's defaultUrlTransform blanks any scheme outside http/https/mailto/tel, which
 * silently emptied every `[[wikilink]]` href — the `.wikilink` styles and the click-to-navigate
 * branch below had never actually run. Keeping the default for all other URLs means the
 * javascript:/data: protections stay exactly as they were.
 */
function urlTransform(url: string): string {
  return url.startsWith("wikilink:") ? url : defaultUrlTransform(url);
}

export function Markdown({
  content,
  resolve,
}: {
  content: string;
  resolve?: (stem: string) => string | undefined;
}) {
  const router = useRouter();
  const md = preprocessWikilinks(content);

  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        urlTransform={urlTransform}
        components={{
          a({ href, children, ...props }) {
            if (href?.startsWith("wikilink:")) {
              const target = wikilinkStem(decodeURIComponent(href.slice("wikilink:".length)));
              const path = resolve?.(target);
              if (path) {
                return (
                  <a
                    className="wikilink"
                    href={`/n/${path}`}
                    onClick={(e) => {
                      e.preventDefault();
                      router.push(`/n/${path}`);
                    }}
                  >
                    {children}
                  </a>
                );
              }
              return <span className="wikilink wikilink-unresolved">{children}</span>;
            }
            const external = href?.startsWith("http");
            return (
              <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
