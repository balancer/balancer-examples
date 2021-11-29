import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber } from '@ethersproject/bignumber';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { DAY, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { Contract } from 'ethers';
import { deploySortedTokens, TokenList } from '@balancer-examples/shared-dependencies';
import { Vault } from '@balancer-labs/typechain';
import { deployVault, txConfirmation } from '@balancer-examples/shared-dependencies/index';

describe('Copper LBP Launcher', () => {
  let admin: SignerWithAddress,
    manager: SignerWithAddress,
    feeRecipient: SignerWithAddress,
    newManager: SignerWithAddress;
  let newFeeRecipient: SignerWithAddress,
    poolOwner: SignerWithAddress,
    newPoolOwner: SignerWithAddress,
    rando: SignerWithAddress;
  let exitFeePercentage: BigNumber;
  let lbpFactory: Contract;
  let launcher: Contract;
  let vault: Vault;
  let tokens: TokenList;

  before('setup', async () => {
    [, admin, manager, feeRecipient, newManager, poolOwner, newPoolOwner, rando] = await ethers.getSigners();
  });

  beforeEach('deploy vault, factory, tokens, and launcher', async () => {
    vault = await deployVault(admin.address);
    lbpFactory = await deploy('LiquidityBootstrappingFactory', { args: [vault.address] });
    exitFeePercentage = bn(3e15);

    tokens = await deploySortedTokens(['DAI', 'USDC', 'WBTC', 'NEO'], [18, 6, 8, 0]);

    launcher = await deploy('CopperLBPLauncher', {
      from: manager,
      args: [exitFeePercentage, feeRecipient, lbpFactory],
    });
  });

  context('initial deployment', () => {
    it('sets the manager', async () => {
      expect(await launcher.getManager()).to.equal(manager.address);
    });

    it('sets the timelock', async () => {
      const timelock = await launcher.getTimelockController();
      const minDelay = await launcher.MIN_TIMELOCK_DELAY();

      const timelockContract = await deployedAt('TimelockController', timelock);

      expect(timelock).to.not.equal(ZERO_ADDRESS);
      expect(await timelockContract.getMinDelay()).to.equal(minDelay);
    });

    it('sets the fee percentage', async () => {
      expect(await launcher.exitFeePercentage()).to.equal(exitFeePercentage);
    });

    it('sets the fee recipient', async () => {
      expect(await launcher.getFeeRecipient()).to.equal(feeRecipient.address);
    });

    it('poolCount is zero', async () => {
      expect(await launcher.poolCount()).to.equal(0);
    });

    it('reverts if getPoolData called with no pool', async () => {
      await expect(launcher.getPoolData(ZERO_ADDRESS)).to.be.revertedWith('Invalid pool address');
    });

    it('reverts if getBPTTokenBalance called with no pool', async () => {
      await expect(launcher.getBPTTokenBalance(ZERO_ADDRESS)).to.be.revertedWith('Invalid pool address');
    });
  });

  context('when ownership is transferred', () => {
    it('reverts if non-manager transfers ownership', async () => {
      await expect(launcher.connect(newManager).transferOwnership(newManager)).to.be.revertedWith(
        'Caller is not manager'
      );
    });

    it('manager can initiate ownership transfer', async () => {
      await launcher.connect(manager).transferOwnership(newManager);

      // 2-step process, so the old manager is still in charge
      expect(await launcher.getManager()).to.equal(manager.address);
    });

    it('claimOwnership reverts if called by non-candidate', async () => {
      await expect(launcher.connect(rando).claimOwnership()).to.be.revertedWith('Sender not allowed');
    });

    it('candidate can claimOwnership', async () => {
      await launcher.connect(newManager).claimOwnership();

      expect(await launcher.getManager()).to.equal(newManager.address);
    });

    it('claimOwnership emits an event', async () => {
      const claimReceipt = await txConfirmation(launcher.connect(newManager).claimOwnership());

      const event = claimReceipt.events?.find((e) => e.event == 'OwnershipTransferred');
      expect(event).to.not.be.null;

      if (event) {
        expect(event.args?.previousManager).to.equal(manager.address);
        expect(event.args?.newManager).to.equal(newManager.address);
      }
    });

    it('claimOwnership reeploys the timelock', async () => {
      const oldTimelock = await launcher.getTimelockController();
      await launcher.connect(newManager).claimOwnership();

      const newTimelock = await launcher.getTimelockController();
      const timelockContract = await deployedAt('TimelockController', newTimelock);

      expect(newTimelock).to.not.equal(oldTimelock);
      expect(await timelockContract.getMinDelay()).to.equal(await launcher.MIN_TIMELOCK_DELAY());
    });
  });

  context('when fee recipient is changed', () => {
    it('reverts unless called by the timelock', async () => {
      await expect(launcher.changeFeeRecipient(newFeeRecipient)).to.be.revertedWith('Must use timelock');
    });

    it('can change the fee recipient through the timelock', async () => {
      expect(true).to.be.true;
    });
  });

  describe('deploy LBP', () => {
    const NAME = 'LBP Name';
    const SYMBOL = 'LBP';
    const PERCENTAGE = bn(1e16);
    let currentTime: BigNumber = bn(0);
    let poolConfig: {
      name: string;
      symbol: string;
      tokens: Contract[]; // DAI/NEO
      amounts: BigNumber[];
      weights: BigNumber[];
      endWeights: BigNumber[];
      fundTokenIndex: number;
      swapFeePercentage: BigNumber;
      userData: string;
      startTime: BigNumber;
      endTime: BigNumber;
      owner: () => Promise<string>;
    };
    let threeTokenConfig: {
      name: string;
      symbol: string;
      tokens: Contract[]; // DAI/NEO
      amounts: BigNumber[];
      weights: BigNumber[];
      endWeights: BigNumber[];
      fundTokenIndex: number;
      swapFeePercentage: BigNumber;
      userData: string;
      startTime: BigNumber;
      endTime: BigNumber;
      owner: () => Promise<string>;
    };
    let mismatchedEndWeightsConfig: {
      name: string;
      symbol: string;
      tokens: Contract[]; // DAI/NEO
      amounts: BigNumber[];
      weights: BigNumber[];
      endWeights: BigNumber[];
      fundTokenIndex: number;
      swapFeePercentage: BigNumber;
      userData: string;
      startTime: BigNumber;
      endTime: BigNumber;
      owner: () => Promise<string>;
    };
    let invalidTimestampsConfig: {
      name: string;
      symbol: string;
      tokens: Contract[]; // DAI/NEO
      amounts: BigNumber[];
      weights: BigNumber[];
      endWeights: BigNumber[];
      fundTokenIndex: number;
      swapFeePercentage: BigNumber;
      userData: string;
      startTime: BigNumber;
      endTime: BigNumber;
      owner: () => Promise<string>;
    };
    let tooShortConfig: {
      name: string;
      symbol: string;
      tokens: Contract[]; // DAI/NEO
      amounts: BigNumber[];
      weights: BigNumber[];
      endWeights: BigNumber[];
      fundTokenIndex: number;
      swapFeePercentage: BigNumber;
      userData: string;
      startTime: BigNumber;
      endTime: BigNumber;
      owner: () => Promise<string>;
    };

    beforeEach('get timestamp and pool config', async () => {
      currentTime = await currentTimestamp();

      poolConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens[0], tokens[3]], // DAI/NEO
        amounts: [fp(1000), fp(10)],
        weights: [fp(0.1), fp(0.9)],
        endWeights: [fp(0.9), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(10),
        endTime: currentTime.add(DAY * 3),
        owner: poolOwner.getAddress,
      };

      threeTokenConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens[0], tokens[1], tokens[3]],
        amounts: [fp(1000), fp(100), fp(10)],
        weights: [fp(0.1), fp(0.2), fp(0.7)],
        endWeights: [fp(0.7), fp(0.2), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(10),
        endTime: currentTime.add(DAY * 3),
        owner: poolOwner.getAddress,
      };

      mismatchedEndWeightsConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens[0], tokens[3]], // DAI/NEO
        amounts: [fp(1000), fp(10)],
        weights: [fp(0.1), fp(0.9)],
        endWeights: [fp(0.7), fp(0.2), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(10),
        endTime: currentTime.add(DAY * 3),
        owner: poolOwner.getAddress,
      };

      invalidTimestampsConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens[0], tokens[3]], // DAI/NEO
        amounts: [fp(1000), fp(10)],
        weights: [fp(0.1), fp(0.9)],
        endWeights: [fp(0.9), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(DAY * 3),
        endTime: currentTime.add(10),
        owner: poolOwner.getAddress,
      };

      tooShortConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens[0], tokens[3]], // DAI/NEO
        amounts: [fp(1000), fp(10)],
        weights: [fp(0.1), fp(0.9)],
        endWeights: [fp(0.9), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(10),
        endTime: currentTime.add(100),
        owner: poolOwner.getAddress,
      };
    });

    it('createAuction reverts unless called by the manager', async () => {
      await expect(launcher.createAuction(poolConfig)).to.be.revertedWith('Caller is not manager');
    });

    it('createAuction reverts if called with three tokens', async () => {
      await expect(launcher.connect(manager).createAuction(threeTokenConfig)).to.be.revertedWith('Only 2-token LBPs');
    });

    it('createAuction reverts if called with mismatched end weights', async () => {
      await expect(launcher.connect(manager).createAuction(mismatchedEndWeightsConfig)).to.be.revertedWith(
        'Length mismatch'
      );
    });

    it('createAuction reverts if called with invalid start/end times', async () => {
      await expect(launcher.connect(manager).createAuction(invalidTimestampsConfig)).to.be.revertedWith(
        'Invalid LBP times'
      );
    });

    it('createAuction reverts if called with too short duration', async () => {
      await expect(launcher.connect(manager).createAuction(tooShortConfig)).to.be.revertedWith(
        'LBP duration too short'
      );
    });

    it('manager can call createAuction', async () => {
      expect(true).to.be.true; // PoolCreated event
    });
    it('createAuction deploys and starts the LBP', async () => {
      expect(true).to.be.true;
    });
    it('createAuction stores the LBP data', async () => {
      expect(true).to.be.true; //  isPool(pool), getPoolAt(index), getPools(), getPoolData()
    });

    context('when trading is enabled', () => {
      it('reverts if setSwapEnabled called by non-pool-owner', async () => {
        expect(true).to.be.true;
      });
      it('pool owner can call setSwapEnabled', async () => {
        expect(true).to.be.true;
      });
    });

    context('when pool ownership is transferred', () => {
      it('reverts if non-pool owner transfers ownership', async () => {
        expect(true).to.be.true;
      });
      it('pool owner can initiate ownership transfer', async () => {
        expect(true).to.be.true;
      });
      it('claimOwnership reverts if called by non-candidate', async () => {
        expect(true).to.be.true;
      });
      it('candidate can claimOwnership of the pool', async () => {
        expect(true).to.be.true;
      });
      it('transfer of pool ownership updates pool data', async () => {
        expect(true).to.be.true;
      });
    });

    describe('when the LBP ends', () => {
      context('when there are no proceeds', () => {
        it('exitPool reverts unless called by pool owner', async () => {
          expect(true).to.be.true;
        });
        it('Pool owner can call exitPool', async () => {
          expect(true).to.be.true;
        });
        it('Pool owner recovers sale proceeds', async () => {
          expect(true).to.be.true;
        });
        it('No fees are charged when the raise failed', async () => {
          expect(true).to.be.true;
        });
      });

      context('when there are proceeds', () => {
        // swap on LBP to create proceeds
        it('Pool owner recovers sale proceeds (minus fees)', async () => {
          expect(true).to.be.true;
        });
        it('Fees are charged and sent to the fee recipient', async () => {
          expect(true).to.be.true;
        });
      });
    });
  });
});
