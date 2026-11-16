// Shared encoding between the watcher, the page, the agent and the tests.
import { encodeBytes32String, getBytes, hexlify, toUtf8String } from 'ethers';

export function bytesN(s, n) {
  const b = new TextEncoder().encode(s);
  if (b.length > n) throw new Error(`"${s}" longer than ${n} bytes`);
  const out = new Uint8Array(n); out.set(b);
  return hexlify(out);
}
export const fromBytes = (hex) => toUtf8String(getBytes(hex)).replace(/\0+$/, '');
export const accessionBytes = (acc) => bytesN(acc.replace(/-/g, ''), 20);
export const accessionFromBytes = (hex) => { const s = fromBytes(hex); return `${s.slice(0, 10)}-${s.slice(10, 12)}-${s.slice(12)}`; };
export const e4 = (v) => (v == null ? 0n : BigInt(Math.round(v * 1e4)));

// Report (from extract + edgar) -> publish() arguments
export function publishArgs(r) {
  return [
    Number(String(r.cik).replace(/^0+/, '')),
    bytesN(r.ticker || '', 16),
    bytesN(r.period || '', 16),
    BigInt(r.revenue),
    e4(r.epsGaap),
    e4(r.epsAdj),
    BigInt(r.guidance ?? 0),
    BigInt(Math.floor(Date.parse(r.acceptedAt) / 1000)),
    accessionBytes(r.accession),
  ];
}
export { encodeBytes32String };
