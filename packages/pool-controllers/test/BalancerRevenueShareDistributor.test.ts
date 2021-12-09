import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber, parseFixed } from '@ethersproject/bignumber';
import { Contract } from '@ethersproject/contracts';
import { deploySortedTokens, TokenList, mintTokens } from '@balancer-examples/shared-dependencies';
import BalancerRevenueShareDistributorArtifact from '../artifacts/contracts/BalancerRevenueShareDistributor.sol/BalancerRevenueShareDistributor.json';

function fp(value: number): BigNumber {
  return parseFixed(value.toString(), 18);
}

describe('Balancer revenue share distributor', () => {
  let daoTreasury: SignerWithAddress, copperFeeCollector: SignerWithAddress;
  let revenueSplitPct: BigNumber;
  let distributor: Contract;
  const NAME = 'Copper';
  let tokens: TokenList;

  async function deployDistributor(params: unknown[], from?: SignerWithAddress): Promise<Contract> {
    const [defaultDeployer] = await ethers.getSigners();
    const deployer = from || defaultDeployer;
    const factory = new ethers.ContractFactory(
      BalancerRevenueShareDistributorArtifact.abi,
      BalancerRevenueShareDistributorArtifact.bytecode,
      deployer
    );
    const instance = await factory.deploy(...params);
    return instance;
  }

  before('setup', async () => {
    [, daoTreasury, copperFeeCollector] = await ethers.getSigners();
  });

  context('with 50/50 split', () => {
    beforeEach('deploy distributor', async () => {
      revenueSplitPct = parseFixed('0.5', 18);

      distributor = await deployDistributor([daoTreasury.address, copperFeeCollector.address, revenueSplitPct, NAME]);
    });

    it('deploys test distributor with 50/50 split', async () => {
      const balancerAddress = await distributor.protocolFeeRecipient();
      const copperAddress = await distributor.partnerFeeRecipient();
      const feePct = await distributor.partnerRevenueSharePct();
      const name = await distributor.partnerName();

      expect(copperAddress).to.equal(copperFeeCollector.address);
      expect(feePct).to.equal(revenueSplitPct);
      expect(name).to.equal(NAME);
      expect(balancerAddress).to.equal(daoTreasury.address);
    });
  });

  context('with 100/0 split', () => {
    beforeEach('deploy distributor', async () => {
      revenueSplitPct = parseFixed('1', 18);

      distributor = await deployDistributor([daoTreasury.address, copperFeeCollector.address, revenueSplitPct, NAME]);
    });

    it('deploys test distributor with 100% to partner', async () => {
      const feePct = await distributor.partnerRevenueSharePct();

      expect(feePct).to.equal(revenueSplitPct);
    });
  });

  context('with 0/100 split', () => {
    beforeEach('deploy distributor', async () => {
      revenueSplitPct = parseFixed('0', 18);

      distributor = await deployDistributor([daoTreasury.address, copperFeeCollector.address, revenueSplitPct, NAME]);
    });

    it('deploys test distributor with 100% to Balancer', async () => {
      const feePct = await distributor.partnerRevenueSharePct();

      expect(feePct).to.equal(revenueSplitPct);
    });
  });

  context('with invalid split', () => {
    beforeEach('deploy distributor', async () => {
      revenueSplitPct = parseFixed('1.01', 18);
    });

    it('reverts if the fee is invalid', async () => {
      await expect(
        deployDistributor([daoTreasury.address, copperFeeCollector.address, revenueSplitPct, NAME])
      ).to.be.revertedWith('Invalid revenue share');
    });
  });

  describe('distribute revenue', () => {
    beforeEach('deploy distributor and tokens', async () => {
      // Make it different from 50/50
      revenueSplitPct = fp(0.6);

      tokens = await deploySortedTokens(['DAI', 'USDC', 'WBTC', 'NEO'], [18, 6, 8, 0]);

      distributor = await deployDistributor([daoTreasury.address, copperFeeCollector.address, revenueSplitPct, NAME]);
    });

    it('deploys test distributor with 60/40 split', async () => {
      const balancerAddress = await distributor.protocolFeeRecipient();
      const copperAddress = await distributor.partnerFeeRecipient();
      const feePct = await distributor.partnerRevenueSharePct();
      const name = await distributor.partnerName();

      expect(copperAddress).to.equal(copperFeeCollector.address);
      expect(feePct).to.equal(revenueSplitPct);
      expect(name).to.equal(NAME);
      expect(balancerAddress).to.equal(daoTreasury.address);
    });

    context('with collected funds', () => {
      beforeEach('collect fees', async () => {
        await mintTokens(tokens, 'DAI', distributor.address, fp(10000));
        await mintTokens(tokens, 'WBTC', distributor.address, fp(100));
      });

      it('distributes nothing if there is no token balance', async () => {
        await distributor.distributeRevenueShare(tokens.NEO.address);

        expect(await tokens.NEO.balanceOf(daoTreasury.address)).to.equal(0);
        expect(await tokens.NEO.balanceOf(copperFeeCollector.address)).to.equal(0);
      });

      it('distributes proceeds', async () => {
        await distributor.distributeRevenueShare(tokens.DAI.address);

        expect(await tokens.DAI.balanceOf(daoTreasury.address)).to.equal(fp(4000));
        expect(await tokens.DAI.balanceOf(copperFeeCollector.address)).to.equal(fp(6000));
      });
    });
  });
});
