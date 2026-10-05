import sanitizeHtml from "sanitize-html";

export function sanitizeMessageHtml(html: string, allowRemoteImages = false) {
  const source = allowRemoteImages
    ? html
    : html.replace(/<img\b[^>]*>/gi, '<span class="remote-image-placeholder">Remote image blocked</span>');
  return sanitizeHtml(source, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "section"]),
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: allowRemoteImages ? ["src", "alt", "title", "width", "height"] : ["alt", "title"],
      table: ["width", "cellpadding", "cellspacing", "border", "align"],
      td: ["width", "height", "colspan", "rowspan", "align", "valign"],
      th: ["width", "height", "colspan", "rowspan", "align", "valign"],
      "*": ["class", "style", "dir", "lang", "hidden", "data-email-preheader"],
    },
    nonBooleanAttributes: sanitizeHtml.defaults.nonBooleanAttributes.filter((name) => name !== "hidden"),
    allowedStyles: {
      "*": {
        color: [/^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{3,20})$/i],
        "background-color": [/^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{3,20})$/i],
        "font-family": [/^[\w\s,"'-]+$/],
        "font-size": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "font-style": [/^(normal|italic)$/],
        "line-height": [/^(normal|\d+(\.\d+)?(px|pt|em|rem|%)?)$/],
        display: [/^(none|block|inline|inline-block|table|inline-table|table-row|table-cell|table-row-group)$/],
        visibility: [/^(hidden|visible|collapse)$/],
        "mso-hide": [/^all$/],
        "text-align": [/^(left|right|center|justify)$/],
        "text-decoration": [/^(none|underline|line-through)$/],
        width: [/^(auto|\d+(\.\d+)?(px|em|rem|%))$/],
        "max-width": [/^(none|\d+(\.\d+)?(px|em|rem|%))$/],
        margin: [/^[\d\s.%-]+(px|pt|em|rem|%)?$/],
        padding: [/^[\d\s.%-]+(px|pt|em|rem|%)?$/],
        border: [/^\d+(px|pt)\s+(solid|dashed|dotted)\s+(#[0-9a-f]{3,8}|[a-z]{3,20})$/i],
        "border-radius": [/^\d+(\.\d+)?(px|em|rem|%)$/],
      },
    },
    // Hidden preheaders/spacers are inbox-preview metadata, not message content.
    // Keep hiding metadata/styles so sanitization doesn't expose zero-width
    // preview text one character per line. No untrusted CSS is executed here.
    exclusiveFilter: (frame) =>
      Object.hasOwn(frame.attribs, "hidden") ||
      frame.attribs["data-email-preheader"] === "true" ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|mso-hide\s*:\s*all)\s*(?:!important\s*)?(?:;|$)/i.test(
        frame.attribs.style || "",
      ),
    allowedSchemes: ["http", "https", "mailto", "cid"],
    transformTags: {
      a: (_tag, attrs) => ({ tagName: "a", attribs: { ...attrs, target: "_blank", rel: "noreferrer noopener" } }),
      img: (_tag, attrs) => ({ tagName: "img", attribs: attrs }),
    },
    disallowedTagsMode: "discard",
  });
}
