const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/*
  These tests are about money, so they lean on invariants rather than on
  hand-computed expected values wherever possible: the contract must never pay
  out more than it took in, a holder must never be paid twice for the same
  deposit, and selling must not carry accrued rewards over to the buyer.
*/

const SUPPLY = ethers.parseEther("1000000000"); // 1e9, matching the intended launch supply

async function deploy() {
  const [owner, alice, bob, carol, pool] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("FonsToken");
  const token = await Token.deploy("Fons", "FONS", SUPPLY, owner.address);
  await token.waitForDeployment();
  return { token, owner, alice, bob, carol, pool };
}

/** Owner holds the whole supply at deploy; spread it so splits are meaningful. */
async function deployAndSpread() {
  const ctx = await loadFixture(deploy);
  const { token, owner, alice, bob, carol } = ctx;
  await token.connect(owner).transfer(alice.address, ethers.parseEther("600000000"));
  await token.connect(owner).transfer(bob.address, ethers.parseEther("300000000"));
  await token.connect(owner).transfer(carol.address, ethers.parseEther("100000000"));
  // Owner keeps nothing, so the three holders are the whole eligible supply.
  return ctx;
}

describe("FonsToken", function () {
  describe("deployment", function () {
    it("mints the whole supply to the owner and counts it as eligible", async function () {
      const { token, owner } = await loadFixture(deploy);
      expect(await token.totalSupply()).to.equal(SUPPLY);
      expect(await token.balanceOf(owner.address)).to.equal(SUPPLY);
      expect(await token.rewardBearingSupply()).to.equal(SUPPLY);
    });

    it("has no mint, pause or blacklist surface", async function () {
      const { token } = await loadFixture(deploy);
      for (const fn of ["mint", "pause", "blacklist", "setFee", "withdrawAll"]) {
        expect(token.interface.fragments.some((f) => f.name === fn)).to.equal(
          false,
          `${fn} should not exist`,
        );
      }
    });
  });

  describe("distribution", function () {
    it("splits a deposit in proportion to holdings", async function () {
      const { token, alice, bob, carol } = await deployAndSpread();
      await token.depositRewards({ value: ethers.parseEther("10") });

      expect(await token.withdrawableRewardOf(alice.address)).to.be.closeTo(ethers.parseEther("6"), 5n);
      expect(await token.withdrawableRewardOf(bob.address)).to.be.closeTo(ethers.parseEther("3"), 5n);
      expect(await token.withdrawableRewardOf(carol.address)).to.be.closeTo(ethers.parseEther("1"), 5n);
    });

    it("accepts a plain ETH transfer as a deposit", async function () {
      const { token, alice, owner } = await deployAndSpread();
      await owner.sendTransaction({ to: await token.getAddress(), value: ethers.parseEther("10") });
      expect(await token.withdrawableRewardOf(alice.address)).to.be.closeTo(ethers.parseEther("6"), 5n);
    });

    it("never owes more than it was given", async function () {
      const { token, alice, bob, carol } = await deployAndSpread();
      const deposit = ethers.parseEther("7.123456789012345678");
      await token.depositRewards({ value: deposit });

      const owed =
        (await token.withdrawableRewardOf(alice.address)) +
        (await token.withdrawableRewardOf(bob.address)) +
        (await token.withdrawableRewardOf(carol.address));
      expect(owed).to.be.lte(deposit);
    });

    it("keeps ETH that arrives with nobody eligible, and pays it out later", async function () {
      const { token, owner, alice } = await loadFixture(deploy);
      // Exclude the only holder, so nothing is eligible.
      await token.connect(owner).setExcludedFromRewards(owner.address, true);
      expect(await token.rewardBearingSupply()).to.equal(0n);

      await token.depositRewards({ value: ethers.parseEther("5") });
      expect(await token.totalRewardsDistributed()).to.equal(0n);
      // The ETH is still held, not lost.
      expect(await ethers.provider.getBalance(await token.getAddress())).to.equal(
        ethers.parseEther("5"),
      );

      // Once a real holder exists, a later deposit distributes normally and
      // the earlier ETH is still there to back the claims.
      await token.connect(owner).transfer(alice.address, ethers.parseEther("1000"));
      await token.depositRewards({ value: ethers.parseEther("1") });
      expect(await token.withdrawableRewardOf(alice.address)).to.be.closeTo(ethers.parseEther("1"), 5n);
    });
  });

  describe("claiming", function () {
    it("pays the holder and clears the balance owed", async function () {
      const { token, alice } = await deployAndSpread();
      await token.depositRewards({ value: ethers.parseEther("10") });

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await token.connect(alice).claim();
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + gas).to.be.closeTo(ethers.parseEther("6"), 5n);
      expect(await token.withdrawableRewardOf(alice.address)).to.equal(0n);
    });

    it("cannot be claimed twice", async function () {
      const { token, alice } = await deployAndSpread();
      await token.depositRewards({ value: ethers.parseEther("10") });
      await token.connect(alice).claim();
      await expect(token.connect(alice).claim()).to.be.revertedWithCustomError(
        token,
        "NothingToClaim",
      );
    });

    it("claimFor pays the holder, not the caller", async function () {
      const { token, alice, bob } = await deployAndSpread();
      await token.depositRewards({ value: ethers.parseEther("10") });

      const aliceBefore = await ethers.provider.getBalance(alice.address);
      await token.connect(bob).claimFor(alice.address);
      const aliceAfter = await ethers.provider.getBalance(alice.address);

      expect(aliceAfter - aliceBefore).to.be.closeTo(ethers.parseEther("6"), 5n);
    });

    it("keeps accruing across several deposits", async function () {
      const { token, alice } = await deployAndSpread();
      await token.depositRewards({ value: ethers.parseEther("10") });
      await token.connect(alice).claim();
      await token.depositRewards({ value: ethers.parseEther("10") });
      expect(await token.withdrawableRewardOf(alice.address)).to.be.closeTo(ethers.parseEther("6"), 5n);
    });
  });

  describe("transfers", function () {
    it("lets the seller keep what accrued, and gives the buyer nothing for it", async function () {
      const { token, alice, bob } = await deployAndSpread();
      await token.depositRewards({ value: ethers.parseEther("10") });

      const aliceOwed = await token.withdrawableRewardOf(alice.address);
      const bobOwed = await token.withdrawableRewardOf(bob.address);

      // Alice sells everything to Bob after the deposit.
      await token.connect(alice).transfer(bob.address, await token.balanceOf(alice.address));

      expect(await token.withdrawableRewardOf(alice.address)).to.equal(
        aliceOwed,
        "seller must keep what accrued while holding",
      );
      expect(await token.withdrawableRewardOf(bob.address)).to.equal(
        bobOwed,
        "buyer must not inherit the seller's accrued rewards",
      );
    });

    it("pays the new holder on deposits made after they bought", async function () {
      const { token, alice, bob } = await deployAndSpread();
      await token.connect(alice).transfer(bob.address, ethers.parseEther("600000000"));
      // Bob now holds 900M of the 1000M eligible.
      await token.depositRewards({ value: ethers.parseEther("10") });
      expect(await token.withdrawableRewardOf(bob.address)).to.be.closeTo(ethers.parseEther("9"), 5n);
      expect(await token.withdrawableRewardOf(alice.address)).to.equal(0n);
    });
  });

  describe("exclusions", function () {
    it("keeps a pool out of the split so rewards are not stranded", async function () {
      const { token, alice, bob, owner, pool } = await deployAndSpread();
      // Alice moves her stack into a "pool" address, which is then excluded.
      await token.connect(alice).transfer(pool.address, ethers.parseEther("600000000"));
      await token.connect(owner).setExcludedFromRewards(pool.address, true);

      await token.depositRewards({ value: ethers.parseEther("10") });

      expect(await token.withdrawableRewardOf(pool.address)).to.equal(0n);
      // Bob (300M) and Carol (100M) now split it 3:1.
      expect(await token.withdrawableRewardOf(bob.address)).to.be.closeTo(ethers.parseEther("7.5"), 5n);
    });

    it("does not confiscate what an account accrued before being excluded", async function () {
      const { token, owner, alice } = await deployAndSpread();
      await token.depositRewards({ value: ethers.parseEther("10") });
      const owed = await token.withdrawableRewardOf(alice.address);

      await token.connect(owner).setExcludedFromRewards(alice.address, true);
      expect(await token.withdrawableRewardOf(alice.address)).to.equal(owed);
      await expect(token.connect(alice).claim()).to.not.be.reverted;
    });

    it("does not backdate rewards when an account is re-included", async function () {
      const { token, owner, alice } = await deployAndSpread();
      await token.connect(owner).setExcludedFromRewards(alice.address, true);
      await token.depositRewards({ value: ethers.parseEther("10") });
      await token.connect(owner).setExcludedFromRewards(alice.address, false);

      expect(await token.withdrawableRewardOf(alice.address)).to.equal(
        0n,
        "re-including must not grant a share of deposits made while excluded",
      );
    });

    it("only the owner can change exclusions", async function () {
      const { token, alice, pool } = await loadFixture(deploy);
      await expect(
        token.connect(alice).setExcludedFromRewards(pool.address, true),
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("solvency", function () {
    it("holds enough ETH to cover everything it owes, through churn", async function () {
      const { token, owner, alice, bob, carol, pool } = await deployAndSpread();

      await token.depositRewards({ value: ethers.parseEther("3") });
      await token.connect(alice).transfer(bob.address, ethers.parseEther("100000000"));
      await token.depositRewards({ value: ethers.parseEther("2.5") });
      await token.connect(owner).setExcludedFromRewards(pool.address, true);
      await token.connect(carol).transfer(pool.address, ethers.parseEther("50000000"));
      await token.depositRewards({ value: ethers.parseEther("4.25") });
      await token.connect(bob).claim();
      await token.depositRewards({ value: ethers.parseEther("1.75") });

      const owed =
        (await token.withdrawableRewardOf(alice.address)) +
        (await token.withdrawableRewardOf(bob.address)) +
        (await token.withdrawableRewardOf(carol.address)) +
        (await token.withdrawableRewardOf(pool.address));
      const held = await ethers.provider.getBalance(await token.getAddress());

      expect(held).to.be.gte(owed, "the contract must be able to pay everyone it owes");
    });

    it("every holder can actually withdraw what it says they can", async function () {
      const { token, alice, bob, carol } = await deployAndSpread();
      await token.depositRewards({ value: ethers.parseEther("9.999999999999999999") });

      for (const who of [alice, bob, carol]) {
        const owed = await token.withdrawableRewardOf(who.address);
        if (owed > 0n) {
          await expect(token.connect(who).claim()).to.not.be.reverted;
        }
      }
      expect(await token.withdrawableRewardOf(alice.address)).to.equal(0n);
    });
  });
});

describe("FonsToken · hostile holders", function () {
  it("one recipient that refuses ETH cannot block anyone else", async function () {
    const [owner, alice] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("FonsToken");
    const token = await Token.deploy("Fons", "FONS", SUPPLY, owner.address);
    await token.waitForDeployment();

    const Rejector = await ethers.getContractFactory("RejectsEth");
    const rejector = await Rejector.deploy();
    await rejector.waitForDeployment();

    // Half the supply to a contract that reverts on receive, half to a person.
    await token.connect(owner).transfer(await rejector.getAddress(), ethers.parseEther("500000000"));
    await token.connect(owner).transfer(alice.address, ethers.parseEther("500000000"));

    await token.depositRewards({ value: ethers.parseEther("10") });

    // The hostile holder's own claim fails, as it must...
    await expect(rejector.claimFrom(await token.getAddress())).to.be.reverted;

    // ...but that does not stop a normal holder from being paid, because
    // rewards are pull-only and never pushed in a loop.
    await expect(token.connect(alice).claim()).to.not.be.reverted;
    expect(await token.withdrawableRewardOf(alice.address)).to.equal(0n);
  });
});
