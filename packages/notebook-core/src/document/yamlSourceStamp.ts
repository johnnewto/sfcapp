import { isMap, parseDocument as parseYamlDocument } from "yaml";

const TO_STRING_OPTIONS = {
  collectionStyle: "any" as const,
  flowCollectionPadding: false,
  lineWidth: 0
};

/**
 * Set `metadata.sourceFileName` on YAML notebook text while preserving comments.
 * Falls back to the original source if the text is not a YAML mapping.
 */
export function stampYamlSourceFileName(source: string, sourceFileName: string): string {
  const trimmedName = sourceFileName.trim();
  if (!trimmedName) {
    return source;
  }

  const document = parseYamlDocument(source, {
    prettyErrors: false,
    uniqueKeys: false
  });
  if (document.errors.length > 0 || !document.contents || !isMap(document.contents)) {
    return source;
  }

  const metadata = document.get("metadata", true);
  if (!isMap(metadata)) {
    document.set("metadata", { version: 1, sourceFileName: trimmedName });
  } else {
    if (metadata.get("version") == null) {
      metadata.set("version", 1);
    }
    metadata.set("sourceFileName", trimmedName);
  }

  return document.toString(TO_STRING_OPTIONS).trimEnd();
}
