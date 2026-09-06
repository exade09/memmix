const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

/*
  A payout round is a Merkle root plus the money behind it. These tests care
  about two things: that an honest holder can always get exactly their share,
  and that nobody -- including the owner -- can take it from them or pay
  themselves twice.
*/

const NATIVE = ethers.ZeroAddress;

function buildTree(entries) {
  // [index, account, amount], matching keccak256(abi.encode(...)) on chain.
  const values = entries.map((e, i) => [i, e.account, e.amount]);
  const tree = StandardMerkleTree.of(values, ["uint256", "address", "uint256"]);
  return { tree, values };
}

async function deployFixture() {
  const [owner, alice, bob, carol, stranger] = await ethers.getSigners();

  const Distributor = await ethers.getContractFactory("RewardsDistributor");
  const distributor = await Distributor.deploy(owner.address);
  await distributor.waitForDeployment();

  // Stand-in for a tokenized equity such as AAPL.
  const Stock = await ethers.getContractFactory("FonsToken");
  const stock = await Stock.deploy("Apple", "AAPL", ethers.parseEther("1000000"), owner.address);
  await stock.waitForDeployment();

  return { distributor, stock, owner, alice, bob, carol, stranger };
}

describe("RewardsDistributor", function () {
  describe("ETH rounds", function () {
    async function ethRound() {
      const ctx = await loadFixture(deployFixture);
      const { distributor, alice, bob, carol } = ctx;
      const entries = [
        { account: alice.address, amount: ethers.parseEther("6") },
        { account: bob.address, amount: ethers.parseEther("3") },
        { account: carol.address, amount: ethers.parseEther("1") },
      ];
      const { tree, values } = buildTree(entries);
      const total = ethers.parseEther("10");
      await distributor.createRound(NATIVE, tree.root, total, 12345, 0, { value: total });
      return { ...ctx, tree, values, entries, total };
    }

    it("funds the round at creation, so it is never advertised while empty", async function () {
      const { distributor, total } = await ethRound();
      expect(await ethers.provider.getBalance(await distributor.getAddress())).to.equal(total);
      expect(await distributor.roundCount()).to.equal(1);
    });

    it("pays a holder exactly their share", async function () {
      const { distributor, tree, values, alice } = await ethRound();
      const proof = tree.getProof(0);

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await distributor.connect(alice).claim(0, 0, alice.address, values[0][2], proof);
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + receipt.gasUsed * receipt.gasPrice).to.equal(ethers.parseEther("6"));
    });

    it("refuses a second claim of the same entry", async function () {
      const { distributor, tree, values, alice } = await ethRound();
      const proof = tree.getProof(0);
      await distributor.connect(alice).claim(0, 0, alice.address, values[0][2], proof);
      await expect(
        distributor.connect(alice).claim(0, 0, alice.address, values[0][2], proof),
      ).to.be.revertedWithCustomError(distributor, "AlreadyClaimed");
    });

    it("lets anyone pay the gas, but pays the holder", async function () {
      const { distributor, tree, values, alice, stranger } = await ethRound();
      const proof = tree.getProof(0);

      const before = await ethers.provider.getBalance(alice.address);
      await distributor.connect(stranger).claim(0, 0, alice.address, values[0][2], proof);
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before).to.equal(ethers.parseEther("6"), "funds must go to the holder");
    });

    it("rejects a claim for an amount that was not in the tree", async function () {
      const { distributor, tree, alice } = await ethRound();
      const proof = tree.getProof(0);
      await expect(
        distributor.connect(alice).claim(0, 0, alice.address, ethers.parseEther("9"), proof),
      ).to.be.revertedWithCustomError(distributor, "InvalidProof");
    });

    it("rejects someone else's proof used for a different account", async function () {
      const { distributor, tree, values, stranger } = await ethRound();
      const proof = tree.getProof(0);
      await expect(
        distributor.connect(stranger).claim(0, 0, stranger.address, values[0][2], proof),
      ).to.be.revertedWithCustomError(distributor, "InvalidProof");
    });

    it("lets every holder claim, and empties the round exactly", async function () {
      const { distributor, tree, values, alice, bob, carol, total } = await ethRound();
      const signers = [alice, bob, carol];
      for (let i = 0; i < 3; i++) {
        await distributor.connect(signers[i]).claim(0, i, values[i][1], values[i][2], tree.getProof(i));
      }
      expect(await distributor.remaining(0)).to.equal(0n);
      expect(await ethers.provider.getBalance(await distributor.getAddress())).to.equal(0n);
      expect(total).to.equal(ethers.parseEther("10"));
    });
  });

  describe("stock rounds", function () {
    it("pays out an ERC-20 such as a tokenized equity", async function () {
      const { distributor, stock, owner, alice } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("250");
      const { tree, values } = buildTree([{ account: alice.address, amount }]);

      await stock.connect(owner).approve(await distributor.getAddress(), amount);
      await distributor.createRound(await stock.getAddress(), tree.root, amount, 1, 0);

      await distributor.connect(alice).claim(0, 0, alice.address, values[0][2], tree.getProof(0));
      expect(await stock.balanceOf(alice.address)).to.equal(amount);
    });

    it("will not create an ERC-20 round with ETH attached", async function () {
      const { distributor, stock, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("10");
      const { tree } = buildTree([{ account: owner.address, amount }]);
      await stock.connect(owner).approve(await distributor.getAddress(), amount);
      await expect(
        distributor.createRound(await stock.getAddress(), tree.root, amount, 1, 0, { value: 1n }),
      ).to.be.revertedWithCustomError(distributor, "AmountMismatch");
    });

    it("will not create an ETH round underfunded", async function () {
      const { distributor, owner } = await loadFixture(deployFixture);
      const { tree } = buildTree([{ account: owner.address, amount: ethers.parseEther("10") }]);
      await expect(
        distributor.createRound(NATIVE, tree.root, ethers.parseEther("10"), 1, 0, {
          value: ethers.parseEther("9"),
        }),
      ).to.be.revertedWithCustomError(distributor, "AmountMismatch");
    });
  });

  describe("a round can never overpay", function () {
    it("stops claims once the deposited total is used up, even on a bad root", async function () {
      const { distributor, alice, bob } = await loadFixture(deployFixture);
      // A deliberately wrong tree: it promises more than will be deposited.
      const entries = [
        { account: alice.address, amount: ethers.parseEther("8") },
        { account: bob.address, amount: ethers.parseEther("8") },
      ];
      const { tree, values } = buildTree(entries);
      const funded = ethers.parseEther("10");
      await distributor.createRound(NATIVE, tree.root, funded, 1, 0, { value: funded });

      await distributor.connect(alice).claim(0, 0, alice.address, values[0][2], tree.getProof(0));
      // Bob's 8 would take the round to 16 against 10 deposited.
      await expect(
        distributor.connect(bob).claim(0, 1, bob.address, values[1][2], tree.getProof(1)),
      ).to.be.revertedWithCustomError(distributor, "ExceedsRoundTotal");
    });
  });

  describe("owner limits", function () {
    it("only the owner can create a round", async function () {
      const { distributor, alice } = await loadFixture(deployFixture);
      const { tree } = buildTree([{ account: alice.address, amount: 1n }]);
      await expect(
        distributor.connect(alice).createRound(NATIVE, tree.root, 1n, 1, 0, { value: 1n }),
      ).to.be.revertedWithCustomError(distributor, "OwnableUnauthorizedAccount");
    });

    it("cannot claw back a round once anyone has been paid", async function () {
      const { distributor, alice, bob } = await loadFixture(deployFixture);
      const entries = [
        { account: alice.address, amount: ethers.parseEther("6") },
        { account: bob.address, amount: ethers.parseEther("4") },
      ];
      const { tree, values } = buildTree(entries);
      const total = ethers.parseEther("10");
      await distributor.createRound(NATIVE, tree.root, total, 1, 0, { value: total });

      await distributor.connect(alice).claim(0, 0, alice.address, values[0][2], tree.getProof(0));

      await expect(distributor.cancelRound(0)).to.be.revertedWithCustomError(
        distributor,
        "AlreadyClaimed",
      );
      // Bob can still get his, which is the point.
      await expect(
        distributor.connect(bob).claim(0, 1, bob.address, values[1][2], tree.getProof(1)),
      ).to.not.be.reverted;
    });

    it("can cancel an untouched round and get the funds back", async function () {
      const { distributor, owner, alice } = await loadFixture(deployFixture);
      const total = ethers.parseEther("10");
      const { tree } = buildTree([{ account: alice.address, amount: total }]);
      await distributor.createRound(NATIVE, tree.root, total, 1, 0, { value: total });

      await expect(distributor.cancelRound(0)).to.changeEtherBalance(owner, total);
    });

    it("cannot sweep before the published expiry", async function () {
      const { distributor, alice } = await loadFixture(deployFixture);
      const total = ethers.parseEther("10");
      const { tree } = buildTree([{ account: alice.address, amount: total }]);
      const expiry = (await time.latest()) + 3600;
      await distributor.createRound(NATIVE, tree.root, total, 1, expiry, { value: total });

      await expect(distributor.sweepExpired(0)).to.be.revertedWithCustomError(
        distributor,
        "NotYetExpired",
      );
    });

    it("can sweep only what is left after expiry, and only once", async function () {
      const { distributor, owner, alice, bob } = await loadFixture(deployFixture);
      const entries = [
        { account: alice.address, amount: ethers.parseEther("6") },
        { account: bob.address, amount: ethers.parseEther("4") },
      ];
      const { tree, values } = buildTree(entries);
      const total = ethers.parseEther("10");
      const expiry = (await time.latest()) + 3600;
      await distributor.createRound(NATIVE, tree.root, total, 1, expiry, { value: total });

      await distributor.connect(alice).claim(0, 0, alice.address, values[0][2], tree.getProof(0));
      await time.increaseTo(expiry + 1);

      // Only Bob's unclaimed 4 comes back.
      await expect(distributor.sweepExpired(0)).to.changeEtherBalance(owner, ethers.parseEther("4"));
      await expect(distributor.sweepExpired(0)).to.be.revertedWithCustomError(
        distributor,
        "NothingToSweep",
      );
    });

    it("refuses claims after expiry", async function () {
      const { distributor, alice } = await loadFixture(deployFixture);
      const total = ethers.parseEther("10");
      const { tree, values } = buildTree([{ account: alice.address, amount: total }]);
      const expiry = (await time.latest()) + 3600;
      await distributor.createRound(NATIVE, tree.root, total, 1, expiry, { value: total });

      await time.increaseTo(expiry + 1);
      await expect(
        distributor.connect(alice).claim(0, 0, alice.address, values[0][2], tree.getProof(0)),
      ).to.be.revertedWithCustomError(distributor, "RoundExpired");
    });
  });

  describe("many rounds", function () {
    it("keeps rounds independent, including the same holder across assets", async function () {
      const { distributor, stock, owner, alice } = await loadFixture(deployFixture);
      const ethAmount = ethers.parseEther("5");
      const stockAmount = ethers.parseEther("100");

      const ethTree = buildTree([{ account: alice.address, amount: ethAmount }]);
      const stockTree = buildTree([{ account: alice.address, amount: stockAmount }]);

      await distributor.createRound(NATIVE, ethTree.tree.root, ethAmount, 1, 0, { value: ethAmount });
      await stock.connect(owner).approve(await distributor.getAddress(), stockAmount);
      await distributor.createRound(await stock.getAddress(), stockTree.tree.root, stockAmount, 2, 0);

      // Claiming the ETH round must not mark the stock round as claimed.
      await distributor.connect(alice).claim(0, 0, alice.address, ethAmount, ethTree.tree.getProof(0));
      expect(await distributor.isClaimed(1, 0)).to.equal(false);

      await distributor.connect(alice).claim(1, 0, alice.address, stockAmount, stockTree.tree.getProof(0));
      expect(await stock.balanceOf(alice.address)).to.equal(stockAmount);
    });
  });
});
