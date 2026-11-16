import type { LiveIdentification } from "../../services/api/client";

export type IdentificationSuggestion = {
  field: "category" | "subcategory" | "brand" | "model" | "version";
  value: string;
  confidence: number;
  rationale: string;
};

const unknownName = /produto não identificado|item não identificado|objeto sem identificar|desconhecido/i;

export function getIdentificationSuggestions(attributes: Record<string, unknown> | null | undefined): IdentificationSuggestion[] {
  const raw = attributes?.suggestions;
  if (!Array.isArray(raw)) return [];
  const fields = new Set<IdentificationSuggestion["field"]>(["category", "subcategory", "brand", "model", "version"]);
  return raw.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    if (!fields.has(value.field as IdentificationSuggestion["field"]) || typeof value.value !== "string" || !value.value.trim()) return [];
    if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return [];
    return [{
      field: value.field as IdentificationSuggestion["field"],
      value: value.value.trim().slice(0, 160),
      confidence: value.confidence,
      rationale: typeof value.rationale === "string" ? value.rationale.trim().slice(0, 240) : "",
    }];
  });
}

export function parseIdentification(raw: string): LiveIdentification {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("O Gemini não retornou uma identificação válida.");
  const value = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("O Gemini não conseguiu nomear o produto.");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error("A confiança da identificação veio em formato inválido.");
  }
  const textOrNull = (item: unknown, max: number) => typeof item === "string" ? item.slice(0, max) : null;
  const stringList = (item: unknown, count: number, max: number) => Array.isArray(item)
    ? item.filter((entry): entry is string => typeof entry === "string").slice(0, count).map((entry) => entry.slice(0, max))
    : [];
  const attributes = value.attributes && typeof value.attributes === "object" && !Array.isArray(value.attributes)
    ? value.attributes as Record<string, unknown> : {};
  const suggestions = getIdentificationSuggestions(attributes);
  let name = value.name.trim().slice(0, 240);
  if (unknownName.test(name)) {
    const broadSuggestion = suggestions.find((suggestion) => suggestion.field === "subcategory" || suggestion.field === "category");
    if (broadSuggestion) name = `${broadSuggestion.value} (hipótese)`;
  }
  return {
    name,
    category: textOrNull(value.category, 120),
    subcategory: textOrNull(value.subcategory, 120),
    brand: textOrNull(value.brand, 160),
    model: textOrNull(value.model, 160),
    version: textOrNull(value.version, 160),
    description: textOrNull(value.description, 1000),
    attributes: { ...attributes, ...(suggestions.length ? { suggestions } : {}) },
    visibleCondition: textOrNull(value.visibleCondition, 500),
    visibleDefects: stringList(value.visibleDefects, 30, 300),
    confidence: value.confidence,
    identifiedInformation: stringList(value.identifiedInformation, 30, 300),
    uncertainInformation: stringList(value.uncertainInformation, 30, 300),
    verificationQuestions: stringList(value.verificationQuestions, 20, 300),
    searchQueries: stringList(value.searchQueries, 5, 240),
    warnings: stringList(value.warnings, 30, 300),
  };
}

export function isUsefulIdentification(result: LiveIdentification) {
  return result.name.trim().length > 2 && !unknownName.test(result.name);
}

export function identificationScore(result: LiveIdentification) {
  const detailCount = [result.category, result.subcategory, result.brand, result.model, result.version].filter(Boolean).length;
  const suggestions = getIdentificationSuggestions(result.attributes);
  return result.confidence * 100 + detailCount * 4 + suggestions.length * 2;
}
