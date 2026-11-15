export type AnalysisStatus = "pending" | "uploading" | "identifying" | "awaiting_confirmation" | "researching" | "calculating" | "completed" | "partial" | "failed" | "cancelled";
export type Recommendation = "COMPRAR" | "NEGOCIAR" | "INVESTIGAR" | "EVITAR";
export type MatchType = "EXATA" | "ALTA" | "PARCIAL" | "INCOMPATIVEL";
export type Liquidity = "ALTA" | "MEDIA" | "BAIXA" | "INSUFICIENTE";
export type OpportunityStatus = "ANALISADO" | "FAVORITO" | "COMPRADO" | "VENDIDO" | "DESCARTADO";

export type Product = {
  id: string; name: string; category: string | null; subcategory: string | null; brand: string | null;
  model: string | null; version: string | null; description: string | null; visibleCondition: string | null;
  functionalCondition: string | null; confirmedByUser: boolean; confidenceBps: number | null;
  updatedAt: string;
  attributes: Record<string, unknown>; visibleDefects: string[]; warnings: string[];
  identifiedInformation: string[]; uncertainInformation: string[]; verificationQuestions: string[]; searchQueries: string[];
};

export type MarketReference = {
  id: string; source: string; title: string; priceCents: number; currency: string; condition: string | null;
  url: string; collectedAt: string; matchConfidenceBps: number; matchType: MatchType; isCompatible: boolean;
};

export type Analysis = {
  id: string; status: AnalysisStatus; askingPriceCents: number | null; recommendation: Recommendation | null;
  recommendationReasons: string[] | null; createdAt: string; updatedAt?: string;
};

export type AnalysisResult = {
  analysis: Analysis;
  product: Product | null;
  market: {
    comparableCount: number; partialCount: number; lowestPriceCents: number | null; q25PriceCents: number | null;
    medianPriceCents: number | null; q75PriceCents: number | null; highestPriceCents: number | null;
    partialMedianPriceCents: number | null; liquidity: Liquidity; researchConfidenceBps: number;
    collectedAt: string | null; isActiveListingData: true; representsCompletedSales: false; sourceNames: string[];
  };
  references: MarketReference[];
  profitability: null | {
    purchasePriceCents: number | null; resalePriceCents: number | null; estimatedProfitCents: number | null;
    roiBps: number | null; marginBps: number | null; maximumPurchasePriceCents: number | null;
    transportCostCents: number; maintenanceCostCents: number; preparationCostCents: number;
    additionalCostCents: number; sellingFeeBps: number;
    scenarios: Record<string, any>;
  };
  lastResearch: { status: string; query: string; resultCount: number; createdAt: string } | null;
};

export type Settings = {
  minimumProfitCents: number; minimumRoiBps: number; defaultSellingFeeBps: number;
  defaultTransportCostCents: number; additionalCosts: { name: string; amountCents: number }[];
  preferredScenario: "conservador" | "provavel" | "otimista";
};

