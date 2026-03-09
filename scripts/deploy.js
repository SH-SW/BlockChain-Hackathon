const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  // Party B's wallet address
  const PARTY_B_ADDRESS = "0x23614fB677117e6D58088c02FBF8db548ca8E54A";

  // Generate independent ECDSA key pairs (separate from wallet signers)
  const ecdsaA = ethers.Wallet.createRandom();
  const ecdsaB = ethers.Wallet.createRandom();

  const amountA = ethers.parseEther("0.01");
  const amountB = ethers.parseEther("0.02");
  const commitPeriodDays = 1;
  const revealPeriodHours = 1;

  console.log("Deploying BilateralAgreement...");
  console.log("  Party A (deployer):", deployer.address);
  console.log("  Party B:          ", PARTY_B_ADDRESS);
  console.log("  ECDSA Key A:      ", ecdsaA.address);
  console.log("  ECDSA Key B:      ", ecdsaB.address);
  console.log("  Amount A:         ", ethers.formatEther(amountA), "ETH");
  console.log("  Amount B:         ", ethers.formatEther(amountB), "ETH");
  console.log("  Commit period:    ", commitPeriodDays, "day(s)");
  console.log("  Reveal period:    ", revealPeriodHours, "hour(s)");

  const BilateralAgreement = await ethers.getContractFactory("BilateralAgreement", deployer);
  const contract = await BilateralAgreement.deploy(
    PARTY_B_ADDRESS,
    ecdsaA.address,
    ecdsaB.address,
    amountA,
    amountB,
    commitPeriodDays,
    revealPeriodHours
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n✅ Contract deployed at:", address);
  console.log("\n⚠️  SAVE THESE ECDSA PRIVATE KEYS (needed for signing decisions):");
  console.log("  ECDSA Private Key A:", ecdsaA.privateKey);
  console.log("  ECDSA Private Key B:", ecdsaB.privateKey);

  console.log("\nTimelines:");
  console.log("  Commit window opens:", new Date(Number(await contract.commitWindowStart()) * 1000).toISOString());
  console.log("  Commit deadline:    ", new Date(Number(await contract.commitDeadline()) * 1000).toISOString());
  console.log("  Reveal deadline:    ", new Date(Number(await contract.revealDeadline()) * 1000).toISOString());

  console.log("\nNext steps:");
  console.log("  1. Both parties call depositFunds() with their amounts");
  console.log("  2. During commit window, both call commitHash(hash)");
  console.log("  3. After commit deadline, both call revealDecision(decision, v, r, s, salt)");
  console.log("  4. After reveal deadline, anyone calls executeContract()");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
