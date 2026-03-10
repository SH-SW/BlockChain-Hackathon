const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ─────────────── Helper: sign a decision with an independent ECDSA wallet ───────────────
async function signDecision(wallet, decision) {
  const messageHash = ethers.solidityPackedKeccak256(["uint8"], [decision]);
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));
  const sig = ethers.Signature.from(signature);
  return { v: sig.v, r: sig.r, s: sig.s };
}

// ─────────────── Helper: compute the commit hash matching the contract's logic ───────────────
function computeCommitHash(decision, r, s, v, salt) {
  const sigBytes = ethers.solidityPacked(["bytes32", "bytes32", "uint8"], [r, s, v]);
  return ethers.keccak256(ethers.solidityPacked(["uint8", "bytes", "bytes32"], [decision, sigBytes, salt]));
}

// ─────────────── Helper: deploy contract with standard params ───────────────
async function deployFixture() {
  const [deployer, userB, thirdParty] = await ethers.getSigners();

  const ecdsaA = ethers.Wallet.createRandom();
  const ecdsaB = ethers.Wallet.createRandom();

  const amountA = ethers.parseEther("10");
  const amountB = ethers.parseEther("20");
  const depositAmountA = ethers.parseEther("1");
  const depositAmountB = ethers.parseEther("2");

  const BilateralAgreement = await ethers.getContractFactory("BilateralAgreement", deployer);
  const contract = await BilateralAgreement.deploy(
    userB.address,
    ecdsaA.address,
    ecdsaB.address,
    amountA,
    amountB,
    1,  // 1 day commit
    1   // 1 hour reveal
  );

  return { contract, deployer, userB, thirdParty, ecdsaA, ecdsaB, amountA, amountB, depositAmountA, depositAmountB };
}



describe("BilateralAgreement", function () {

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 0: DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 0: Deployment", function () {
    it("should deploy with correct initial state", async function () {
      const { contract, deployer, userB, ecdsaA, ecdsaB, amountA, amountB } = await deployFixture();

      expect(await contract.partyA()).to.equal(deployer.address);
      expect(await contract.partyB()).to.equal(userB.address);
      expect(await contract.publicKeyA()).to.equal(ecdsaA.address);
      expect(await contract.publicKeyB()).to.equal(ecdsaB.address);
      expect(await contract.amountA()).to.equal(amountA);
      expect(await contract.amountB()).to.equal(amountB);
      expect(await contract.status()).to.equal(0); // Created
    });

    it("should reject partyB == address(0)", async function () {
      const [deployer] = await ethers.getSigners();
      const BilateralAgreement = await ethers.getContractFactory("BilateralAgreement", deployer);
      await expect(
        BilateralAgreement.deploy(ethers.ZeroAddress, deployer.address, deployer.address, 1, 1, 1, 1)
      ).to.be.revertedWith("Invalid partyB");
    });

    it("should reject partyB == deployer", async function () {
      const [deployer] = await ethers.getSigners();
      const BilateralAgreement = await ethers.getContractFactory("BilateralAgreement", deployer);
      await expect(
        BilateralAgreement.deploy(deployer.address, deployer.address, deployer.address, 1, 1, 1, 1)
      ).to.be.revertedWith("Invalid partyB");
    });

    it("should reject zero amounts", async function () {
      const [deployer, userB] = await ethers.getSigners();
      const BilateralAgreement = await ethers.getContractFactory("BilateralAgreement", deployer);
      await expect(
        BilateralAgreement.deploy(userB.address, deployer.address, userB.address, 0, 1, 1, 1)
      ).to.be.revertedWith("Amounts must be > 0");
    });

    it("should reject invalid commit period", async function () {
      const [deployer, userB] = await ethers.getSigners();
      const BilateralAgreement = await ethers.getContractFactory("BilateralAgreement", deployer);
      await expect(
        BilateralAgreement.deploy(userB.address, deployer.address, userB.address, 1, 1, 0, 1)
      ).to.be.revertedWith("1-7 days");
      await expect(
        BilateralAgreement.deploy(userB.address, deployer.address, userB.address, 1, 1, 8, 1)
      ).to.be.revertedWith("1-7 days");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 1: DEPOSITS
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 1: Deposits", function () {
    it("should accept correct deposit from Party A (10% of amountA)", async function () {
      const { contract, deployer, depositAmountA } = await deployFixture();
      await expect(contract.connect(deployer).depositFunds({ value: depositAmountA }))
        .to.emit(contract, "FundsDeposited")
        .withArgs(deployer.address, depositAmountA);
      expect(await contract.depositedA()).to.equal(depositAmountA);
      expect(await contract.status()).to.equal(0); // Still Created (B hasn't deposited)
    });

    it("should accept correct deposit from Party B (10% of amountB)", async function () {
      const { contract, userB, depositAmountB } = await deployFixture();
      await expect(contract.connect(userB).depositFunds({ value: depositAmountB }))
        .to.emit(contract, "FundsDeposited")
        .withArgs(userB.address, depositAmountB);
      expect(await contract.depositedB()).to.equal(depositAmountB);
    });

    it("should transition to Deposited when both deposit", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });
      expect(await contract.status()).to.equal(1); // Deposited
    });

    it("should reject wrong amount", async function () {
      const { contract, deployer } = await deployFixture();
      await expect(
        contract.connect(deployer).depositFunds({ value: 1 })
      ).to.be.revertedWith("Wrong amount");
    });

    it("should reject double deposit", async function () {
      const { contract, deployer, depositAmountA } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await expect(
        contract.connect(deployer).depositFunds({ value: depositAmountA })
      ).to.be.revertedWith("Already deposited");
    });

    it("should reject deposit from third party", async function () {
      const { contract, thirdParty } = await deployFixture();
      await expect(
        contract.connect(thirdParty).depositFunds({ value: 1 })
      ).to.be.revertedWith("Not a party");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 2: COMMIT
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 2: Commit", function () {
    it("should reject commit before window opens", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(contract.connect(userB).commitHash(fakeHash))
        .to.be.revertedWith("Window not open");
    });

    it("should accept commit during window", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB, ecdsaA } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      // Fast-forward to commit window (1 hour before deadline)
      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decision = 1;
      const sig = await signDecision(ecdsaA, decision);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = computeCommitHash(decision, sig.r, sig.s, sig.v, salt);

      await expect(contract.connect(deployer).commitHash(hash))
        .to.emit(contract, "HashCommitted")
        .withArgs(deployer.address, hash);

      expect(await contract.hashA()).to.equal(hash);
      expect(await contract.status()).to.equal(2); // Commit
    });

    it("should reject commit after deadline", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);

      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(
        contract.connect(deployer).commitHash(fakeHash)
      ).to.be.revertedWith("Commit ended");
    });

    it("should reject empty hash", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      await expect(
        contract.connect(deployer).commitHash(ethers.ZeroHash)
      ).to.be.revertedWith("Empty hash");
    });

    it("should reject double commit", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("hash1"));
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("hash2"));
      await contract.connect(deployer).commitHash(hash1);

      await expect(
        contract.connect(deployer).commitHash(hash2)
      ).to.be.revertedWith("Already committed");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 3: REVEAL
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 3: Reveal", function () {
    it("should reject reveal before commit deadline", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      await expect(
        contract.connect(deployer).revealDecision(1, 27, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWith("Commit not ended");
    });

    it("should verify and accept a valid reveal", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB, ecdsaA } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      // Commit phase
      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decision = 1;
      const sig = await signDecision(ecdsaA, decision);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = computeCommitHash(decision, sig.r, sig.s, sig.v, salt);
      await contract.connect(deployer).commitHash(hash);

      // Reveal phase
      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);

      await expect(contract.connect(deployer).revealDecision(decision, sig.v, sig.r, sig.s, salt))
        .to.emit(contract, "DecisionRevealed")
        .withArgs(deployer.address, true);

      expect(await contract.revealedA()).to.be.true;
      expect(await contract.decisionA()).to.be.true;
    });

    it("should reject reveal with wrong salt (hash mismatch)", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB, ecdsaA } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decision = 1;
      const sig = await signDecision(ecdsaA, decision);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = computeCommitHash(decision, sig.r, sig.s, sig.v, salt);
      await contract.connect(deployer).commitHash(hash);

      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);

      const wrongSalt = ethers.hexlify(ethers.randomBytes(32));
      await expect(
        contract.connect(deployer).revealDecision(decision, sig.v, sig.r, sig.s, wrongSalt)
      ).to.be.revertedWith("Hash mismatch");
    });

    it("should reject reveal with wrong decision (hash mismatch)", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB, ecdsaA } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decision = 1; // commit with accept
      const sig = await signDecision(ecdsaA, decision);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = computeCommitHash(decision, sig.r, sig.s, sig.v, salt);
      await contract.connect(deployer).commitHash(hash);

      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);

      // Try to reveal with reject (0) instead — hash won't match
      await expect(
        contract.connect(deployer).revealDecision(0, sig.v, sig.r, sig.s, salt)
      ).to.be.revertedWith("Hash mismatch");
    });

    it("should reject reveal with forged signature (wrong ECDSA key)", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      // Use a rogue wallet (not the registered publicKeyA)
      const rogueWallet = ethers.Wallet.createRandom();

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decision = 1;
      const sig = await signDecision(rogueWallet, decision);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = computeCommitHash(decision, sig.r, sig.s, sig.v, salt);
      await contract.connect(deployer).commitHash(hash);

      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);

      // Hash matches but ecrecover will return rogueWallet's address, not publicKeyA
      await expect(
        contract.connect(deployer).revealDecision(decision, sig.v, sig.r, sig.s, salt)
      ).to.be.revertedWith("Bad signature");
    });

    it("should reject reveal after reveal deadline", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB, ecdsaA } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decision = 1;
      const sig = await signDecision(ecdsaA, decision);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = computeCommitHash(decision, sig.r, sig.s, sig.v, salt);
      await contract.connect(deployer).commitHash(hash);

      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      await expect(
        contract.connect(deployer).revealDecision(decision, sig.v, sig.r, sig.s, salt)
      ).to.be.revertedWith("Reveal ended");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  PHASE 4: EXECUTION
  // ═══════════════════════════════════════════════════════════════
  describe("Phase 4: Execute — Both Accept", function () {
    it("should return each party their own deposit when both accept", async function () {
      const { contract, deployer, userB, ecdsaA, ecdsaB, depositAmountA, depositAmountB } = await deployFixture();

      // Deposits (10% of transaction amounts)
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      // Commit
      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decA = 1, decB = 1;
      const sigA = await signDecision(ecdsaA, decA);
      const sigB = await signDecision(ecdsaB, decB);
      const saltA = ethers.hexlify(ethers.randomBytes(32));
      const saltB = ethers.hexlify(ethers.randomBytes(32));
      const hashA = computeCommitHash(decA, sigA.r, sigA.s, sigA.v, saltA);
      const hashB = computeCommitHash(decB, sigB.r, sigB.s, sigB.v, saltB);

      await contract.connect(deployer).commitHash(hashA);
      await contract.connect(userB).commitHash(hashB);

      // Reveal
      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);

      await contract.connect(deployer).revealDecision(decA, sigA.v, sigA.r, sigA.s, saltA);
      await contract.connect(userB).revealDecision(decB, sigB.v, sigB.r, sigB.s, saltB);

      // Execute
      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      const balABefore = await ethers.provider.getBalance(deployer.address);
      const balBBefore = await ethers.provider.getBalance(userB.address);

      // Third party executes (no privilege needed)
      const [,,thirdParty] = await ethers.getSigners();
      await expect(contract.connect(thirdParty).executeContract())
        .to.emit(contract, "ContractExecuted")
        .withArgs(true);

      expect(await contract.status()).to.equal(4); // Executed

      const balAAfter = await ethers.provider.getBalance(deployer.address);
      const balBAfter = await ethers.provider.getBalance(userB.address);

      // Each party recovers their own 10% deposit
      expect(balAAfter - balABefore).to.equal(depositAmountA);
      expect(balBAfter - balBBefore).to.equal(depositAmountB);
    });
  });

  describe("Phase 4: Execute — Disagreement (Penalty)", function () {
    it("should give A both deposits when A accepts but B rejects", async function () {
      const { contract, deployer, userB, ecdsaA, ecdsaB, depositAmountA, depositAmountB } = await deployFixture();

      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decA = 1, decB = 0; // A accepts, B rejects
      const sigA = await signDecision(ecdsaA, decA);
      const sigB = await signDecision(ecdsaB, decB);
      const saltA = ethers.hexlify(ethers.randomBytes(32));
      const saltB = ethers.hexlify(ethers.randomBytes(32));

      await contract.connect(deployer).commitHash(computeCommitHash(decA, sigA.r, sigA.s, sigA.v, saltA));
      await contract.connect(userB).commitHash(computeCommitHash(decB, sigB.r, sigB.s, sigB.v, saltB));

      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);

      await contract.connect(deployer).revealDecision(decA, sigA.v, sigA.r, sigA.s, saltA);
      await contract.connect(userB).revealDecision(decB, sigB.v, sigB.r, sigB.s, saltB);

      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      const balABefore = await ethers.provider.getBalance(deployer.address);
      const balBBefore = await ethers.provider.getBalance(userB.address);

      await contract.connect(deployer).executeContract();

      expect(await contract.status()).to.equal(5); // Failed

      const balAAfter = await ethers.provider.getBalance(deployer.address);
      const balBAfter = await ethers.provider.getBalance(userB.address);

      // A honored the agreement → A gets both deposits (penalty on B)
      expect(balAAfter - balABefore).to.be.closeTo(depositAmountA + depositAmountB, ethers.parseEther("0.01"));
      // B gets nothing (lost deposit as penalty)
      expect(balBAfter - balBBefore).to.equal(0n);
    });

    it("should give B both deposits when B accepts but A rejects", async function () {
      const { contract, deployer, userB, ecdsaA, ecdsaB, depositAmountA, depositAmountB } = await deployFixture();

      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decA = 0, decB = 1; // A rejects, B accepts
      const sigA = await signDecision(ecdsaA, decA);
      const sigB = await signDecision(ecdsaB, decB);
      const saltA = ethers.hexlify(ethers.randomBytes(32));
      const saltB = ethers.hexlify(ethers.randomBytes(32));

      await contract.connect(deployer).commitHash(computeCommitHash(decA, sigA.r, sigA.s, sigA.v, saltA));
      await contract.connect(userB).commitHash(computeCommitHash(decB, sigB.r, sigB.s, sigB.v, saltB));

      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);

      await contract.connect(deployer).revealDecision(decA, sigA.v, sigA.r, sigA.s, saltA);
      await contract.connect(userB).revealDecision(decB, sigB.v, sigB.r, sigB.s, saltB);

      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      const balABefore = await ethers.provider.getBalance(deployer.address);
      const balBBefore = await ethers.provider.getBalance(userB.address);

      const [,,thirdParty] = await ethers.getSigners();
      await contract.connect(thirdParty).executeContract();

      expect(await contract.status()).to.equal(5); // Failed

      const balAAfter = await ethers.provider.getBalance(deployer.address);
      const balBAfter = await ethers.provider.getBalance(userB.address);

      // B honored the agreement → B gets both deposits (penalty on A)
      expect(balBAfter - balBBefore).to.equal(depositAmountA + depositAmountB);
      // A gets nothing (lost deposit as penalty)
      expect(balAAfter - balABefore).to.equal(0n);
    });

    it("should refund when no one commits (non-participation)", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();

      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      // Skip straight to after reveal deadline
      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      await expect(contract.connect(deployer).executeContract())
        .to.emit(contract, "ContractExecuted")
        .withArgs(false);

      expect(await contract.status()).to.equal(5); // Failed
    });

    it("should refund when only A commits and reveals", async function () {
      const { contract, deployer, userB, ecdsaA, depositAmountA, depositAmountB } = await deployFixture();

      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const decA = 1;
      const sigA = await signDecision(ecdsaA, decA);
      const saltA = ethers.hexlify(ethers.randomBytes(32));
      await contract.connect(deployer).commitHash(computeCommitHash(decA, sigA.r, sigA.s, sigA.v, saltA));

      const commitDeadline = await contract.commitDeadline();
      await time.increaseTo(commitDeadline + 1n);
      await contract.connect(deployer).revealDecision(decA, sigA.v, sigA.r, sigA.s, saltA);

      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      await contract.connect(deployer).executeContract();
      expect(await contract.status()).to.equal(5); // Failed — B didn't participate
    });
  });

  describe("Phase 4: Execute — Edge Cases", function () {
    it("should reject execute before reveal deadline", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      await expect(
        contract.connect(deployer).executeContract()
      ).to.be.revertedWith("Reveal not ended");
    });

    it("should reject double execution", async function () {
      const { contract, deployer, userB, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      await contract.connect(deployer).executeContract();
      await expect(
        contract.connect(deployer).executeContract()
      ).to.be.revertedWith("Already finalized");
    });

    it("should handle execute when no deposits were completed (Created status)", async function () {
      const { contract, deployer } = await deployFixture();

      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      // Should succeed — returns 0 to both, marks as Failed
      await contract.connect(deployer).executeContract();
      expect(await contract.status()).to.equal(5); // Failed
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  SECURITY
  // ═══════════════════════════════════════════════════════════════
  describe("Security", function () {
    it("should prevent non-party from committing", async function () {
      const { contract, deployer, userB, thirdParty, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const commitWindowStart = await contract.commitWindowStart();
      await time.increaseTo(commitWindowStart);

      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("hack"));
      await expect(
        contract.connect(thirdParty).commitHash(fakeHash)
      ).to.be.revertedWith("Not a party");
    });

    it("should prevent non-party from revealing", async function () {
      const { contract, thirdParty } = await deployFixture();

      await expect(
        contract.connect(thirdParty).revealDecision(1, 27, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWith("Not a party");
    });

    it("should allow anyone to execute (no privilege required)", async function () {
      const { contract, deployer, userB, thirdParty, depositAmountA, depositAmountB } = await deployFixture();
      await contract.connect(deployer).depositFunds({ value: depositAmountA });
      await contract.connect(userB).depositFunds({ value: depositAmountB });

      const revealDeadline = await contract.revealDeadline();
      await time.increaseTo(revealDeadline + 1n);

      // Third party executes — should work
      await contract.connect(thirdParty).executeContract();
      expect(await contract.status()).to.equal(5);
    });
  });
});

