const { ethers } = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-network-helpers");

async function main() {
  const [partyA, partyB] = await ethers.getSigners();

  // Independent ECDSA keys for signing decisions
  const ecdsaA = ethers.Wallet.createRandom();
  const ecdsaB = ethers.Wallet.createRandom();

  // Minimum amounts (10 wei each → deposit = 1 wei each)
  const amountA = ethers.parseEther("0.01");  // 0.01 ETH
  const amountB = ethers.parseEther("0.01");  // 0.01 ETH
  const depositA = amountA / 10n;  // 0.001 ETH
  const depositB = amountB / 10n;  // 0.001 ETH

  console.log("═══════════════════════════════════════════════");
  console.log("  BILATERAL AGREEMENT — END-TO-END WALKTHROUGH");
  console.log("═══════════════════════════════════════════════\n");

  // ─── DEPLOY ───
  console.log("STEP 0: DEPLOY");
  const Contract = await ethers.getContractFactory("BilateralAgreement", partyA);
  const contract = await Contract.deploy(
    partyB.address,
    ecdsaA.address,
    ecdsaB.address,
    amountA,
    amountB,
    1,  // 1 day commit period
    1   // 1 hour reveal period
  );
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("  Contract deployed at:", addr);
  console.log("  Party A:", partyA.address);
  console.log("  Party B:", partyB.address);
  console.log("  Amount A:", ethers.formatEther(amountA), "ETH → Deposit:", ethers.formatEther(depositA), "ETH (10%)");
  console.log("  Amount B:", ethers.formatEther(amountB), "ETH → Deposit:", ethers.formatEther(depositB), "ETH (10%)");
  console.log("  Status:", await contract.status(), "(0 = Created)");
  console.log();

  // ─── PHASE 1: DEPOSITS ───
  console.log("STEP 1: DEPOSITS");
  const balA_before = await ethers.provider.getBalance(partyA.address);
  const balB_before = await ethers.provider.getBalance(partyB.address);
  console.log("  Balance A before:", ethers.formatEther(balA_before), "ETH");
  console.log("  Balance B before:", ethers.formatEther(balB_before), "ETH");

  let tx = await contract.connect(partyA).depositFunds({ value: depositA });
  await tx.wait();
  console.log("  ✅ Party A deposited", ethers.formatEther(depositA), "ETH");

  tx = await contract.connect(partyB).depositFunds({ value: depositB });
  await tx.wait();
  console.log("  ✅ Party B deposited", ethers.formatEther(depositB), "ETH");

  console.log("  Contract balance:", ethers.formatEther(await ethers.provider.getBalance(addr)), "ETH");
  console.log("  Status:", await contract.status(), "(1 = Deposited)");
  console.log();

  // ─── PHASE 2: COMMIT ───
  console.log("STEP 2: COMMIT (fast-forward to commit window)");
  const commitWindowStart = await contract.commitWindowStart();
  await helpers.time.increaseTo(commitWindowStart);
  console.log("  ⏩ Time advanced to commit window start");

  // Both parties decide to ACCEPT (decision = 1)
  const decA = 1;
  const decB = 1;

  // Sign decisions with ECDSA keys
  const msgHashA = ethers.keccak256(ethers.solidityPacked(["uint8"], [decA]));
  const sigA = await ecdsaA.signMessage(ethers.getBytes(msgHashA));
  const splitSigA = ethers.Signature.from(sigA);

  const msgHashB = ethers.keccak256(ethers.solidityPacked(["uint8"], [decB]));
  const sigB = await ecdsaB.signMessage(ethers.getBytes(msgHashB));
  const splitSigB = ethers.Signature.from(sigB);

  // Create commit hashes: keccak256(decision || r,s,v || salt)
  const saltA = ethers.hexlify(ethers.randomBytes(32));
  const saltB = ethers.hexlify(ethers.randomBytes(32));

  const sigBytesA = ethers.solidityPacked(["bytes32", "bytes32", "uint8"], [splitSigA.r, splitSigA.s, splitSigA.v]);
  const commitHashA = ethers.keccak256(ethers.solidityPacked(["uint8", "bytes", "bytes32"], [decA, sigBytesA, saltA]));

  const sigBytesB = ethers.solidityPacked(["bytes32", "bytes32", "uint8"], [splitSigB.r, splitSigB.s, splitSigB.v]);
  const commitHashB = ethers.keccak256(ethers.solidityPacked(["uint8", "bytes", "bytes32"], [decB, sigBytesB, saltB]));

  tx = await contract.connect(partyA).commitHash(commitHashA);
  await tx.wait();
  console.log("  ✅ Party A committed hash");

  tx = await contract.connect(partyB).commitHash(commitHashB);
  await tx.wait();
  console.log("  ✅ Party B committed hash");
  console.log("  Status:", await contract.status(), "(2 = Commit)");
  console.log();

  // ─── PHASE 3: REVEAL ───
  console.log("STEP 3: REVEAL (fast-forward past commit deadline)");
  const commitDeadline = await contract.commitDeadline();
  await helpers.time.increaseTo(commitDeadline + 1n);
  console.log("  ⏩ Time advanced past commit deadline");

  tx = await contract.connect(partyA).revealDecision(decA, splitSigA.v, splitSigA.r, splitSigA.s, saltA);
  await tx.wait();
  console.log("  ✅ Party A revealed: ACCEPT");

  tx = await contract.connect(partyB).revealDecision(decB, splitSigB.v, splitSigB.r, splitSigB.s, saltB);
  await tx.wait();
  console.log("  ✅ Party B revealed: ACCEPT");
  console.log("  Status:", await contract.status(), "(3 = Reveal)");
  console.log();

  // ─── PHASE 4: EXECUTE ───
  console.log("STEP 4: EXECUTE (fast-forward past reveal deadline)");
  const revealDeadline = await contract.revealDeadline();
  await helpers.time.increaseTo(revealDeadline + 1n);
  console.log("  ⏩ Time advanced past reveal deadline");

  const balA_preExec = await ethers.provider.getBalance(partyA.address);
  const balB_preExec = await ethers.provider.getBalance(partyB.address);

  tx = await contract.connect(partyA).executeContract();
  await tx.wait();

  const balA_after = await ethers.provider.getBalance(partyA.address);
  const balB_after = await ethers.provider.getBalance(partyB.address);

  console.log("  ✅ Contract executed!");
  console.log("  Status:", await contract.status(), "(4 = Executed, 5 = Failed)");
  console.log("  Contract balance:", ethers.formatEther(await ethers.provider.getBalance(addr)), "ETH");
  console.log();

  // ─── SUMMARY ───
  const aAccepted = decA === 1;
  const bAccepted = decB === 1;
  const bothAccepted = aAccepted && bAccepted;

  console.log("═══════════════════════════════════════════════");
  console.log("  RESULT SUMMARY");
  console.log("═══════════════════════════════════════════════");
  console.log("  Party A decision:", aAccepted ? "ACCEPT ✅" : "REJECT ❌");
  console.log("  Party B decision:", bAccepted ? "ACCEPT ✅" : "REJECT ❌");
  console.log("  Outcome:", bothAccepted ? "AGREEMENT REACHED ✅" : "AGREEMENT FAILED ❌");
  console.log();

  if (bothAccepted) {
    console.log("  → Both deposits returned to their owners.");
  } else if (aAccepted && !bAccepted) {
    console.log("  → Party B rejected: B's deposit (", ethers.formatEther(depositB), "ETH) transferred to A as penalty.");
  } else if (!aAccepted && bAccepted) {
    console.log("  → Party A rejected: A's deposit (", ethers.formatEther(depositA), "ETH) transferred to B as penalty.");
  } else {
    console.log("  → Mutual disagreement: both deposits returned.");
  }
  console.log();

  console.log("  Party A balance change:", ethers.formatEther(balA_after - balA_before), "ETH");
  console.log("  Party B balance change:", ethers.formatEther(balB_after - balB_before), "ETH");
  console.log("  Contract balance:", ethers.formatEther(await ethers.provider.getBalance(addr)), "ETH");
  console.log("  Contract drained?", (await ethers.provider.getBalance(addr)) === 0n ? "YES ✅" : "NO ❌");
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
