// Checks that the contracts running on Robinhood Chain are exactly the code in this repository,
// and prints who controls what. Read-only: no keys, no transactions.
//   npm install && npm run build && npm run verify:deployment
//   node scripts/verify-deployment.js [deployments/mainnet.json] [--rpc https://...]
import fs from 'node:fs';
import path from 'node:path';
import { JsonRpcProvider, Contract, getAddress, formatUnits } from 'ethers';

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : null; };
const file = args.find((a) => a.endsWith('.json')) || 'deployments/mainnet.json';
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const provider = new JsonRpcProvider(flag('--rpc') || d.rpc, d.chainId, { staticNetwork: true });

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

// Compiled runtime code, with immutable slots blanked (they hold constructor values such as the oracle address).
const buildInfos = fs.readdirSync('artifacts/build-info').map((f) => JSON.parse(fs.readFileSync(path.join('artifacts/build-info', f), 'utf8')));
function compiled(name) {
  for (const b of buildInfos) {
    const c = b.output.contracts[`contracts/${name}.sol`]?.[name];
    if (c) return { code: c.evm.deployedBytecode.object, imm: c.evm.deployedBytecode.immutableReferences || {} };
  }
  throw new Error(`${name} not compiled: run npm run build`);
}
function blank(hex, imm) {
  const b = hex.replace(/^0x/, '').toLowerCase().split('');
  for (const refs of Object.values(imm)) for (const { start, length } of refs) b.fill('0', start * 2, (start + length) * 2);
  return b.join('');
}

console.log(`Robinhood Chain (chain ${d.chainId}) · ${file}\n`);
for (const name of ['X202Oracle', 'X202AgentBoard', 'X202AgentVault']) {
  const c = compiled(name);
  const onchain = await provider.getCode(d[name]);
  ok(onchain !== '0x' && blank(onchain, c.imm) === blank(c.code, c.imm), `${name} ${d[name]}: deployed code = this repository`);
}

const oracle = new Contract(d.X202Oracle, [
  'function owner() view returns (address)', 'function writer() view returns (address)', 'function paymentToken() view returns (address)',
  'function readFee() view returns (uint256)', 'function burnBps() view returns (uint16)', 'function burnToDead() view returns (bool)',
  'function count() view returns (uint256)', 'function totalReads() view returns (uint256)', 'function totalBurned() view returns (uint256)',
], provider);
const vault = new Contract(d.X202AgentVault, ['function oracle() view returns (address)', 'function owner() view returns (address)', 'function operator() view returns (address)'], provider);
const board = new Contract(d.X202AgentBoard, ['function poster() view returns (address)'], provider);

const same = (a, b) => getAddress(a) === getAddress(b);
console.log('');
ok(same(await vault.oracle(), d.X202Oracle), 'the vault pays reads on this oracle only');
ok(same(await oracle.writer(), d.writer), `oracle writer (publishes earnings): ${d.writer}`);
ok(same(await vault.operator(), d.writer), `vault operator (fires alerts): ${d.writer}`);
ok(same(await board.poster(), d.writer), `board poster (agent count): ${d.writer}`);
console.log(`     oracle owner: ${await oracle.owner()}`);
console.log(`     vault owner:  ${await vault.owner()}`);

const token = await oracle.paymentToken();
if (/^0x0+$/.test(token)) console.log('\n     payment token: not plugged yet');
else {
  const t = new Contract(token, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'], provider);
  const [sym, dec, fee, bps, dead] = await Promise.all([t.symbol(), t.decimals(), oracle.readFee(), oracle.burnBps(), oracle.burnToDead()]);
  console.log(`\n     payment token: ${sym} ${token}`);
  console.log(`     fee per read:  ${formatUnits(fee, dec)} ${sym}, ${Number(bps) / 100}% burned ${dead ? '(sent to 0x…dEaD)' : '(burn())'}`);
  console.log(`     reads: ${await oracle.totalReads()} · burned: ${formatUnits(await oracle.totalBurned(), dec)} ${sym}`);
}
console.log(`     earnings reports onchain: ${await oracle.count()}`);
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
