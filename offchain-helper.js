/**
 * Off-chain helper for BilateralAgreement contract.
 *
 * Demonstrates how each party:
 *   1. Generates an independent ECDSA key pair (separate from MetaMask).
 *   2. Signs their decision (accept/reject) with that key pair.
 *   3. Generates a random salt.
 *   4. Computes the commit hash: keccak256(decision || signature || salt).
 *   5. Later reveals (decision, v, r, s, salt) on-chain.
 *
 * Usage (Node.js with ethers v6):
 *   npm install ethers
 *   node offchain-helper.js
 */

const { ethers } = require("ethers");

// ─────────────── Step 1: Generate Independent ECDSA Key Pair ───────────────

function generateKeyPair() {
    const wallet = ethers.Wallet.createRandom();
    return {
        privateKey: wallet.privateKey,
        publicAddress: wallet.address,  // This is the "publicKey" stored in the contract
    };
}

// ─────────────── Step 2: Sign the Decision ───────────────

async function signDecision(privateKey, decision) {
    // decision: 0 = reject, 1 = accept
    if (decision !== 0 && decision !== 1) {
        throw new Error("Decision must be 0 (reject) or 1 (accept)");
    }

    const wallet = new ethers.Wallet(privateKey);

    // Hash the decision the same way the contract does
    const messageHash = ethers.keccak256(
        ethers.solidityPacked(["uint8"], [decision])
    );

    // Sign with EIP-191 prefix (ethers does this automatically with signMessage)
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    // Split signature into v, r, s
    const sig = ethers.Signature.from(signature);

    return {
        v: sig.v,
        r: sig.r,
        s: sig.s,
    };
}

// ─────────────── Step 3: Generate Random Salt ───────────────

function generateSalt() {
    return ethers.hexlify(ethers.randomBytes(32));
}

// ─────────────── Step 4: Compute Commit Hash ───────────────

function computeCommitHash(decision, v, r, s, salt) {
    // Replicate: keccak256(abi.encodePacked(decision, abi.encodePacked(r, s, v), salt))
    const signatureBytes = ethers.solidityPacked(
        ["bytes32", "bytes32", "uint8"],
        [r, s, v]
    );

    return ethers.keccak256(
        ethers.solidityPacked(
            ["uint8", "bytes", "bytes32"],
            [decision, signatureBytes, salt]
        )
    );
}

// ─────────────── Full Example ───────────────

async function main() {
    console.log("=== Bilateral Agreement Off-Chain Helper ===\n");

    // --- Party A ---
    console.log("--- Party A ---");
    const keysA = generateKeyPair();
    console.log("Private Key (KEEP SECRET):", keysA.privateKey);
    console.log("Public Address (register in contract):", keysA.publicAddress);

    const decisionA = 1; // accept
    const sigA = await signDecision(keysA.privateKey, decisionA);
    console.log("Decision:", decisionA === 1 ? "ACCEPT" : "REJECT");
    console.log("Signature v:", sigA.v);
    console.log("Signature r:", sigA.r);
    console.log("Signature s:", sigA.s);

    const saltA = generateSalt();
    console.log("Salt:", saltA);

    const hashA = computeCommitHash(decisionA, sigA.v, sigA.r, sigA.s, saltA);
    console.log("Commit Hash (send to contract):", hashA);

    console.log("\n--- Party B ---");
    const keysB = generateKeyPair();
    console.log("Private Key (KEEP SECRET):", keysB.privateKey);
    console.log("Public Address (register in contract):", keysB.publicAddress);

    const decisionB = 1; // accept
    const sigB = await signDecision(keysB.privateKey, decisionB);
    console.log("Decision:", decisionB === 1 ? "ACCEPT" : "REJECT");
    console.log("Signature v:", sigB.v);
    console.log("Signature r:", sigB.r);
    console.log("Signature s:", sigB.s);

    const saltB = generateSalt();
    console.log("Salt:", saltB);

    const hashB = computeCommitHash(decisionB, sigB.v, sigB.r, sigB.s, saltB);
    console.log("Commit Hash (send to contract):", hashB);

    console.log("\n=== Summary ===");
    console.log("1. Deploy contract with:");
    console.log("   - partyB:", keysB.publicAddress);
    console.log("   - publicKeyA:", keysA.publicAddress);
    console.log("   - publicKeyB:", keysB.publicAddress);
    console.log("2. Both deposit funds via depositFunds()");
    console.log("3. In the commit window, Party A calls commitHash(", hashA, ")");
    console.log("   Party B calls commitHash(", hashB, ")");
    console.log("4. After commit deadline, Party A calls revealDecision(");
    console.log("     ", decisionA, ",", sigA.v, ",", sigA.r, ",", sigA.s, ",", saltA);
    console.log("   )");
    console.log("   Party B calls revealDecision(");
    console.log("     ", decisionB, ",", sigB.v, ",", sigB.r, ",", sigB.s, ",", saltB);
    console.log("   )");
    console.log("5. After reveal deadline, anyone calls executeContract()");
}

main().catch(console.error);
