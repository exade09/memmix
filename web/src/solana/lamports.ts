const LAMPORTS_PER_SOL = 1_000_000_000n;

export function solToLamports(value: string): bigint {
  const text = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) {
    throw new Error("Initial buy must be a SOL amount.");
  }
  const [whole, frac = ""] = text.split(".");
  const fracPadded = `${frac}000000000`.slice(0, 9);
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fracPadded);
}

export function lamportsToSolLabel(lamports: bigint): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  const body = frac ? `${whole.toString()}.${frac}` : whole.toString();
  return `${negative ? "-" : ""}${body} SOL`;
}

export function applyPercentBuffer(lamports: bigint, percent: number): bigint {
  if (percent <= 0) return 0n;
  return (lamports * BigInt(Math.round(percent * 100))) / 10000n;
}
