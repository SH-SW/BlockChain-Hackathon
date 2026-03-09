const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  // On Sepolia/mainnet you only have 1 signer — set Party B's wallet address here
  // If not set, a random wallet is generated for testing (save the private key!)
  let PARTY_B_ADDRESS = process.env.PARTY_B_ADDRESS;
  let partyBWallet;
  if (!PARTY_B_ADDRESS) {
    partyBWallet = ethers.Wallet.createRandom();
    PARTY_B_ADDRESS = partyBWallet.address;
    console.log("⚠️  No PARTY_B_ADDRESS set — generated a random wallet for Party B");
  }

  // Updated deployment script to use user's address as mediator for testing
  const mediatorAddress = deployer.address; // Using deployer's address as mediator for testing

  const BilateralAgreement = await ethers.getContractFactory("BilateralAgreement", deployer);
  const contract = await BilateralAgreement.deploy(
    PARTY_B_ADDRESS,
    amountA,
    amountB,
    mediatorAddress
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n\u2705 Contract deployed at:", address);
  console.log("  Mediator:         ", mediatorAddress);

  if (partyBWallet) {
    console.log("\u26a0\ufe0f Save Party B's private key:", partyBWallet.privateKey);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
