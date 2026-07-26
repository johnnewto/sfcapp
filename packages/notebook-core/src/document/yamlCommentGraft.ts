import {
  isMap,
  isScalar,
  isSeq,
  parseDocument as parseYamlDocument,
  type Document as YamlDocument,
  type Pair,
  type YAMLMap,
  type YAMLSeq
} from "yaml";

export interface YamlCommentGraftResult {
  droppedCount: number;
  source: string;
}

interface NodeAnnotation {
  comment?: string;
  commentBefore?: string;
  spaceBefore?: boolean;
}

const TO_STRING_OPTIONS = {
  collectionStyle: "any" as const,
  flowCollectionPadding: false,
  lineWidth: 0
};

/**
 * Copy YAML comments from `previousSource` onto structurally matching nodes in
 * `nextSource`. Cell and equation/external/initial-value row paths are keyed by
 * stable ids (or row names) so inserts and reorders do not misplace comments.
 */
export function graftYamlComments(previousSource: string, nextSource: string): YamlCommentGraftResult {
  const previousDoc = parseYamlDocument(previousSource, {
    prettyErrors: false,
    uniqueKeys: false
  });
  const nextDoc = parseYamlDocument(nextSource, {
    prettyErrors: false,
    uniqueKeys: false
  });

  if (previousDoc.errors.length > 0 || nextDoc.errors.length > 0 || !previousDoc.contents || !nextDoc.contents) {
    return { droppedCount: 0, source: nextSource };
  }

  const annotations = new Map<string, NodeAnnotation>();
  collectAnnotations(previousDoc.contents, [], annotations);
  collectDocumentAnnotations(previousDoc, annotations);

  let appliedCount = 0;
  appliedCount += applyAnnotations(nextDoc.contents, [], annotations);
  appliedCount += applyDocumentAnnotations(nextDoc, annotations);

  const droppedCount = Math.max(0, annotations.size - appliedCount);
  return {
    droppedCount,
    source: nextDoc.toString(TO_STRING_OPTIONS).trimEnd()
  };
}

function collectDocumentAnnotations(document: YamlDocument, into: Map<string, NodeAnnotation>): void {
  const annotation = readAnnotation(document);
  if (annotation) {
    into.set("@document", annotation);
  }
}

function applyDocumentAnnotations(document: YamlDocument, annotations: Map<string, NodeAnnotation>): number {
  const annotation = annotations.get("@document");
  if (!annotation) {
    return 0;
  }
  writeAnnotation(document, annotation);
  return 1;
}

function storeAnnotation(into: Map<string, NodeAnnotation>, path: string[], annotation: NodeAnnotation): void {
  const key = serializePath(path);
  const existing = into.get(key);
  into.set(key, existing ? { ...existing, ...annotation } : annotation);
}

function collectAnnotations(
  node: unknown,
  path: string[],
  into: Map<string, NodeAnnotation>
): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (isMap(node)) {
    const annotation = readAnnotation(node);
    if (annotation) {
      storeAnnotation(into, path, annotation);
    }
    for (const pair of node.items as Pair[]) {
      const key = scalarKey(pair.key);
      if (key == null) {
        continue;
      }
      collectAnnotations(pair.key, [...path, `@key:${key}`], into);
      collectAnnotations(pair.value, [...path, key], into);
    }
    return;
  }

  if (isSeq(node)) {
    const items = node.items as unknown[];
    if (pathEndsWith(path, "cells")) {
      collectKeyedSequenceAnnotations(node, items, path, into, (item) => {
        const cellId = readWrappedCellId(item);
        return cellId != null ? `@cell:${cellId}` : `@cell:?`;
      });
      return;
    }

    if (pathEndsWith(path, "rows") && isNamedRowSequenceParent(path)) {
      collectKeyedSequenceAnnotations(node, items, path, into, (item, index) => {
        const rowKey = readRowIdentity(item) ?? String(index);
        return `@row:${rowKey}`;
      });
      return;
    }

    const annotation = readAnnotation(node);
    if (annotation) {
      storeAnnotation(into, path, annotation);
    }
    items.forEach((item, index) => {
      collectAnnotations(item, [...path, String(index)], into);
    });
    return;
  }

  const annotation = readAnnotation(node as { comment?: string | null; commentBefore?: string | null; spaceBefore?: boolean });
  if (annotation) {
    storeAnnotation(into, path, annotation);
  }
}

/**
 * YAML attaches a comment above the first sequence item to the sequence itself
 * (`commentBefore`). Re-home that onto the first keyed child so deletes/reorders
 * do not leave orphaned comments on the parent sequence.
 */
function collectKeyedSequenceAnnotations(
  sequence: YAMLSeq,
  items: unknown[],
  path: string[],
  into: Map<string, NodeAnnotation>,
  keyForItem: (item: unknown, index: number) => string
): void {
  const sequenceAnnotation = readAnnotation(sequence);
  if (sequenceAnnotation) {
    const { commentBefore: firstItemCommentBefore, ...rest } = sequenceAnnotation;
    if (Object.keys(rest).length > 0) {
      storeAnnotation(into, path, rest);
    }
    if (firstItemCommentBefore && items.length > 0) {
      storeAnnotation(into, [...path, keyForItem(items[0], 0)], { commentBefore: firstItemCommentBefore });
    } else if (firstItemCommentBefore) {
      storeAnnotation(into, path, sequenceAnnotation);
    }
  }

  items.forEach((item, index) => {
    collectAnnotations(item, [...path, keyForItem(item, index)], into);
  });
}

function applyAnnotations(
  node: unknown,
  path: string[],
  annotations: Map<string, NodeAnnotation>
): number {
  if (!node || typeof node !== "object") {
    return 0;
  }

  let applied = 0;
  const pathKey = serializePath(path);
  const annotation = annotations.get(pathKey);
  if (annotation) {
    writeAnnotation(node as { comment?: string | null; commentBefore?: string | null; spaceBefore?: boolean }, annotation);
    applied += 1;
  }

  if (isMap(node)) {
    for (const pair of node.items as Pair[]) {
      const key = scalarKey(pair.key);
      if (key == null) {
        continue;
      }
      applied += applyAnnotations(pair.key, [...path, `@key:${key}`], annotations);
      applied += applyAnnotations(pair.value, [...path, key], annotations);
    }
    return applied;
  }

  if (isSeq(node)) {
    const items = node.items as unknown[];
    if (pathEndsWith(path, "cells")) {
      return (
        applied +
        applyKeyedSequenceAnnotations(node, items, path, annotations, (item) => {
          const cellId = readWrappedCellId(item);
          return cellId != null ? `@cell:${cellId}` : `@cell:?`;
        })
      );
    }

    if (pathEndsWith(path, "rows") && isNamedRowSequenceParent(path)) {
      return (
        applied +
        applyKeyedSequenceAnnotations(node, items, path, annotations, (item, index) => {
          const rowKey = readRowIdentity(item) ?? String(index);
          return `@row:${rowKey}`;
        })
      );
    }

    items.forEach((item, index) => {
      applied += applyAnnotations(item, [...path, String(index)], annotations);
    });
  }

  return applied;
}

function applyKeyedSequenceAnnotations(
  sequence: YAMLSeq,
  items: unknown[],
  path: string[],
  annotations: Map<string, NodeAnnotation>,
  keyForItem: (item: unknown, index: number) => string
): number {
  let applied = 0;
  const sequencePath = serializePath(path);
  const sequenceAnnotation = annotations.get(sequencePath);
  if (sequenceAnnotation) {
    writeAnnotation(sequence, sequenceAnnotation);
    applied += 1;
  }

  items.forEach((item, index) => {
    const itemPath = [...path, keyForItem(item, index)];
    const itemKey = serializePath(itemPath);
    const itemAnnotation = annotations.get(itemKey);
    // First-item comments are stored on the item path but YAML expects them on the
    // sequence's commentBefore when the item is first.
    if (index === 0 && itemAnnotation?.commentBefore && !sequence.commentBefore) {
      sequence.commentBefore = itemAnnotation.commentBefore;
      const remainder = { ...itemAnnotation };
      delete remainder.commentBefore;
      if (Object.keys(remainder).length > 0) {
        writeAnnotation(item as { comment?: string | null; commentBefore?: string | null; spaceBefore?: boolean }, remainder);
      }
      applied += 1;
      // Still walk children without re-applying the item annotation's commentBefore.
      applied += applyAnnotationsSkippingSelf(item, itemPath, annotations);
      return;
    }

    applied += applyAnnotations(item, itemPath, annotations);
  });

  return applied;
}

function applyAnnotationsSkippingSelf(
  node: unknown,
  path: string[],
  annotations: Map<string, NodeAnnotation>
): number {
  if (!node || typeof node !== "object") {
    return 0;
  }

  let applied = 0;
  if (isMap(node)) {
    for (const pair of node.items as Pair[]) {
      const key = scalarKey(pair.key);
      if (key == null) {
        continue;
      }
      applied += applyAnnotations(pair.key, [...path, `@key:${key}`], annotations);
      applied += applyAnnotations(pair.value, [...path, key], annotations);
    }
    return applied;
  }

  if (isSeq(node)) {
    (node.items as unknown[]).forEach((item, index) => {
      applied += applyAnnotations(item, [...path, String(index)], annotations);
    });
  }

  return applied;
}

function readWrappedCellId(item: unknown): string | null {
  if (!isMap(item)) {
    return null;
  }

  const map = item as YAMLMap;
  for (const pair of map.items as Pair[]) {
    const typeKey = scalarKey(pair.key);
    if (typeKey == null || !isMap(pair.value)) {
      continue;
    }
    const id = readMapString(pair.value as YAMLMap, "id");
    if (id) {
      return id;
    }
  }

  return readMapString(map, "id");
}

function readRowIdentity(item: unknown): string | null {
  if (isSeq(item)) {
    const first = (item as YAMLSeq).items[0];
    if (isScalar(first) && (typeof first.value === "string" || typeof first.value === "number")) {
      return String(first.value);
    }
    return null;
  }

  if (isMap(item)) {
    return readMapString(item as YAMLMap, "id") ?? readMapString(item as YAMLMap, "name");
  }

  if (isScalar(item) && typeof item.value === "string") {
    // Row comments encoded as bare strings (section headers).
    return `comment:${item.value}`;
  }

  return null;
}

function readMapString(map: YAMLMap, key: string): string | null {
  const value = map.get(key);
  return typeof value === "string" && value.trim() ? value : null;
}

function isNamedRowSequenceParent(path: string[]): boolean {
  // .../@cell:equations-id/equations/rows or .../equations/rows
  if (path.length < 2) {
    return false;
  }
  const parent = path[path.length - 2] ?? "";
  return (
    parent === "equations" ||
    parent === "externals" ||
    parent === "observed" ||
    parent === "initial-values" ||
    parent.startsWith("@cell:")
  );
}

function pathEndsWith(path: string[], segment: string): boolean {
  return path[path.length - 1] === segment;
}

function serializePath(path: string[]): string {
  return path.length === 0 ? "@root" : path.join("/");
}

function scalarKey(node: unknown): string | null {
  if (!isScalar(node)) {
    return null;
  }
  if (typeof node.value === "string" || typeof node.value === "number" || typeof node.value === "boolean") {
    return String(node.value);
  }
  return null;
}

function readAnnotation(node: {
  comment?: string | null;
  commentBefore?: string | null;
  spaceBefore?: boolean;
}): NodeAnnotation | null {
  const annotation: NodeAnnotation = {};
  if (typeof node.comment === "string" && node.comment.length > 0) {
    annotation.comment = node.comment;
  }
  if (typeof node.commentBefore === "string" && node.commentBefore.length > 0) {
    annotation.commentBefore = node.commentBefore;
  }
  if (node.spaceBefore) {
    annotation.spaceBefore = true;
  }
  return Object.keys(annotation).length > 0 ? annotation : null;
}

function writeAnnotation(
  node: {
    comment?: string | null;
    commentBefore?: string | null;
    spaceBefore?: boolean;
  },
  annotation: NodeAnnotation
): void {
  if (annotation.comment != null) {
    node.comment = annotation.comment;
  }
  if (annotation.commentBefore != null) {
    node.commentBefore = annotation.commentBefore;
  }
  if (annotation.spaceBefore) {
    node.spaceBefore = true;
  }
}
