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
      "*": ["class", "style", "dir", "lang"],
    },
    allowedStyles: {
      "*": {
        color: [/^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{3,20})$/i],
        "background-color": [/^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{3,20})$/i],
        "font-family": [/^[\w\s,"'-]+$/],
        "font-size": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "font-style": [/^(normal|italic)$/],
        "line-height": [/^(normal|\d+(\.\d+)?(px|pt|em|rem|%))$/],
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
    allowedSchemes: ["http", "https", "mailto", "cid"],
    transformTags: {
      a: (_tag, attrs) => ({ tagName: "a", attribs: { ...attrs, target: "_blank", rel: "noreferrer noopener" } }),
      img: (_tag, attrs) => ({ tagName: "img", attribs: attrs }),
    },
    disallowedTagsMode: "discard",
  });
}
