import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber } from '@ethersproject/bignumber';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { Contract } from 'ethers';
//import { deploySortedTokens, TokenList } from '@balancer-examples/shared-dependencies';

describe('Balancer revenue share distributor', () => {
  let protocolFeeCollector: SignerWithAddress, copperFeeCollector: SignerWithAddress;
  let revenueSplitPct: BigNumber;
  let distributor: Contract;
  const NAME = 'Copper';
  /*let tokens: TokenList;

  async function deployTokens() {
    tokens = await deploySortedTokens(['DAI', 'USDC', 'WBTC', 'NEO'], [18, 6, 8, 0]);
  }*/

  before('setup', async () => {
    [, protocolFeeCollector, copperFeeCollector] = await ethers.getSigners();
  });

  context('with 50/50 split', () => {
    beforeEach('deploy distributor', async () => {
      revenueSplitPct = bn(0.5e18);

      distributor = await deploy('TestRevenueShareDistributor', {
        args: [protocolFeeCollector.address, copperFeeCollector.address, revenueSplitPct, NAME],
      });
    });

    it('deploys test distributor with 50/50 split', async () => {
      const balancerAddress = await distributor.protocolFeeRecipient();
      const copperAddress = await distributor.partnerFeeRecipient();
      const feePct = await distributor.partnerRevenueSharePct();
      const name = await distributor.partnerName();

      expect(copperAddress).to.equal(copperFeeCollector.address);
      expect(feePct).to.equal(revenueSplitPct);
      expect(name).to.equal(NAME);
      expect(balancerAddress).to.equal(protocolFeeCollector.address);
    });
  });

  context('with 100/0 split', () => {
    beforeEach('deploy distributor', async () => {
      revenueSplitPct = bn(1e18);

      distributor = await deploy('TestRevenueShareDistributor', {
        args: [protocolFeeCollector.address, copperFeeCollector.address, revenueSplitPct, NAME],
      });
    });

    it('deploys test distributor with 100% to partner', async () => {
      const feePct = await distributor.partnerRevenueSharePct();

      expect(feePct).to.equal(revenueSplitPct);
    });
  });

  context('with 0/100 split', () => {
    beforeEach('deploy distributor', async () => {
      revenueSplitPct = bn(0);

      distributor = await deploy('TestRevenueShareDistributor', {
        args: [protocolFeeCollector.address, copperFeeCollector.address, revenueSplitPct, NAME],
      });
    });

    it('deploys test distributor with 100% to Balancer', async () => {
      const feePct = await distributor.partnerRevenueSharePct();

      expect(feePct).to.equal(revenueSplitPct);
    });
  });

  context('with invalid split', () => {
    beforeEach('deploy distributor', async () => {
      revenueSplitPct = bn(1.01e18);
    });

    it('reverts if the fee is invalid', async () => {
      await expect(
        deploy('TestRevenueShareDistributor', {
          args: [protocolFeeCollector.address, copperFeeCollector.address, revenueSplitPct, NAME],
        })
      ).to.be.revertedWith('Invalid revenue share');
    });
  });

  /*describe('distribute revenue', () => {
    beforeEach('deploy distributor and tokens', async () => {
      // Make it different from 50/50
      revenueSplitPct = bn(0.4e18);

      distributor = await deploy('TestRevenueShareDistributor', {
        args: [protocolFeeCollector.address, copperFeeCollector.address, revenueSplitPct, NAME],
      });

      await deployTokens();
    });

    it('deploys test distributor with 60/40 split', async () => {
      const balancerAddress = await distributor.protocolFeeRecipient();
      const copperAddress = await distributor.partnerFeeRecipient();
      const feePct = await distributor.partnerRevenueSharePct();
      const name = await distributor.partnerName();

      expect(copperAddress).to.equal(copperFeeCollector.address);
      expect(feePct).to.equal(revenueSplitPct);
      expect(name).to.equal(NAME);
      expect(balancerAddress).to.equal(protocolFeeCollector.address);
    });

    context('with no funds collected', () => {
      beforeEach('distribute revenue share', async () => {
        await distributor.distributeRevenueShare(tokens[0].address);
      });
    });
  });*/
});
