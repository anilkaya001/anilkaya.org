const big = (n) => BigInt(n);

export const halfUpDiv = (num, den) => (2n * num + den) / (2n * den);

export const centsOfDollars = (dollarsText) => {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(dollarsText));
  if (!m) throw new Error("not a plain decimal: " + dollarsText);
  const frac = m[2] || "";
  const scaled = big(m[1] + frac);
  const den = 10n ** big(frac.length);
  return halfUpDiv(scaled * 100n, den);
};

export const ratioTextExact = (p, c) => {
  const P = big(p), C = big(c);
  if (P <= 0n || C <= 0n) return null;
  const hundredths = halfUpDiv(P * 10000n, C);
  if (hundredths === 0n) return "<0.01%";
  if (hundredths < 1000n) return (hundredths / 100n).toString() + "." + (hundredths % 100n).toString().padStart(2, "0") + "%";
  const tenths = halfUpDiv(P * 1000n, C);
  const whole = tenths / 10n, d = tenths % 10n;
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + d.toString() + "%";
};

export const ratioMicroExact = (p, c) => {
  const P = big(p), C = big(c);
  if (P <= 0n || C <= 0n) return null;
  const micro = halfUpDiv(P * 1000000n, C);
  if (micro !== 0n) return Number(micro) / 1e6;
  const fine = halfUpDiv(P * 10000000000n, C);
  return fine === 0n ? null : Number(fine) / 1e10;
};

export const contractCents = (perShareText) => {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(perShareText));
  if (!m) throw new Error("not a plain decimal: " + perShareText);
  const frac = m[2] || "";
  return halfUpDiv(big(m[1] + frac) * 10000n, 10n ** big(frac.length));
};

export const dollarsTextExact =(c, always = true) => {
  const C = big(c);
  const whole = C / 100n, rem = C % 100n;
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "$" + w + (rem === 0n && !always ? "" : "." + rem.toString().padStart(2, "0"));
};
