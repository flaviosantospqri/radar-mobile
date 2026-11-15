export const theme = {
  colors: {
    background: "#07110D", surface: "#101C16", elevated: "#16251D", border: "#26382E",
    text: "#F3F7F4", muted: "#9BAAA0", faint: "#6E8075", green: "#A4F36B", greenDeep: "#6DC238",
    amber: "#F2C66D", red: "#FF7B70", blue: "#82B9FF", black: "#061008",
  },
  radius: { sm: 10, md: 16, lg: 24 },
};

export const money = (cents?: number | null) => cents === null || cents === undefined
  ? "—"
  : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function parseMoneyToCents(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) throw new Error("Digite um valor em reais válido.");
  return Math.round(amount * 100);
}

export const percent = (basisPoints?: number | null) => basisPoints === null || basisPoints === undefined ? "—" : `${(basisPoints / 100).toFixed(1)}%`;

