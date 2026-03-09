# 🔬 Mega Review: Escrow Contract with Commit-Reveal & ECDSA

> **NOTE:** Hyper-detailed review of the entire code and flow of the BlockChain-Hackathon project. Each file, each function, each variable is explained — the rationale behind every decision and the full end-to-end flow.

---

## 📂 Project Structure

```
BlockChain-Hackathon/
├── EscrowContract.sol          ← 🧠 Main smart contract (623 lines)
├── escrow-utilities.js         ← 🔧 Off-chain utilities (332 lines)
├── generar-datos-testing.js    ← 🧪 Test data generator (68 lines)
├── README.md                   ← 📖 Project description
├── GUIA_USO_REMIX.md           ← 📋 Step-by-step Remix guide
├── RESUMEN_EJECUTIVO.md        ← 📊 Executive summary
├── QUICK_REFERENCE.md          ← ⚡ Quick reference
├── comparacion.md              ← ⚖️ Comparison with another project
├── context.md                  ← 📝 Full technical context
└── Escrow_Avanzado_*.docx      ← 📄 Technical justification (Word)
```

---

## 🧠 1. THE SMART CONTRACT: EscrowContract.sol

This is the heart of the entire project. It is a Solidity contract that implements an advanced bilateral escrow with two key cryptographic mechanisms:

1. **Commit-Reveal Scheme** → For privacy (so nobody knows your decision ahead of time)
2. **ECDSA Signatures** → For authenticity and non-repudiation (proving that YOU signed your decision)

### 1.1 Header and License

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
```

- **SPDX-License-Identifier:** Standard license identifier. MIT is a permissive open-source license.
- **pragma solidity ^0.8.20:** The contract requires Solidity version 0.8.20 or higher. This version includes built-in protections against arithmetic overflow/underflow and security improvements.

### 1.2 Enums (Enumerated Types)

#### ContractStatus — Lines 27-34

```solidity
enum ContractStatus {
    Created,        // 0: Contract created, awaiting deposits
    Deposited,      // 1: Both parties deposited
    CommitPhase,    // 2: Commit period
    RevealPhase,    // 3: Reveal period
    Executed,       // 4: Contract executed successfully
    Cancelled       // 5: Contract cancelled
}
```

Represents the contract's state machine. Each transaction is only valid in certain states:

```
stateDiagram-v2
    [*] --> Created: Constructor
    Created --> CommitPhase: Both deposit
    CommitPhase --> RevealPhase: Commit deadline or manual transition
    RevealPhase --> Executed: Both accept
    RevealPhase --> Cancelled: Disagreement / Non-participation
```

> **IMPORTANT:** The `Deposited` state (1) is defined in the enum but never used in the code. The contract jumps directly from `Created` to `CommitPhase` when both parties deposit. It is a design vestige.

#### Decision — Lines 36-40

```solidity
enum Decision {
    NotParticipated,    // 0: Did not participate
    Rejected,           // 1: Rejected
    Accepted            // 2: Accepted
}
```

Three possible decisions per party. Using a 3-value enum instead of a `bool` allows differentiating between "did not participate" (never revealed) vs. "actively rejected." This is semantically important for execution logic.

### 1.3 Struct: SignatureInfo — Lines 43-47

```solidity
struct SignatureInfo {
    bytes32 r;      // ECDSA signature r component
    bytes32 s;      // ECDSA signature s component
    uint8 v;        // v component (27 or 28)
}
```

Stores the 3 standard components of an ECDSA signature on the secp256k1 curve:

- **r:** x-coordinate of the random point R on the curve (32 bytes)
- **s:** Mathematical proof computed with the private key (32 bytes)
- **v:** Recovery byte (27 or 28) — needed so that `ecrecover` can determine which of the two possible public keys is correct

### 1.4 State Variables — Lines 49-93

| Variable | Type | Purpose |
|----------|------|---------|
| partyA | address | Ethereum address of the seller |
| partyB | address | Ethereum address of the buyer |
| publicKeyA | bytes32 | keccak256 of A's ECDSA public key |
| publicKeyB | bytes32 | keccak256 of B's ECDSA public key |
| amountA | uint256 | Total transaction amount for A (in wei) |
| amountB | uint256 | Total transaction amount for B (in wei) |
| depositA | uint256 | Security deposit for A = amountA / 10 (10%) |
| depositB | uint256 | Security deposit for B = amountB / 10 (10%) |
| depositedA | uint256 | Actual amount deposited by A |
| depositedB | uint256 | Actual amount deposited by B |
| commitDeadline | uint256 | UNIX timestamp for end of commit phase |
| revealDeadline | uint256 | UNIX timestamp for end of reveal phase |
| hashA / hashB | bytes32 | Committed hashes from each party |
| decisionA / decisionB | Decision | Revealed decisions |
| sigA / sigB | SignatureInfo | Stored ECDSA signatures |
| status | ContractStatus | Current state |
| aHasCommitted / bHasCommitted | bool | Commit participation tracking |
| aHasRevealed / bHasRevealed | bool | Reveal participation tracking |
| transactionLog | string[] | Text log of actions (for debugging) |

> **TIP:** Public keys are stored as `bytes32` (hash) instead of direct `address`. This adds an abstraction layer: the contract does not store the ECDSA address directly but its `keccak256` hash, which is more flexible but requires an extra verification step.

### 1.5 Events — Lines 96-149

Events are immutable records on the blockchain. They are not stored in storage (cheaper in gas) and can be queried externally.

| Event | Parameters | When Emitted |
|-------|------------|--------------|
| ContractCreated | partyA, partyB, amounts, deadlines | In the constructor |
| FundsDeposited | party, amount, timestamp | When depositing funds |
| HashCommitted | party, hash, timestamp | When submitting commit hash |
| DecisionRevealed | party, decision, timestamp | When revealing decision |
| SignatureVerified | party, isValid, timestamp | When verifying ECDSA signature |
| ContractExecuted | bothAccepted, winner, amount, timestamp | When executing contract |
| FundsReturned | party, amount, reason, timestamp | When returning funds |
| ContractCancelled | reason, timestamp | When cancelling |

The `indexed` parameters (like `address indexed party`) allow efficient filtering of blockchain logs.

### 1.6 Modifiers — Lines 151-228

Modifiers are reusable preconditions that execute before the function body. The `_;` marks where the body is inserted.

#### onlyParties — Only A or B can call

```solidity
modifier onlyParties() {
    require(msg.sender == partyA || msg.sender == partyB, "...");
    _;
}
```

#### inCommitPhase — Only during the commit phase

```solidity
modifier inCommitPhase() {
    require(status == ContractStatus.CommitPhase, "...");
    require(block.timestamp < commitDeadline, "...");
    _;
}
```

Verifies two things: that the state is `CommitPhase` AND that the deadline has not passed.

#### inRevealPhase — Only during the reveal phase

Analogous to the previous one but for `RevealPhase`.

#### afterCommitDeadline / afterRevealDeadline — After deadlines

Verify that `block.timestamp >= deadline`. Defined but not used as modifiers in any function of the current contract (timing logic is handled inline).

#### noReentrancy — Anti-reentrancy

```solidity
uint256 private locked = 0;
modifier noReentrancy() {
    require(locked == 0, "Reentrant calls not allowed");
    locked = 1;
    _;
    locked = 0;
}
```

> **WARNING:** This is a manual mutex to prevent reentrancy attacks. Without this, a malicious contract receiving ETH could call `executeContract()` again before the first execution finishes, draining the funds. It is similar to OpenZeppelin's `ReentrancyGuard` pattern.

### 1.7 Constructor — Lines 245-286

```solidity
constructor(
    address _partyA,  address _partyB,
    bytes32 _publicKeyA,  bytes32 _publicKeyB,
    uint256 _amountA,  uint256 _amountB,
    uint256 _commitDurationSeconds,
    uint256 _revealDurationSeconds
)
```

**Internal constructor flow:**

1. **Validations (7 `require`):**
   - Addresses non-zero and different
   - Amounts > 0
   - Durations > 0

2. **State assignment:**
   - Stores parties, keys, amounts
   - **Computes 10% security deposits:** `depositA = _amountA / 10`, `depositB = _amountB / 10`
   - Computes deadlines: `commitDeadline = block.timestamp + _commitDurationSeconds`
   - `revealDeadline` starts after commit: `commitDeadline + _revealDurationSeconds`

3. **Initial state:** `Created`

4. **Log + Event:** Records in `transactionLog` and emits `ContractCreated`

> **IMPORTANT:** Deadlines are calculated at deploy time, not when deposits begin. This means that if parties take too long to deposit, the commit phase will be shorter. In production, consider calculating deadlines upon deposit completion.

### 1.8 Function `depositFunds()` — Lines 292-323

```solidity
function depositFunds() public payable onlyParties { ... }
```

**Detailed flow:**

1. **Precondition:** State must be `Created`
2. **Identifies who deposits** (`msg.sender == partyA` or `partyB`)
3. **Verifies exact amount:** `msg.value == depositA` (10% of transaction amount) — no more, no less
4. **Verifies no duplicate:** `depositedA == 0` (one-time only)
5. **Records deposit:** `depositedA = msg.value`
6. **Emits event** `FundsDeposited`
7. **Automatic transition:** If BOTH have deposited (`depositedA > 0 && depositedB > 0`), transitions to `CommitPhase`

```
sequenceDiagram
    participant A as PartyA
    participant C as Contract
    participant B as PartyB

    A->>C: depositFunds() + ETH
    Note over C: depositedA = msg.value
    B->>C: depositFunds() + ETH
    Note over C: depositedB = msg.value
    Note over C: status → CommitPhase ✅
```

### 1.9 Function `commitHash()` — Lines 330-358

```solidity
function commitHash(bytes32 _hash) public onlyParties inCommitPhase { ... }
```

This is the first half of the Commit-Reveal Scheme. Each party sends an opaque hash that hides their decision.

**What is the hash being sent?**

```
hash = keccak256(decision || r || s || v || salt)
```

Where:
- **decision:** 0, 1, or 2 (the actual decision)
- **r, s, v:** ECDSA signature of the decision
- **salt:** 32 random bytes (prevents brute-force attacks)

**Why does this provide privacy?**

- There are only 3 possible decisions (0, 1, 2)
- Without salt, an attacker could simply hash the 3 decisions and compare them
- With salt (256 bits of entropy) it is computationally impossible to reverse the hash

**Flow:**

1. Verifies hash is non-zero
2. Stores in `hashA` or `hashB`
3. Marks `aHasCommitted` or `bHasCommitted` as `true`
4. If `block.timestamp >= commitDeadline`, transitions to `RevealPhase`

> **NOTE:** The time-window restriction (commits only in the last 5 min) is commented out for testing in Remix VM, where the timestamp does not advance automatically. In production, it would be uncommented.

### 1.10 Function `transitionToRevealPhase()` — Lines 364-375

```solidity
function transitionToRevealPhase() public { ... }
```

Allows manual advancement to the reveal phase. Activates if:
- The `commitDeadline` has passed, **OR**
- Both parties have already committed (`aHasCommitted && bHasCommitted`)

The second condition is a UX optimization: if both have already committed, why wait for the deadline?

### 1.11 Function `revealDecision()` — Lines 386-443

```solidity
function revealDecision(
    uint8 _decision,
    bytes32 _r, bytes32 _s, uint8 _v,
    bytes32 _salt
) public onlyParties inRevealPhase { ... }
```

This is the second half of the Commit-Reveal and where the double cryptographic verification happens.

**Detailed flow (for PartyA):**

1. **Verifies no duplicate:** `!aHasRevealed`

2. **Verifies hash (commit integrity):**
```solidity
bytes32 calculatedHash = keccak256(
    abi.encodePacked(_decision, _r, _s, _v, _salt)
);
require(calculatedHash == hashA, "Hash does not match");
```
Reconstructs the hash with the revealed parameters. If it matches the committed hash, it means they DID NOT CHANGE their decision.

3. **Verifies ECDSA signature (authenticity):**
```solidity
bool isValidSignature = verifySignature(
    _decision, _r, _s, _v, publicKeyA
);
require(isValidSignature, "Invalid signature");
```
Verifies that the decision was actually signed by A's private key.

4. **Records:** `decisionA = Decision(_decision)`, stores signature, marks `aHasRevealed = true`

5. **Emits events:** `DecisionRevealed` and `SignatureVerified`

```
flowchart TD
    A[revealDecision called] --> B{Already revealed?}
    B -->|Yes| C[❌ REVERT]
    B -->|No| D[Recompute hash]
    D --> E{Hash matches commit?}
    E -->|No| F[❌ REVERT: Hash does not match]
    E -->|Yes| G[Verify ECDSA signature]
    G --> H{Valid signature?}
    H -->|No| I[❌ REVERT: Invalid signature]
    H -->|Yes| J[✅ Record decision + signature]
    J --> K[Emit events]
```

### 1.12 Function `verifySignature()` — Lines 517-541

```solidity
function verifySignature(
    uint8 _decision,
    bytes32 _r, bytes32 _s, uint8 _v,
    bytes32 _expectedPublicKeyHash
) internal pure returns (bool) { ... }
```

This function implements on-chain ECDSA verification. It is `internal pure` (does not modify or read state, only computes).

**Step by step:**

1. **Hash the message:**
```solidity
bytes32 messageHash = keccak256(abi.encodePacked(_decision));
```
The "message" that was signed is simply the decision (a `uint8`).

2. **Add Ethereum prefix:**
```solidity
bytes32 ethSignedMessageHash = keccak256(
    abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
);
```
Ethereum adds this standard prefix (EIP-191) so that message signatures cannot be confused with transaction signatures. This is a fundamental security measure.

3. **Recover signer with `ecrecover`:**
```solidity
address signer = ecrecover(ethSignedMessageHash, _v, _r, _s);
```
`ecrecover` is a precompiled EVM function that, given a hash and a signature (r, s, v), recovers the public address that signed. It uses elliptic curve mathematics: from the signature and message, it computes the curve point corresponding to the public key.

4. **Compare with expected key:**
```solidity
bytes32 signerPublicKeyHash = keccak256(abi.encodePacked(signer));
return signerPublicKeyHash == _expectedPublicKeyHash;
```
Hashes the recovered address and compares it with the hash of the public key registered at contract creation.

> **WARNING:** There is a subtlety here: the public keys from the constructor are stored as `keccak256(address)`, so the comparison also hashes the signer's address. This is consistent but different from comparing addresses directly (as the companion's version does).

### 1.13 Function `executeContract()` — Lines 453-501

```solidity
function executeContract() public noReentrancy { ... }
```

This is the final resolution function. It can be called by anyone (not just the parties). It follows the **checks-effects-interactions** pattern.

**Execution conditions:**
- State = `RevealPhase`
- The `revealDeadline` has passed OR both have already revealed

**Decision logic:**

```
flowchart TD
    A[executeContract] --> B{Both accepted?}
    B -->|Yes| C[Each recovers their own deposit]
    B -->|No| D{One accepted, one rejected?}
    D -->|Yes| E[Acceptor gets BOTH deposits as penalty]
    D -->|No| F[Mutual disagreement: each recovers their own]
    C --> G["status = Executed ✅"]
    E --> H["status = Failed ❌"]
    F --> H
```

The deposit is **10% of each party's transaction amount**, acting as a security guarantee. The execution logic creates a real economic incentive:

| Scenario | Result |
|----------|--------|
| Both accept | Each recovers their 10% deposit |
| A accepts, B rejects | A gets both deposits (B penalized) |
| B accepts, A rejects | B gets both deposits (A penalized) |
| Neither accepts | Each recovers their own (mutual disagreement) |
| Non-participation | Each recovers their own |

```solidity
if (bothAccepted) {
    _transfer(partyA, _dA);
    _transfer(partyB, _dB);
} else if (aAccepted && !bAccepted) {
    _transfer(partyA, _dA + _dB); // Penalty: B loses deposit to A
} else if (!aAccepted && bAccepted) {
    _transfer(partyB, _dA + _dB); // Penalty: A loses deposit to B
} else {
    _transfer(partyA, _dA);
    _transfer(partyB, _dB);
}
```

Uses `.call{value: ...}("")` instead of `.transfer()` for compatibility with contracts that need more than 2300 gas.

### 1.14 View Functions — Lines 546-613

Read-only functions (cost no gas when called externally):

| Function | Returns |
|----------|---------|
| getStatusString() | Status as readable text ("Created", "CommitPhase", etc.) |
| getTimeRemainingCommit() | Seconds remaining in commit (int256, can be negative) |
| getTimeRemainingReveal() | Seconds remaining in reveal |
| getTransactionLog() | Full array of text logs |
| getLogLength() | Number of log entries |
| getDecisions() | Tuple with decisions and reveal status of both parties |
| getDepositedAmounts() | Amounts deposited by each party |

### 1.15 Fallback `receive()` — Lines 619-621

```solidity
receive() external payable {
    // The contract can receive funds
}
```

Allows the contract to receive ETH sent directly (without calling any function). Necessary for `.call{value: ...}` transfers to work if the contract is the recipient.

---

## 🔧 2. OFF-CHAIN UTILITIES: escrow-utilities.js

Node.js script that uses `ethers.js` to perform all the cryptographic operations done outside the blockchain.

### 2.1 `generateECDSAKeys()` — Lines 26-35

```javascript
function generateECDSAKeys() {
    const wallet = ethers.Wallet.createRandom();
    return {
        privateKey: wallet.privateKey,
        publicKey: wallet.publicKey,
        address: wallet.address,
        publicKeyHash: ethers.utils.keccak256(wallet.publicKey)
    };
}
```

Generates a random key pair using the secp256k1 curve (the same as Ethereum). `publicKeyHash` is the value passed to the contract constructor as `_publicKeyA` or `_publicKeyB`.

### 2.2 `createSignatureForDecision()` — Lines 47-94

The most important function in the utilities. Generates everything needed for the commit + reveal flow.

```javascript
function createSignatureForDecision(decision, privateKey) {
    // 1. Create wallet with private key
    const wallet = new ethers.Wallet(privateKey);

    // 2. Generate random salt (32 bytes = 256 bits of entropy)
    const salt = '0x' + crypto.randomBytes(32).toString('hex');

    // 3. Pack the decision as uint8 (Solidity format)
    const message = ethers.utils.solidityPack(['uint8'], [decision]);

    // 4. Sign the message hash with the private key
    const signature = wallet._signingKey().signDigest(
        ethers.utils.keccak256(message)
    );

    // 5. Extract r, s, v components
    const r = signature.r;
    const s = signature.s;
    const v = signature.recoveryParam + 27;  // 0/1 → 27/28

    // 6. Compute commit hash
    const hash = ethers.utils.keccak256(
        ethers.utils.solidityPack(
            ['uint8', 'bytes32', 'bytes32', 'uint8', 'bytes32'],
            [decision, r, s, v, salt]
        )
    );

    return { decision, r, s, v, salt, hash, ... };
}
```

**Visual flow:**

```
decision (2 = Accept)
    ↓
keccak256(solidityPack(uint8, [2]))  →  messageHash
    ↓
signDigest(messageHash, privateKey)  →  {r, s, recoveryParam}
    ↓
v = recoveryParam + 27  →  27 or 28
    ↓
keccak256(solidityPack([decision, r, s, v, salt]))  →  commitHash
```

> **IMPORTANT:** This function uses `_signingKey().signDigest()` which signs the hash directly (without the Ethereum prefix). However, the Solidity contract DOES add the `\x19Ethereum Signed Message:\n32` prefix. This may cause incompatibility in on-chain verification. The `generar-datos-testing.js` script uses `wallet.signMessage()` which DOES add the prefix, making it compatible with `ecrecover` in the contract.

### 2.3 `verifySignatureOffChain()` — Lines 109-132

Replicates the contract's `verifySignature()` logic in JavaScript. Useful for testing before spending gas.

### 2.4 `formatForReveal()` / `formatConstructorParams()` — Lines 171-205

Generate formatted strings for copy-pasting directly into Remix IDE.

### 2.5 `demonstrateFullFlow()` — Lines 214-308

Complete demo that:
1. Generates keys for A and B
2. Creates signatures for both (decision = 2 = Accept)
3. Verifies signatures off-chain
4. Formats parameters for Remix

Run with: `node escrow-utilities.js`

---

## 🧪 3. TEST DATA GENERATOR: generar-datos-testing.js

Practical script for generating real test data with MetaMask wallets.

### Key difference vs escrow-utilities.js

| Aspect | escrow-utilities.js | generar-datos-testing.js |
|--------|--------------------|-----------------------|
| Keys | Generates random ones | Uses MetaMask keys (you provide them) |
| Signing | signDigest (no prefix) | signMessage (with prefix ✅) |
| Public key | keccak256(publicKey) | keccak256(solidityPack(address)) |
| Purpose | Educational demo | Real testing on Sepolia |

**Script flow:**

```javascript
// 1. User enters their MetaMask private keys
const PRIVATE_KEY_A = '0xENTERPRIVATEKEYA';
const PRIVATE_KEY_B = '0xENTERPRIVATEKEYB';

// 2. Verifies keys yield expected addresses
if (walletA.address.toLowerCase() !== EXPECTED_A.toLowerCase()) { ... }

// 3. Computes publicKeyHash as keccak256(solidityPack(['address'], [wallet.address]))
const publicKeyA = ethers.utils.keccak256(
    ethers.utils.solidityPack(['address'], [walletA.address])
);

// 4. Signs the decision WITH Ethereum prefix (wallet.signMessage)
const sigA_raw = await walletA.signMessage(ethers.utils.arrayify(messageHash));

// 5. Generates salt and computes commit hash
// 6. Prints EVERYTHING needed to copy into Remix
```

> **CAUTION:** The script accepts private keys as constants in the code. NEVER commit real private keys (not even testnet) to a public repository.

---

## 🔄 4. FULL END-TO-END FLOW

Here is the complete flow that a successful escrow transaction follows, from preparation to execution:

```
sequenceDiagram
    autonumber
    participant OA as Off-chain A
    participant A as PartyA Wallet
    participant SC as Smart Contract
    participant B as PartyB Wallet
    participant OB as Off-chain B

    Note over SC: === PHASE 0: DEPLOY ===
    A->>SC: constructor(partyA, partyB, keys, amounts, durations)
    Note over SC: status = Created

    Note over SC: === PHASE 1: DEPOSITS ===
    A->>SC: depositFunds() + ETH
    B->>SC: depositFunds() + ETH
    Note over SC: status = CommitPhase

    Note over OA,OB: === PHASE 2: COMMIT (off-chain + on-chain) ===
    Note over OA: Decides: ACCEPT (2)
    Note over OA: ECDSA Signature: sign(keccak256(2))
    Note over OA: Generates random salt
    Note over OA: hashA = keccak256(2 || r || s || v || salt)
    OA->>A: hashA
    A->>SC: commitHash(hashA)

    Note over OB: Decides: ACCEPT (2)
    Note over OB: ECDSA Signature: sign(keccak256(2))
    Note over OB: Generates random salt
    Note over OB: hashB = keccak256(2 || r || s || v || salt)
    OB->>B: hashB
    B->>SC: commitHash(hashB)

    Note over SC: === TRANSITION ===
    A->>SC: transitionToRevealPhase()
    Note over SC: status = RevealPhase

    Note over SC: === PHASE 3: REVEAL ===
    A->>SC: revealDecision(2, r, s, v, salt)
    Note over SC: ✅ Hash matches + Valid ECDSA signature
    B->>SC: revealDecision(2, r, s, v, salt)
    Note over SC: ✅ Hash matches + Valid ECDSA signature

    Note over SC: === PHASE 4: EXECUTION ===
    A->>SC: executeContract()
    SC->>A: Deposit A returned (both accepted)
    SC->>B: Deposit B returned (both accepted)
    Note over SC: status = Executed ✅
```

---

## 🔐 5. CRYPTOGRAPHIC CONCEPTS IN DEPTH

### 5.1 Commit-Reveal Scheme

**Problem it solves:** In a simple escrow where parties vote on-chain directly, votes are publicly visible instantly. If A votes "Yes," B sees it in the mempool and can change their behavior (front-running).

**Solution:**
1. **Commit:** Send `hash(decision + signature + salt)` — an irrevocable but opaque commitment
2. **Reveal:** After the deadline, reveal the original values

**Cryptographic properties of the scheme:**
- **Binding:** Once the hash is committed, you cannot change your decision (the hash would not match)
- **Hiding:** The hash + salt make it impossible to infer the decision

### 5.2 ECDSA (Elliptic Curve Digital Signature Algorithm)

**Curve:** secp256k1 ($y^2 = x^3 + 7$ over a prime finite field)

**Signing flow:**
1. Compute message hash: $h = \text{keccak256}(\text{message})$
2. Generate random number $k$ (nonce)
3. Compute point $R = k \times G$ on the curve, extract x-coordinate → $r$
4. Compute $s = k^{-1} \times (h + r \times \text{privateKey}) \mod n$
5. The signature is $(r, s, v)$ where $v$ indicates parity of the y-coordinate

**`ecrecover` in the EVM:**
- It is a precompiled function (address `0x01` in the EVM)
- Given $(hash, v, r, s)$, returns the signer's public address
- Internally reverses the elliptic curve equations

### 5.3 keccak256

This is Ethereum's native hash function (SHA-3 variant):
- **Input:** Any number of bytes
- **Output:** 32 bytes (256 bits)
- **Properties:** Pre-image resistance, collision resistance, avalanche effect

---

## 📊 6. CONTRACT SECURITY ANALYSIS

| Threat | Protection Implemented |
|--------|----------------------|
| Decision front-running | Commit-Reveal scheme hides decisions |
| Decision forgery | On-chain ECDSA verification with `ecrecover` |
| Repudiation ("I didn't sign that") | ECDSA signature provides cryptographic non-repudiation |
| Reentrancy attack | `noReentrancy` modifier (mutex) |
| Incorrect deposits | Exact `require(msg.value == amountA)` |
| Duplicate participation | `aHasCommitted`, `aHasRevealed` flags |
| Null addresses | `!= address(0)` validation in constructor |
| Hash brute force | 256-bit entropy salt |
| Post-commit decision change | `calculatedHash == hashA` verification |

> **WARNING:** Potential issue: The `transactionLog` (string array) is expensive in gas. Each `push` writes to storage. In production, this could be removed, using only events (which are already implemented).

---

## ⚠️ 7. LIMITATIONS OF THE SOLUTION

### 7.1 Deposit Is Fixed at 10% (Not Configurable)

The security deposit is hardcoded at 10% of the transaction amount (`amountA / 10`). This percentage cannot be adjusted per-agreement. For very large transactions, 10% may be too much to lock up; for very small transactions, the deposit may be too small to serve as a meaningful deterrent. A production system could allow the parties to negotiate the deposit percentage at deployment time.

### 7.2 Bilateral Only (Two Parties)

The contract is hardcoded for exactly two participants (Party A and Party B). It cannot support multi-party agreements, voting among N participants, or group consensus scenarios without a complete redesign.

### 7.3 Single-Use Contract

Each contract instance handles exactly one agreement cycle. Once `executeContract()` is called, the contract is finalized (`Executed` or `Failed`) and cannot be reused. A new deployment is required for every new agreement, which increases gas costs for repeated interactions between the same parties.

### 7.4 Fixed Deadlines from Deployment

The `commitDeadline` and `revealDeadline` are calculated at **deploy time** (`block.timestamp + duration`), not when both parties have deposited. If parties take a long time to deposit, the commit and reveal windows shrink or may even expire before the process begins. A production system should calculate deadlines from the moment both deposits are confirmed.

### 7.5 Commit Window Constraint

The commit window only opens in the **last 1 hour** before the commit deadline (`commitWindowStart = commitDeadline - 1 hours`). While this is a deliberate design choice to minimize the time window for front-running analysis, it creates tight timing pressure on participants and may cause missed commits due to network congestion or user unavailability.

### 7.6 No Dispute Resolution or Arbitration

There is no third-party arbitrator, oracle, or escalation mechanism. If parties disagree, funds are simply refunded. The contract cannot enforce off-chain obligations, resolve ambiguous situations, or involve a mediator.

### 7.7 Gas Costs Borne by Participants

All on-chain operations (deposit, commit, reveal, execute) cost gas. In a disagreement scenario, both parties still pay gas fees for the full 4-phase flow even though the outcome is a simple refund. On Ethereum mainnet during high-congestion periods, this could be significant.

### 7.8 No Support for ERC-20 Tokens

The contract only works with native ETH. It does not support ERC-20 tokens, stablecoins (USDC, DAI), or any other token standard. Extending to token support would require `approve` + `transferFrom` integration.

### 7.9 Off-Chain Key Management Dependency

The ECDSA verification relies on independent key pairs (separate from the Ethereum wallet addresses). Users must securely generate, store, and manage these additional private keys off-chain. Losing the ECDSA private key means being unable to produce a valid reveal, effectively locking the user out of the process.

### 7.10 No Event Indexing for Complex Queries

While the contract emits events, it lacks rich indexed parameters for complex off-chain filtering. A production system would benefit from more indexed event fields and a subgraph (The Graph) for efficient querying.

### 7.11 Binary Decision Only

The decision is binary: accept (1) or reject (0). The contract cannot handle conditional acceptances, partial agreements, counter-offers, or multi-option votes.

### 7.12 No Upgradability

The contract is not upgradable (no proxy pattern). If a bug is discovered or logic needs to change after deployment, a new contract must be deployed and all parties must migrate. This is a deliberate simplicity/security tradeoff — upgradable proxies introduce their own attack surface.

### 7.13 Block Timestamp Dependence

All phase transitions depend on `block.timestamp`, which can be slightly manipulated by miners/validators (typically within ~15 seconds). While this is unlikely to be exploited in practice for this use case, it is a known EVM limitation.

---

## 📝 8. SUMMARY

The project implements a **trustless bilateral escrow** with two layers of cryptographic security:

1. **Privacy layer (Commit-Reveal):** Ensures neither party knows the other's decision until both have committed. Uses `keccak256` with salt to create opaque hashes.

2. **Authentication layer (ECDSA):** Ensures each party actually signed their own decision. Uses elliptic curve signatures verifiable on-chain with `ecrecover`.

The flow is: **Deploy → Deposits → Commit (hashes) → Reveal (decisions + signatures) → Execution (transfer or refund)**, with exhaustive validations at each step.
