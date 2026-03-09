# Bilateral Agreement — Commit-Reveal Escrow with ECDSA

A trustless bilateral escrow smart contract on Ethereum. Two parties lock a 10% security deposit and privately commit their decisions (accept/reject) using a **commit-reveal scheme** with **ECDSA signature verification**. Dishonest behavior is economically penalized.

---

## Scenario

Two parties (A and B) need to reach a mutual agreement without trusting each other or a middleman. The problem: if decisions are visible on-chain, one party can see the other's vote and act accordingly (front-running).

**Why blockchain?** Transparency, immutability, and automated enforcement — no intermediary, no escrow agent, no trust required. The smart contract acts as a neutral judge.

**Who is it for?** Any bilateral agreement where both parties must independently commit to a decision and face consequences for dishonesty.

---

## Actors and Assumptions

| Actor | Role | Trust Level |
|-------|------|-------------|
| **Party A** | Deploys the contract, deposits funds, commits & reveals decision | Potentially malicious |
| **Party B** | Joins the agreement, deposits funds, commits & reveals decision | Potentially malicious |
| **Anyone** | Can call `executeContract()` after the reveal deadline | Untrusted (no privilege needed) |

**What's public on-chain:** Contract state, deposit amounts, deadlines, committed hashes (opaque), and final decisions (after reveal).  
**What's private:** Each party's decision remains hidden until both have committed.

---

## Protocol

### Phase Overview

```
Deploy → Deposit (10% of tx amount) → Commit (last 1hr window) → Reveal (ECDSA verified) → Execute
```

### Step-by-Step

1. **Deploy** — Party A deploys the contract with both parties' addresses, transaction amounts, ECDSA public keys, and time windows.

2. **Deposit** — Each party sends exactly 10% of their transaction amount as a security deposit. Once both deposit, the contract advances to the commit phase.

3. **Commit** — During the last hour before the commit deadline, each party submits a hash:
   ```
   hash = keccak256(decision || ECDSA_signature || salt)
   ```
   The 256-bit random salt prevents brute-forcing (only 2 possible decisions without it).

4. **Reveal** — After the commit deadline, each party reveals their decision, signature, and salt. The contract verifies:
   - **Hash integrity:** The revealed values reproduce the committed hash (no decision change)
   - **ECDSA signature:** `ecrecover` confirms the decision was signed by the registered key (no forgery)

5. **Execute** — After the reveal deadline, anyone calls `executeContract()`:

   | Outcome | Result |
   |---------|--------|
   | Both accept | Each recovers their deposit |
   | A accepts, B rejects | **A gets both deposits** (B penalized) |
   | B accepts, A rejects | **B gets both deposits** (A penalized) |
   | Neither accepts / non-participation | Each recovers their own deposit |

### Failure Cases

- **Party doesn't deposit** → Contract never advances; no funds at risk.
- **Party doesn't commit** → After deadlines, `executeContract()` refunds both deposits.
- **Party commits but doesn't reveal** → Treated as non-participation; deposits refunded.
- **Party tries to change decision after commit** → Hash mismatch → transaction reverts.
- **Party submits forged signature** → ECDSA verification fails → transaction reverts.

---

## Threats and Attacks

### Front-Running Attack
**Attack:** Party B waits to see Party A's decision in the mempool, then submits a favorable response.  
**Impact:** B always wins by reacting to A's choice.  
**Mitigation:** The **commit-reveal scheme** hides decisions behind hashes. By the time decisions are revealed, both are already locked in.

### Reentrancy Attack
**Attack:** A malicious contract receiving ETH calls `executeContract()` again before the first transfer finishes, draining funds.  
**Impact:** Could drain the entire contract balance.  
**Mitigation:** A `nonReentrant` mutex lock prevents recursive calls. State is updated (deposits zeroed) before any ETH transfer (checks-effects-interactions pattern).

### Signature Forgery
**Attack:** A party submits a signature from a different key to impersonate the other party.  
**Impact:** Could claim someone else's decision.  
**Mitigation:** On-chain `ecrecover` verifies the signature against the ECDSA public key registered at deployment.

---

## Cryptographic Primitives

| Primitive | Purpose | Security Property |
|-----------|---------|-------------------|
| **keccak256** | Hash decisions + salt for commit phase | Pre-image resistance, collision resistance |
| **ECDSA (secp256k1)** | Sign decisions off-chain, verify on-chain | Unforgeability, non-repudiation |
| **ecrecover** (EVM precompile) | Recover signer address from signature | Authenticates the decision signer |
| **Random salt** (256 bits) | Mixed into commit hash | Prevents brute-force of the 2 possible decisions |

**Commit-Reveal properties:**
- **Binding** — Once a hash is committed, you cannot change your decision (the hash wouldn't match)
- **Hiding** — The hash + salt make it computationally infeasible to determine the decision

---

## Security Summary

| Threat | Protection |
|--------|-----------|
| Decision front-running | Commit-reveal hides decisions |
| Decision forgery | ECDSA verification with `ecrecover` |
| Reentrancy | `nonReentrant` modifier (mutex) |
| Incorrect deposits | `require(msg.value == depositA)` |
| Duplicate actions | Boolean flags prevent double commit/reveal |
| Hash brute force | 256-bit entropy salt |
| Post-commit changes | Hash comparison catches any modification |

---

## Limitations

- **10% deposit is fixed** — Not configurable per agreement
- **Two parties only** — No multi-party support
- **Single-use** — Each contract handles one agreement; new deployment required for each
- **Deadlines start at deploy time** — If deposits are slow, the commit window shrinks
- **Binary decisions only** — Accept or reject; no partial agreements or counter-offers
- **ETH only** — No ERC-20 token support
- **Off-chain key management** — Users must store ECDSA private keys separately from their wallet
- **Not upgradable** — No proxy pattern; bugs require redeployment

---

## How to Reproduce the Demo

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the full test suite** (33 tests covering all phases and edge cases):
   ```bash
   npx hardhat test
   ```

3. **Run the end-to-end walkthrough** (deploys, deposits, commits, reveals, and executes with time-travel):
   ```bash
   npx hardhat run scripts/e2e-test.js
   ```

4. **Deploy to a live network** (requires `.env` with `SEPOLIA_RPC_URL` and `PRIVATE_KEY`):
   ```bash
   npx hardhat run scripts/deploy.js --network sepolia
   ```

---

## Project Structure

```
contracts/
  BilateralAgreement.sol       # Smart contract (Solidity ^0.8.20)
scripts/
  deploy.js                    # Deployment script
  e2e-test.js                  # End-to-end walkthrough script
test/
  BilateralAgreement.test.js   # Full test suite (33 tests)
offchain-helper.js             # Off-chain utility functions
hardhat.config.js              # Hardhat configuration
```

