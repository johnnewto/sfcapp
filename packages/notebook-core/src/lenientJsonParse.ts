import Hjson from "hjson";

/**
 * Parse JSON-like text with Hjson (strict JSON remains valid).
 * Accepts trailing commas, unquoted keys, and // comments that LLM output often includes.
 */
export function parseLenientJsonValue(source: string): unknown {
  return Hjson.parse(source);
}
