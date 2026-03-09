# Bilateral Agreement — Commit-Reveal Escrow Contract

A Solidity smart contract implementing a **bilateral agreement** with:
- **Commit-reveal** decision scheme (privacy until both parties reveal)
- **ECDSA signature verification** (authenticity of each decision)
- **10% security deposit** with economic penalty for rejection

## How It Works

Two parties (A and B) enter a bilateral agreement. Each deposits 10% of their transaction amount as a security guarantee. They then secretly commit a hash of their decision (accept/reject), reveal their decisions after the commit window closes, and the contract executes based on the outcome:

| Scenario | Result |
|----------|--------|
| Both accept | Each recovers their deposit |
| A accepts, B rejects | **A gets both deposits** (B penalized) |
| B accepts, A rejects | **B gets both deposits** (A penalized) |
| Neither accepts | Each recovers their own deposit |

### Contract Phases

```
Deploy → Deposit (10% of tx amount) → Commit (last 1hr window) → Reveal (ECDSA verified) → Execute
```

1. **Deploy** — Set parties, ECDSA public keys, transaction amounts, and time windows
2. **Deposit** — Each party sends exactly 10% of their transaction amount (`depositA = amountA / 10`)
3. **Commit** — During the last hour before the commit deadline, each party submits `keccak256(abi.encodePacked(decision, salt))`
4. **Reveal** — After commit deadline, each party reveals their decision with an ECDSA signature (`v`, `r`, `s`) and salt
5. **Execute** — After reveal deadline, anyone can call `executeContract()` to distribute funds based on decisions

## Tech Stack

- **Solidity** ^0.8.20
- **Hardhat** for compilation, testing, and deployment
- **ethers.js v6** in tests and scripts
- **Chai** for assertions

## Quick Start

```bash
# Install dependencies
npm install

# Compile the contract
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to local Hardhat network
npx hardhat run scripts/deploy.js

# Deploy to Sepolia testnet (requires .env with SEPOLIA_RPC_URL and PRIVATE_KEY)
npx hardhat run scripts/deploy.js --network sepolia
```

## Project Structure

```
contracts/
  BilateralAgreement.sol    # Main smart contract
scripts/
  deploy.js                 # Deployment script
test/
  BilateralAgreement.test.js # Full test suite
offchain-helper.js          # Off-chain helper utilities
hardhat.config.js           # Hardhat configuration
```

## Deployment

The deploy script generates independent ECDSA key pairs for both parties (separate from wallet signers). Save the private keys — they're needed to sign decisions during the reveal phase.

```bash
npx hardhat run scripts/deploy.js
```

Set `PARTY_B_ADDRESS` in your `.env` to use a real address for Party B. If not set, a random wallet is generated for testing.

## Documentation

See [MegaReview_EscrowContract_EN.md](MegaReview_EscrowContract_EN.md) for a comprehensive technical review covering:
- Line-by-line smart contract analysis
- Cryptographic concepts (commit-reveal, ECDSA, keccak256)
- Security analysis and attack vectors
- Limitations and future improvements

## License

MIT
