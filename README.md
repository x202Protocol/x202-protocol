# x202 Protocol

Company earnings on Robinhood Chain about a minute after the SEC filing, and AI agents that act on them.

**x402 lets agents pay. x202 lets agents know.**

Website · [x202-protocol.vercel.app](https://x202-protocol.vercel.app) — Agents · [t.me/x202_agents_bot](https://t.me/x202_agents_bot)

## How it works

1. The SEC accepts a company's 8-K under **Item 2.02, Results of Operations**. That item is where the name x202 comes from.
2. x202 reads the press release with two independent methods. If they disagree on a single figure, nothing is published.
3. Revenue, EPS (GAAP and adjusted), next-quarter revenue guidance, the SEC accession number and the SEC acceptance time are written to the **X202Oracle** contract.
4. Contracts and AI agents read them onchain. Every onchain read is paid in the token, and the payment is burned.
5. On Telegram, anyone creates an AI agent for free: triggers (revenue growth, EPS, guidance) and a playbook. An agent deployed with a token deposit in **X202AgentVault** gets its alert about a minute after the filing. Each alert pays one read: 1,000 tokens, burned.

## Contracts (Robinhood Chain, chain ID 4663)

| Contract | Address | Role |
|---|---|---|
| X202Oracle | [`0xd291994E64B7f471b5345637701124D2fda2a7f7`](https://robinhoodchain.blockscout.com/address/0xd291994E64B7f471b5345637701124D2fda2a7f7) | Stores every earnings report. Paid reads, burned payment. |
| X202AgentVault | [`0xEdB56f399091396d7AEb3AC9713C3F6dA3916cec`](https://robinhoodchain.blockscout.com/address/0xEdB56f399091396d7AEb3AC9713C3F6dA3916cec) | Token deposits that pay agent alerts, at most once per report. |
| X202AgentBoard | [`0x87dE5FF42D3dAd0F65f2ca100bb4b90A0Cc50b93`](https://robinhoodchain.blockscout.com/address/0x87dE5FF42D3dAd0F65f2ca100bb4b90A0Cc50b93) | Public count of AI agents waiting for each company. |
| Writer | [`0xdE82430FB46d63BcfD0E61cD47d409622ebA3360`](https://robinhoodchain.blockscout.com/address/0xdE82430FB46d63BcfD0E61cD47d409622ebA3360) | The only key that can publish reports, fire alerts and post the count. |

The same addresses are in `deployments/mainnet.json`. Owner of the oracle and the vault: [`0xcE9580b767f68db0B2e046ea4Ed439132344198B`](https://robinhoodchain.blockscout.com/address/0xcE9580b767f68db0B2e046ea4Ed439132344198B).

## Who can do what

| | Depositor | x202 writer | x202 owner | Anyone |
|---|---|---|---|---|
| Fund an agent | ✅ the first wallet to deposit becomes its depositor, then only that wallet tops it up | ❌ | ❌ | ❌ |
| Withdraw a deposit | ✅ only the first depositor of that agent, anytime | ❌ never | ❌ never | ❌ |
| Spend a deposit | ❌ | Only one read per agent per report, paid to the oracle and burned | ❌ | ❌ |
| Publish an earnings report | ❌ | ✅ once per SEC filing, never overwritten | ❌ | ❌ |
| Change the payment token | ❌ | ❌ | ❌ set once, then fixed forever | ❌ |
| Change the fee or the burn share | ❌ | ❌ | ✅ | ❌ |
| Replace the writer or the operator | ❌ | ❌ | ✅ | ❌ |
| Read a report onchain | ✅ pays the fee | ✅ pays the fee | ✅ pays the fee | ✅ pays the fee |

The figures themselves stay public in every write transaction. The fee applies to contracts that read them onchain.

## Verify the deployment yourself

This repository holds the exact source of the deployed contracts. Anyone can check that the code onchain is this code:

```
npm install
npm run build
npm run verify:deployment
```

The script is read-only (no keys, no transactions). It compares the runtime bytecode of X202Oracle, X202AgentVault and X202AgentBoard on Robinhood Chain with the bytecode compiled from this repository, then checks who controls each contract and prints the payment token, the fee, the burn share, the total burned and the number of reports onchain.

Use your own RPC with `node scripts/verify-deployment.js --rpc https://...`.

## Run the tests

```
npm test
```

21 contract tests: paid reads and burns (with and without a token `burn()`), one write per filing, the token fixed once set, deposits that only the depositor can withdraw, one paid alert per agent per report.

## Layout

```
contracts/            X202Oracle, X202AgentVault, X202AgentBoard (+ contracts/test: tokens and a reader used by the tests)
test/                 contract tests
scripts/              verify-deployment.js (read-only)
deployments/          deployed addresses on Robinhood Chain
src/encode.js         how report fields are encoded
```

## License

MIT

Not affiliated with the SEC, Robinhood, Coinbase, the x402 Foundation or any company covered. Not financial advice.
